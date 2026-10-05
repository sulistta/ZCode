import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../../process/processTreeTerminator.js";
import {
  SocialMediaClipAnalysisFailedError,
  SocialMediaClipAnalysisToolUnavailableError,
} from "../app/errors.js";
import type { SocialMediaClipSignalAnalyzer } from "../app/ports/socialMediaClipSignalAnalyzer.js";
import type { SocialMediaClipSignals } from "../domain/clipSignals.js";
import {
  buildFfmpegClipAnalysisArgs,
  buildFfprobeClipAnalysisArgs,
  CLIP_SIGNAL_SAMPLE_RATE,
  CLIP_VISUAL_FRAME_HEIGHT,
  CLIP_VISUAL_FRAME_WIDTH,
  CLIP_VISUAL_SAMPLE_INTERVAL_SECONDS,
  createClipSignalAccumulators,
  MAX_CLIP_ANALYSIS_DURATION_SECONDS,
} from "./clipSignalAnalysis.js";

const MAX_PROBE_OUTPUT_BYTES = 256 * 1024;
const PROCESS_TIMEOUT_MS = 90_000;
const FORCE_KILL_AFTER_MS = 1_000;
const MAX_AUDIO_OUTPUT_BYTES =
  MAX_CLIP_ANALYSIS_DURATION_SECONDS * CLIP_SIGNAL_SAMPLE_RATE * 4 + 16_384;
const MAX_VISUAL_OUTPUT_BYTES =
  Math.ceil(MAX_CLIP_ANALYSIS_DURATION_SECONDS / CLIP_VISUAL_SAMPLE_INTERVAL_SECONDS) *
    CLIP_VISUAL_FRAME_WIDTH *
    CLIP_VISUAL_FRAME_HEIGHT +
  CLIP_VISUAL_FRAME_WIDTH * CLIP_VISUAL_FRAME_HEIGHT;

interface FfprobeMediaInfo {
  durationSeconds: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface FfmpegClipSignalAnalyzerOptions {
  ffmpegExecutablePath?: string;
  ffprobeExecutablePath?: string;
}

function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function parseFfprobeClipAnalysisOutput(stdout: string): FfprobeMediaInfo {
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    throw new SocialMediaClipAnalysisFailedError();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SocialMediaClipAnalysisFailedError();
  }
  const root = value as { format?: unknown; streams?: unknown };
  const format =
    typeof root.format === "object" && root.format !== null && !Array.isArray(root.format)
      ? (root.format as { duration?: unknown })
      : null;
  const durationSeconds = Number(format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new SocialMediaClipAnalysisFailedError();
  }
  const streams = Array.isArray(root.streams) ? root.streams : [];
  return {
    durationSeconds,
    hasAudio: streams.some(
      (stream) =>
        typeof stream === "object" &&
        stream !== null &&
        "codec_type" in stream &&
        (stream as { codec_type?: unknown }).codec_type === "audio",
    ),
    hasVideo: streams.some(
      (stream) =>
        typeof stream === "object" &&
        stream !== null &&
        "codec_type" in stream &&
        (stream as { codec_type?: unknown }).codec_type === "video",
    ),
  };
}

function childProcessOptions() {
  return {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    detached: shouldSpawnInDetachedProcessGroup(),
  } as const;
}

function terminateChild(child: ChildProcess): void {
  if (child.pid == null || child.exitCode !== null || child.signalCode !== null) return;
  void terminateProcessTreeAndWait(child, {
    ...(shouldSpawnInDetachedProcessGroup() ? { ownedProcessGroupId: child.pid } : {}),
    ownedProcessStartedAtMs: Date.now(),
    forceAfterMs: FORCE_KILL_AFTER_MS,
    waitAfterForceMs: FORCE_KILL_AFTER_MS,
  }).catch(() => undefined);
}

function collectProcessOutput(input: {
  executable: string;
  args: string[];
  tool: "ffmpeg" | "ffprobe";
  timeoutMs: number;
  maximumBytes: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess | null = null;
    let settled = false;
    let byteCount = 0;
    let timeout: NodeJS.Timeout | null = null;
    const output: Buffer[] = [];
    const finish = (error?: Error, data?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(Buffer.concat(data ? [data] : output));
    };
    try {
      child = spawn(input.executable, input.args, {
        ...childProcessOptions(),
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      finish(
        isErrnoError(error) && error.code === "ENOENT"
          ? new SocialMediaClipAnalysisToolUnavailableError(input.tool)
          : new SocialMediaClipAnalysisFailedError(),
      );
      return;
    }
    const running = child;
    timeout = setTimeout(() => {
      terminateChild(running);
      finish(new SocialMediaClipAnalysisFailedError());
    }, input.timeoutMs);
    running.once("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new SocialMediaClipAnalysisToolUnavailableError(input.tool)
          : new SocialMediaClipAnalysisFailedError(),
      );
    });
    running.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      byteCount += chunk.byteLength;
      if (byteCount > input.maximumBytes) {
        terminateChild(running);
        finish(new SocialMediaClipAnalysisFailedError());
        return;
      }
      output.push(Buffer.from(chunk));
    });
    running.stdout?.once("error", () => {
      terminateChild(running);
      finish(new SocialMediaClipAnalysisFailedError());
    });
    running.once("close", (code) => {
      if (code === 0) finish(undefined, Buffer.concat(output));
      else finish(new SocialMediaClipAnalysisFailedError());
    });
  });
}

function runSignalProcess(input: {
  executable: string;
  args: string[];
  hasVideo: boolean;
}): Promise<SocialMediaClipSignals> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess | null = null;
    let settled = false;
    let audioByteCount = 0;
    let visualByteCount = 0;
    let timeout: NodeJS.Timeout | null = null;
    const signals = createClipSignalAccumulators();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(signals.finish());
    };
    try {
      child = spawn(input.executable, input.args, {
        ...childProcessOptions(),
        stdio: input.hasVideo ? ["ignore", "pipe", "ignore", "pipe"] : ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      finish(
        isErrnoError(error) && error.code === "ENOENT"
          ? new SocialMediaClipAnalysisToolUnavailableError("ffmpeg")
          : new SocialMediaClipAnalysisFailedError(),
      );
      return;
    }
    const running = child;
    timeout = setTimeout(() => {
      terminateChild(running);
      finish(new SocialMediaClipAnalysisFailedError());
    }, PROCESS_TIMEOUT_MS);
    running.once("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new SocialMediaClipAnalysisToolUnavailableError("ffmpeg")
          : new SocialMediaClipAnalysisFailedError(),
      );
    });
    running.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      audioByteCount += chunk.byteLength;
      if (audioByteCount > MAX_AUDIO_OUTPUT_BYTES) {
        terminateChild(running);
        finish(new SocialMediaClipAnalysisFailedError());
        return;
      }
      signals.onAudioChunk(chunk);
    });
    running.stdout?.once("error", () => {
      terminateChild(running);
      finish(new SocialMediaClipAnalysisFailedError());
    });
    const videoPipe = running.stdio[3];
    if (input.hasVideo && videoPipe && typeof videoPipe !== "string") {
      (videoPipe as Readable).on("data", (chunk: Buffer) => {
        if (settled) return;
        visualByteCount += chunk.byteLength;
        if (visualByteCount > MAX_VISUAL_OUTPUT_BYTES) {
          terminateChild(running);
          finish(new SocialMediaClipAnalysisFailedError());
          return;
        }
        signals.onVisualChunk(chunk);
      });
      (videoPipe as Readable).once("error", () => {
        terminateChild(running);
        finish(new SocialMediaClipAnalysisFailedError());
      });
    }
    running.once("close", (code) => {
      if (code === 0) finish();
      else finish(new SocialMediaClipAnalysisFailedError());
    });
  });
}

export function createFfmpegClipSignalAnalyzer(
  options: FfmpegClipSignalAnalyzerOptions = {},
): SocialMediaClipSignalAnalyzer {
  const ffmpegExecutable = options.ffmpegExecutablePath?.trim() || "ffmpeg";
  const ffprobeExecutable = options.ffprobeExecutablePath?.trim() || "ffprobe";
  return {
    async analyze(input) {
      const probeBytes = await collectProcessOutput({
        executable: ffprobeExecutable,
        args: buildFfprobeClipAnalysisArgs(input.mediaPath),
        tool: "ffprobe",
        timeoutMs: 15_000,
        maximumBytes: MAX_PROBE_OUTPUT_BYTES,
      });
      const metadata = parseFfprobeClipAnalysisOutput(probeBytes.toString("utf8"));
      if (!metadata.hasAudio) return { available: false, reason: "audio-unavailable" };
      if (metadata.durationSeconds > MAX_CLIP_ANALYSIS_DURATION_SECONDS) {
        return { available: false, reason: "duration-out-of-range" };
      }
      const hasVideo = input.hasVideo && metadata.hasVideo;
      const signals = await runSignalProcess({
        executable: ffmpegExecutable,
        args: buildFfmpegClipAnalysisArgs({ mediaPath: input.mediaPath, hasVideo }),
        hasVideo,
      });
      if (!signals.audioWindows.length) return { available: false, reason: "audio-unavailable" };
      signals.durationSeconds = Math.min(metadata.durationSeconds, signals.durationSeconds);
      return { available: true, signals };
    },
  };
}
