import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../../process/processTreeTerminator.js";
import { normalizeSocialMediaSourceUrl, socialMediaSourceKeySchema } from "@social-harness/shared";
import type {
  SocialMediaSourceDownloadOutput,
  SocialMediaSourceDownloadProgress,
  SocialMediaSourceDownloadTask,
  SocialMediaSourceUrlDownload,
} from "../app/ports/socialMediaSourceDownload.js";
import {
  SocialMediaSourceDownloadFailedError,
  SocialMediaSourceDownloadOutputError,
  SocialMediaSourceDownloadUnavailableError,
} from "../app/errors.js";
import { resolveMediaFileType } from "../domain/mediaFileType.js";
import { parseYtDlpSourceDownloadOutput } from "./ytDlpSourceDownloadOutput.js";
import {
  buildYtDlpChildEnvironment,
  buildYtDlpJavaScriptRuntimeArgs,
  resolveYtDlpCommand,
} from "./ytDlpRuntime.js";
import { createPublicHttpsEgressProxy } from "./publicHttpsEgressProxy.js";

export function buildYtDlpSourceDownloadArgs(input: {
  sourceKey: string;
  sourceUrl: string;
  workingDirectory: string;
  language: string;
  proxyUrl: string;
}): string[] {
  const sourceKey = socialMediaSourceKeySchema.parse(input.sourceKey);
  const source = normalizeSocialMediaSourceUrl(input.sourceUrl);
  const expectedSourceKey = source
    ? source.sourceKind === "youtube"
      ? source.sourceVideoId
      : `url-${createHash("sha256").update(source.sourceUrl).digest("hex")}`
    : null;
  if (
    !source ||
    source.sourceUrl !== input.sourceUrl ||
    sourceKey !== expectedSourceKey ||
    !/^http:\/\/127\.0\.0\.1:\d+$/u.test(input.proxyUrl)
  ) {
    throw new SocialMediaSourceDownloadFailedError();
  }
  const root = resolve(input.workingDirectory);
  const languageMatch = /^([A-Za-z]{2,3})(?:[-_][A-Za-z0-9]{2,8})*$/.exec(input.language.trim());
  const primaryLanguage = languageMatch?.[1]?.toLowerCase();
  const languageCodes = [
    ...new Set([primaryLanguage ? `${primaryLanguage}.*` : null, "en.*"].filter(Boolean)),
  ];
  return [
    "--ignore-config",
    ...buildYtDlpJavaScriptRuntimeArgs(),
    "--no-warnings",
    "--no-cache-dir",
    "--no-playlist",
    "--socket-timeout",
    "20",
    "--proxy",
    input.proxyUrl,
    "--newline",
    "--max-filesize",
    "4G",
    "--format",
    "best[ext=mp4]/best",
    "--write-info-json",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    languageCodes.join(","),
    "--sub-format",
    "vtt/best",
    "--output",
    `video:${join(root, `${sourceKey}.%(ext)s`)}`,
    "--output",
    `infojson:${join(root, `${sourceKey}.info.json`)}`,
    "--output",
    `subtitle:${join(root, `${sourceKey}.%(language)s.%(ext)s`)}`,
    "--progress-template",
    "download:SH_PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.eta)s",
    "--",
    source.sourceUrl,
  ];
}

function parseProgressLine(line: string): SocialMediaSourceDownloadProgress | null {
  const marker = line.indexOf("SH_PROGRESS|");
  if (marker < 0) return null;
  const [, downloadedRaw, totalRaw, estimatedRaw, etaRaw] = line.slice(marker).split("|");
  const downloadedBytes = Number(downloadedRaw);
  if (!Number.isSafeInteger(downloadedBytes) || downloadedBytes < 0) return null;
  const totalBytes = [totalRaw, estimatedRaw]
    .map((value) => Number(value))
    .find((value) => Number.isSafeInteger(value) && value > 0);
  const etaValue = Number(etaRaw);
  return {
    downloadedBytes,
    totalBytes: totalBytes ?? null,
    etaSeconds: Number.isSafeInteger(etaValue) && etaValue >= 0 ? etaValue : null,
  };
}

export function createYtDlpSourceDownloadAdapter(
  options: { executablePath?: string } = {},
): SocialMediaSourceUrlDownload {
  const command = resolveYtDlpCommand(options.executablePath);

  return {
    start(input) {
      const proxy = createPublicHttpsEgressProxy();
      let child: ChildProcess | null = null;
      const startedAt = Date.now();
      let stdoutTail = "";
      let cancellation: Promise<void> | undefined;
      let cancelRequested = false;
      let outputReadStarted = false;
      const infoPath = join(input.workingDirectory, `${input.sourceKey}.info.json`);

      async function cleanInterruptedOutput(): Promise<void> {
        await rm(infoPath, { force: true }).catch(() => undefined);
        if (!cancelRequested) return;
        const entries = await readdir(input.workingDirectory, { withFileTypes: true }).catch(
          () => [],
        );
        await Promise.all(
          entries
            .filter((entry) => {
              if (!entry.isFile() || !entry.name.startsWith(`${input.sourceKey}.`)) return false;
              if (entry.name.endsWith(".part") || entry.name.endsWith(".vtt")) return false;
              return resolveMediaFileType(extname(entry.name)) !== null;
            })
            .map((entry) => rm(join(input.workingDirectory, entry.name), { force: true })),
        );
      }

      const completion = (async (): Promise<SocialMediaSourceDownloadOutput> => {
        try {
          const proxyUrl = await proxy.ready;
          if (cancelRequested) throw new SocialMediaSourceDownloadFailedError();
          const args = buildYtDlpSourceDownloadArgs({ ...input, proxyUrl });
          try {
            child = spawn(command.executable, [...command.argsPrefix, ...args], {
              cwd: input.workingDirectory,
              env: buildYtDlpChildEnvironment(),
              shell: false,
              windowsHide: true,
              detached: shouldSpawnInDetachedProcessGroup(),
              stdio: ["ignore", "pipe", "pipe"],
            });
          } catch {
            throw new SocialMediaSourceDownloadFailedError();
          }

          return await new Promise<SocialMediaSourceDownloadOutput>((resolveOutput, reject) => {
            let stdoutBytes = 0;
            let settled = false;
            const fail = (error: Error) => {
              if (settled) return;
              settled = true;
              reject(error);
            };
            child!.stdout?.on("data", (chunk: Buffer) => {
              stdoutBytes += chunk.byteLength;
              if (stdoutBytes > 1024 * 1024) {
                void task.cancel().catch(() => undefined);
                return;
              }
              stdoutTail += chunk.toString("utf8");
              const lines = stdoutTail.split(/[\r\n]+/);
              stdoutTail = lines.pop() ?? "";
              for (const line of lines) {
                const progress = parseProgressLine(line);
                if (progress) input.onProgress(progress);
              }
            });
            child!.stderr?.on("data", () => undefined);
            child!.once("error", (error: NodeJS.ErrnoException) => {
              fail(
                error.code === "ENOENT"
                  ? new SocialMediaSourceDownloadUnavailableError()
                  : new SocialMediaSourceDownloadFailedError(),
              );
            });
            child!.once("close", (code) => {
              if (settled) return;
              if (cancelRequested || code !== 0) {
                void cleanInterruptedOutput()
                  .catch(() => undefined)
                  .finally(() => fail(new SocialMediaSourceDownloadFailedError()));
                return;
              }
              outputReadStarted = true;
              void parseYtDlpSourceDownloadOutput(input.workingDirectory, input.sourceKey).then(
                (output) => {
                  if (settled) return;
                  settled = true;
                  resolveOutput(output);
                },
                () => fail(new SocialMediaSourceDownloadOutputError()),
              );
            });
            child!.once("close", () => {
              if (!outputReadStarted) void cleanInterruptedOutput().catch(() => undefined);
            });

            // stdout may end without a line terminator; process the final bounded progress record.
            child!.stdout?.once("end", () => {
              const progress = parseProgressLine(stdoutTail);
              if (progress) input.onProgress(progress);
              stdoutTail = "";
            });
          });
        } catch (error) {
          if (
            error instanceof SocialMediaSourceDownloadUnavailableError ||
            error instanceof SocialMediaSourceDownloadOutputError ||
            error instanceof SocialMediaSourceDownloadFailedError
          ) {
            throw error;
          }
          throw new SocialMediaSourceDownloadFailedError();
        } finally {
          if (!outputReadStarted || cancelRequested)
            await cleanInterruptedOutput().catch(() => undefined);
          await proxy.close().catch(() => undefined);
        }
      })();

      const task: SocialMediaSourceDownloadTask = {
        completion,
        async cancel() {
          if (cancellation) return cancellation;
          cancelRequested = true;
          cancellation = (async () => {
            const runningChild = child;
            if (
              runningChild &&
              runningChild.pid != null &&
              runningChild.exitCode === null &&
              runningChild.signalCode === null
            ) {
              await terminateProcessTreeAndWait(runningChild, {
                ...(shouldSpawnInDetachedProcessGroup()
                  ? { ownedProcessGroupId: runningChild.pid }
                  : {}),
                ownedProcessStartedAtMs: startedAt,
                forceAfterMs: 1_000,
                waitAfterForceMs: 1_000,
              });
            }
            await completion.catch(() => undefined);
            await proxy.close().catch(() => undefined);
          })();
          await cancellation;
        },
      };

      // Keep yt-dlp diagnostics out of logs; they may contain private source URLs.
      return task;
    },
  };
}
