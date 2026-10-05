import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { SocialMediaYouTubeSearchResult } from "@social-harness/shared";
import {
  SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT,
  socialMediaYouTubeSearchResultSchema,
  socialMediaYouTubeVideoIdSchema,
} from "@social-harness/shared";
import type { SocialMediaYouTubeSearch } from "../app/ports/socialMediaYouTubeSearch.js";
import {
  SocialMediaYouTubeSearchFailedError,
  SocialMediaYouTubeSearchUnavailableError,
} from "../app/errors.js";
import {
  buildYtDlpChildEnvironment,
  buildYtDlpJavaScriptRuntimeArgs,
  resolveYtDlpCommand,
} from "./ytDlpRuntime.js";

const SEARCH_TIMEOUT_MS = 45_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 32 * 1024;

export function buildYtDlpYouTubeSearchArgs(
  query: string,
  limit = SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT,
) {
  return [
    "--ignore-config",
    ...buildYtDlpJavaScriptRuntimeArgs(),
    "--no-warnings",
    "--no-progress",
    "--no-cache-dir",
    "--flat-playlist",
    "--dump-single-json",
    "--skip-download",
    "--playlist-end",
    String(limit),
    `ytsearch${limit}:${query}`,
  ];
}

function readNonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function parseUploadDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseCandidate(value: unknown): SocialMediaYouTubeSearchResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const videoId = socialMediaYouTubeVideoIdSchema.safeParse(source.id);
  const title = readNonEmptyString(source.title, 1000);
  if (!videoId.success || !title) return null;

  const channel =
    readNonEmptyString(source.channel, 500) ?? readNonEmptyString(source.uploader, 500);
  const durationSeconds =
    typeof source.duration === "number" && Number.isFinite(source.duration) && source.duration >= 0
      ? source.duration
      : null;
  const viewCount =
    typeof source.view_count === "number" &&
    Number.isSafeInteger(source.view_count) &&
    source.view_count >= 0
      ? source.view_count
      : null;
  const uploadDate = parseUploadDate(source.upload_date);

  return socialMediaYouTubeSearchResultSchema.parse({
    videoId: videoId.data,
    videoUrl: `https://www.youtube.com/watch?v=${videoId.data}`,
    title,
    channel,
    durationSeconds,
    viewCount,
    uploadDate,
  });
}

export function parseYtDlpYouTubeSearchOutput(stdout: string): SocialMediaYouTubeSearchResult[] {
  const payload = JSON.parse(stdout) as unknown;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new SocialMediaYouTubeSearchFailedError();
  }
  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(record.entries) ? record.entries : [record];
  const results: SocialMediaYouTubeSearchResult[] = [];
  const seenVideoIds = new Set<string>();
  for (const entry of entries) {
    const result = parseCandidate(entry);
    if (!result || seenVideoIds.has(result.videoId)) continue;
    seenVideoIds.add(result.videoId);
    results.push(result);
    if (results.length === SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT) break;
  }
  return results;
}

function appendChunk(chunks: Buffer[], chunk: Buffer, currentBytes: number, maxBytes: number) {
  if (currentBytes + chunk.byteLength > maxBytes) return null;
  chunks.push(chunk);
  return currentBytes + chunk.byteLength;
}

export function createYtDlpYouTubeSearchAdapter(
  options: {
    executablePath?: string;
  } = {},
): SocialMediaYouTubeSearch {
  const command = resolveYtDlpCommand(options.executablePath);

  return {
    async search(query, limit) {
      const args = buildYtDlpYouTubeSearchArgs(query, limit);
      return new Promise<SocialMediaYouTubeSearchResult[]>((resolve, reject) => {
        let child;
        try {
          child = spawn(command.executable, [...command.argsPrefix, ...args], {
            cwd: tmpdir(),
            env: buildYtDlpChildEnvironment(),
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch {
          reject(new SocialMediaYouTubeSearchFailedError());
          return;
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let exceededOutputLimit = false;
        const finish = (error?: Error, results?: SocialMediaYouTubeSearchResult[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(results ?? []);
        };
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          finish(new SocialMediaYouTubeSearchFailedError());
        }, SEARCH_TIMEOUT_MS);

        child.stdout.on("data", (chunk: Buffer) => {
          const nextBytes = appendChunk(stdoutChunks, chunk, stdoutBytes, MAX_STDOUT_BYTES);
          if (nextBytes === null) {
            exceededOutputLimit = true;
            child.kill("SIGKILL");
            finish(new SocialMediaYouTubeSearchFailedError());
            return;
          }
          stdoutBytes = nextBytes;
        });
        child.stderr.on("data", (chunk: Buffer) => {
          const nextBytes = appendChunk(stderrChunks, chunk, stderrBytes, MAX_STDERR_BYTES);
          if (nextBytes !== null) stderrBytes = nextBytes;
        });
        child.once("error", (error: NodeJS.ErrnoException) => {
          finish(
            error.code === "ENOENT"
              ? new SocialMediaYouTubeSearchUnavailableError()
              : new SocialMediaYouTubeSearchFailedError(),
          );
        });
        child.once("close", (code: number | null) => {
          if (settled) return;
          if (exceededOutputLimit || code !== 0) {
            finish(new SocialMediaYouTubeSearchFailedError());
            return;
          }
          try {
            finish(
              undefined,
              parseYtDlpYouTubeSearchOutput(Buffer.concat(stdoutChunks).toString("utf8")),
            );
          } catch {
            finish(new SocialMediaYouTubeSearchFailedError());
          }
        });
      });
    },
  };
}
