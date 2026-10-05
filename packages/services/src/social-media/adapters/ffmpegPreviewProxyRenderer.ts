import { spawn, type ChildProcess } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../../process/processTreeTerminator.js";
import type { SocialMediaPreviewProxyRenderer } from "../app/ports/socialMediaPreviewProxyRenderer.js";
import { SocialMediaPreviewProxyToolUnavailableError } from "../app/errors.js";

const MAX_OUTPUT_BYTES = 4 * 1024 ** 3;
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

type Probe = {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
  }>;
};
function parseProbe(text: string) {
  const probe = JSON.parse(text) as Probe;
  const durationSeconds = Number(probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Array.isArray(probe.streams))
    throw new Error("Invalid preview probe");
  return { ...probe, durationSeconds };
}

export function buildFfmpegPreviewProxyArgs(mediaPath: string, outputPath: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-protocol_whitelist",
    "file",
    "-copyts",
    "-start_at_zero",
    "-i",
    mediaPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-vf",
    "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "-preset",
    "fast",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-fs",
    String(MAX_OUTPUT_BYTES),
    "-progress",
    "pipe:1",
    "-nostats",
    outputPath,
  ];
}

export function createFfmpegPreviewProxyRenderer(
  options: { ffmpegExecutablePath?: string; ffprobeExecutablePath?: string } = {},
): SocialMediaPreviewProxyRenderer {
  const ffmpeg = options.ffmpegExecutablePath?.trim() || "ffmpeg";
  const ffprobe = options.ffprobeExecutablePath?.trim() || "ffprobe";
  return {
    start(input) {
      const outputPath = join(input.workingDirectory, "preview-v1.mp4");
      let child: ChildProcess | null = null;
      let cancelled = false;
      let cancellation: Promise<void> | null = null;
      const terminate = async () => {
        const running = child;
        if (running?.pid && running.exitCode === null && running.signalCode === null) {
          await terminateProcessTreeAndWait(running, {
            ...(shouldSpawnInDetachedProcessGroup() ? { ownedProcessGroupId: running.pid } : {}),
            ownedProcessStartedAtMs: Date.now(),
            forceAfterMs: 1_000,
            waitAfterForceMs: 1_000,
          });
        }
      };
      async function run(
        executable: string,
        args: string[],
        timeoutMs: number,
        progress?: (line: string) => void,
      ): Promise<string> {
        if (cancelled) throw new Error("Preview cancelled");
        return new Promise((resolve, reject) => {
          let output = "";
          let pending = "";
          let bytes = 0;
          let failure: Error | null = null;
          child = spawn(executable, args, {
            cwd: input.workingDirectory,
            shell: false,
            windowsHide: true,
            detached: shouldSpawnInDetachedProcessGroup(),
            stdio: ["ignore", "pipe", "ignore"],
          });
          const running = child;
          const timer = setTimeout(() => {
            failure = new Error("Preview processing exceeded its limit");
            void terminate().catch(() => undefined);
          }, timeoutMs);
          running.stdout?.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (
              (!progress && bytes > MAX_PROCESS_OUTPUT_BYTES) ||
              (progress && chunk.length + pending.length > MAX_PROCESS_OUTPUT_BYTES)
            ) {
              failure = new Error("Preview process output exceeded its limit");
              void terminate().catch(() => undefined);
              return;
            }
            if (!progress) output += chunk.toString("utf8");
            else {
              pending += chunk.toString("utf8");
              const lines = pending.split(/\r?\n/u);
              pending = lines.pop() ?? "";
              for (const line of lines) progress(line);
            }
          });
          running.once("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            reject(
              error.code === "ENOENT"
                ? new SocialMediaPreviewProxyToolUnavailableError()
                : new Error("Preview process failed"),
            );
          });
          running.once("close", (code) => {
            clearTimeout(timer);
            if (child === running) child = null;
            if (cancelled || failure || code !== 0)
              reject(failure ?? new Error("Preview conversion failed"));
            else resolve(output);
          });
        });
      }
      const probe = async (path: string) =>
        parseProbe(
          await run(
            ffprobe,
            [
              "-v",
              "error",
              "-protocol_whitelist",
              "file",
              "-show_entries",
              "format=duration,format_name:stream=codec_type,codec_name,pix_fmt,width,height",
              "-of",
              "json",
              path,
            ],
            15_000,
          ),
        );
      const completion = (async () => {
        await rm(outputPath, { force: true });
        const original = await probe(input.mediaPath);
        if (!original.streams?.some((stream) => stream.codec_type === "video"))
          throw new Error("No video stream");
        await run(
          ffmpeg,
          buildFfmpegPreviewProxyArgs(input.mediaPath, outputPath),
          6 * 60 * 60 * 1_000,
          (line) => {
            const match = /^out_time_us=(\d+)$/u.exec(line);
            if (match)
              input.onProgress({
                processedSeconds: Math.min(original.durationSeconds, Number(match[1]) / 1_000_000),
                durationSeconds: original.durationSeconds,
              });
          },
        );
        const info = await lstat(outputPath);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size <= 0 ||
          info.size > MAX_OUTPUT_BYTES
        )
          throw new Error("Invalid preview output");
        const output = await probe(outputPath);
        const video = output.streams?.filter((stream) => stream.codec_type === "video") ?? [];
        const audio = output.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
        const originalHasAudio = original.streams?.some((stream) => stream.codec_type === "audio");
        if (
          !output.format?.format_name?.split(",").includes("mp4") ||
          video.length !== 1 ||
          video[0]?.codec_name !== "h264" ||
          video[0]?.pix_fmt !== "yuv420p" ||
          !video[0]?.width ||
          !video[0]?.height ||
          Math.max(video[0].width, video[0].height) > 1280 ||
          audio.length !== (originalHasAudio ? 1 : 0) ||
          audio.some((stream) => stream.codec_name !== "aac") ||
          Math.abs(output.durationSeconds - original.durationSeconds) > 0.25
        )
          throw new Error("Preview output did not match its compatibility profile");
        return { outputPath, durationSeconds: original.durationSeconds };
      })().catch(async (error: unknown) => {
        await rm(outputPath, { force: true }).catch(() => undefined);
        if (error instanceof SocialMediaPreviewProxyToolUnavailableError) throw error;
        throw new Error("Preview conversion failed");
      });
      return {
        completion,
        cancel() {
          cancelled = true;
          cancellation ??= (async () => {
            await terminate().catch(() => undefined);
            await completion.catch(() => undefined);
          })();
          return cancellation;
        },
      };
    },
  };
}
