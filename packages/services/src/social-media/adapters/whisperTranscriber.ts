import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../../process/processTreeTerminator.js";
import {
  SocialMediaTranscriptionFailedError,
  SocialMediaTranscriptionOutputError,
  SocialMediaTranscriptionToolUnavailableError,
} from "../app/errors.js";
import type {
  SocialMediaTranscriber,
  SocialMediaTranscriptionTask,
} from "../app/ports/socialMediaTranscriber.js";
import { parseWebVttTranscript } from "../domain/webVttTranscript.js";

const MAX_TRANSCRIPTION_VTT_BYTES = 20 * 1024 * 1024;

interface WhisperTranscriberOptions {
  ffmpegExecutablePath?: string;
  whisperExecutablePath?: string;
}

export function buildFfmpegTranscriptionArgs(input: {
  mediaPath: string;
  audioPath: string;
}): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input.mediaPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    input.audioPath,
  ];
}

export function buildWhisperCliArgs(input: {
  modelPath: string;
  audioPath: string;
  outputBasePath: string;
  languageCode: string;
}): string[] {
  const normalizedLanguage = input.languageCode.trim().replaceAll("_", "-");
  const primaryLanguage = /^([A-Za-z]{2,3})(?:-[A-Za-z0-9]{2,8})*$/
    .exec(normalizedLanguage)?.[1]
    ?.toLowerCase();
  return [
    "--model",
    input.modelPath,
    "--file",
    input.audioPath,
    "--language",
    primaryLanguage ?? "auto",
    "--output-vtt",
    "--output-file",
    input.outputBasePath,
    "--no-prints",
  ];
}

function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function assertGeneratedFile(path: string, directory: string, maximumBytes: number) {
  const [directoryPath, fileInfo] = await Promise.all([realpath(directory), lstat(path)]);
  const actualPath = await realpath(path);
  if (
    !fileInfo.isFile() ||
    fileInfo.isSymbolicLink() ||
    dirname(actualPath) !== directoryPath ||
    fileInfo.size < 1 ||
    fileInfo.size > maximumBytes
  ) {
    throw new SocialMediaTranscriptionOutputError();
  }
  return fileInfo;
}

export function createWhisperTranscriber(
  options: WhisperTranscriberOptions = {},
): SocialMediaTranscriber {
  const ffmpegExecutable = options.ffmpegExecutablePath?.trim() || "ffmpeg";
  const whisperExecutable = options.whisperExecutablePath?.trim() || "whisper-cli";

  return {
    start(input): SocialMediaTranscriptionTask {
      const audioPath = join(input.workingDirectory, "transcription-audio.wav");
      const outputBasePath = join(input.workingDirectory, "transcription-output");
      const vttPath = `${outputBasePath}.vtt`;
      let child: ChildProcess | null = null;
      let cancellation: Promise<void> | null = null;
      let cancelled = false;

      async function runProcess(
        executable: string,
        args: string[],
        tool: "ffmpeg" | "whisper.cpp",
      ): Promise<void> {
        if (cancelled) throw new SocialMediaTranscriptionFailedError();
        await new Promise<void>((resolveProcess, rejectProcess) => {
          let settled = false;
          const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            rejectProcess(error);
          };
          try {
            child = spawn(executable, args, {
              cwd: input.workingDirectory,
              env: process.env,
              shell: false,
              windowsHide: true,
              detached: shouldSpawnInDetachedProcessGroup(),
              stdio: ["ignore", "ignore", "ignore"],
            });
          } catch (error) {
            fail(
              isErrnoError(error) && error.code === "ENOENT"
                ? new SocialMediaTranscriptionToolUnavailableError(tool)
                : new SocialMediaTranscriptionFailedError(),
            );
            return;
          }
          const currentChild = child;
          currentChild.once("error", (error: NodeJS.ErrnoException) => {
            fail(
              error.code === "ENOENT"
                ? new SocialMediaTranscriptionToolUnavailableError(tool)
                : new SocialMediaTranscriptionFailedError(),
            );
          });
          currentChild.once("close", (code) => {
            if (settled) return;
            settled = true;
            child = null;
            if (cancelled) {
              rejectProcess(new SocialMediaTranscriptionFailedError());
            } else if (code === 0) {
              resolveProcess();
            } else {
              rejectProcess(new SocialMediaTranscriptionFailedError());
            }
          });
        });
      }

      const completion = (async () => {
        await mkdir(input.workingDirectory, { recursive: true, mode: 0o700 });
        await Promise.all([rm(audioPath, { force: true }), rm(vttPath, { force: true })]);
        await runProcess(
          ffmpegExecutable,
          buildFfmpegTranscriptionArgs({ mediaPath: input.mediaPath, audioPath }),
          "ffmpeg",
        );
        await assertGeneratedFile(audioPath, input.workingDirectory, Number.MAX_SAFE_INTEGER);
        await runProcess(
          whisperExecutable,
          buildWhisperCliArgs({
            modelPath: input.modelPath,
            audioPath,
            outputBasePath,
            languageCode: input.languageCode,
          }),
          "whisper.cpp",
        );
        await assertGeneratedFile(vttPath, input.workingDirectory, MAX_TRANSCRIPTION_VTT_BYTES);
        const segments = parseWebVttTranscript(await readFile(vttPath, "utf8"));
        if (segments.length === 0) throw new SocialMediaTranscriptionOutputError();
        return {
          method: "whisper-local" as const,
          languageCode: input.languageCode,
          modelId: input.modelId,
          segments,
          createdAt: Math.max(0, Math.trunc(input.createdAt)),
        };
      })().catch(async (error: unknown) => {
        await Promise.all([
          rm(audioPath, { force: true }).catch(() => undefined),
          rm(vttPath, { force: true }).catch(() => undefined),
        ]);
        if (
          error instanceof SocialMediaTranscriptionToolUnavailableError ||
          error instanceof SocialMediaTranscriptionOutputError ||
          error instanceof SocialMediaTranscriptionFailedError
        ) {
          throw error;
        }
        throw new SocialMediaTranscriptionFailedError();
      });

      return {
        completion,
        async cancel() {
          if (cancellation) return cancellation;
          cancelled = true;
          const runningChild = child;
          cancellation = (async () => {
            if (
              runningChild?.pid != null &&
              runningChild.exitCode === null &&
              runningChild.signalCode === null
            ) {
              await terminateProcessTreeAndWait(runningChild, {
                ...(shouldSpawnInDetachedProcessGroup()
                  ? { ownedProcessGroupId: runningChild.pid }
                  : {}),
                ownedProcessStartedAtMs: Date.now(),
                forceAfterMs: 1_000,
                waitAfterForceMs: 1_000,
              }).catch(() => undefined);
            }
            await completion.catch(() => undefined);
          })();
          await cancellation;
        },
      };
    },
  };
}
