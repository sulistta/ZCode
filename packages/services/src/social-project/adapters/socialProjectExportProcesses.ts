import { spawn, type ChildProcess } from "node:child_process";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../../process/processTreeTerminator.js";
import { SocialProjectExportRenderError } from "../app/errors.js";

const FFPROBE_TIMEOUT_MS = 20_000;
const PROCESS_FORCE_KILL_MS = 1_000;
const MAX_PROBE_OUTPUT_BYTES = 128 * 1024;

interface ProcessResult {
  stdout: string;
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

function terminateChild(child: ChildProcess, startedAt: number): Promise<void> {
  if (child.pid == null || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return terminateProcessTreeAndWait(child, {
    ...(shouldSpawnInDetachedProcessGroup() ? { ownedProcessGroupId: child.pid } : {}),
    ownedProcessStartedAtMs: startedAt,
    forceAfterMs: PROCESS_FORCE_KILL_MS,
    waitAfterForceMs: PROCESS_FORCE_KILL_MS,
  }).then(() => undefined);
}

export function runSocialProjectExportProcess(input: {
  executable: string;
  args: string[];
  signal?: AbortSignal;
  timeoutMs: number;
  maximumOutputBytes: number;
  onProgress?: (stdoutLine: string) => void;
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new SocialProjectExportRenderError("render-failed"));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(input.executable, input.args, {
        ...childProcessOptions(),
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      reject(new SocialProjectExportRenderError("renderer-unavailable"));
      return;
    }
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    let stdoutBytes = 0;
    let stdout = "";
    let lineBuffer = "";
    let termination = Promise.resolve();
    const timeout = setTimeout(() => {
      timedOut = true;
      termination = terminateChild(child, startedAt);
    }, input.timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve({ stdout });
    };
    const abort = () => {
      termination = terminateChild(child, startedAt);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(
        new SocialProjectExportRenderError(
          error.code === "ENOENT" ? "renderer-unavailable" : "render-failed",
        ),
      );
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || overflowed) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > input.maximumOutputBytes) {
        overflowed = true;
        termination = terminateChild(child, startedAt);
        return;
      }
      const text = chunk.toString("utf8");
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) input.onProgress?.(line);
    });
    child.stdout?.once("error", () => {
      termination = terminateChild(child, startedAt);
      finish(new SocialProjectExportRenderError("render-failed"));
    });
    child.stderr?.resume();
    child.once("close", async (code) => {
      await termination;
      if (input.signal?.aborted) {
        finish(new SocialProjectExportRenderError("render-failed"));
      } else if (timedOut || overflowed || code !== 0) {
        finish(new SocialProjectExportRenderError("render-failed"));
      } else {
        finish();
      }
    });
  });
}

export function parseSocialProjectExportProgress(line: string, durationMs: number): number | null {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  if (!match) return null;
  const timeMs = Number(match[1]) / 1000;
  if (!Number.isFinite(timeMs)) return null;
  return Math.max(0, Math.min(99, Math.floor((timeMs / durationMs) * 100)));
}

export async function probeSocialProjectExportMedia(input: {
  executable: string;
  path: string;
  signal?: AbortSignal;
}): Promise<{ durationMs: number; hasAudio: boolean; hasVideo: boolean }> {
  const result = await runSocialProjectExportProcess({
    executable: input.executable,
    args: [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      input.path,
    ],
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: FFPROBE_TIMEOUT_MS,
    maximumOutputBytes: MAX_PROBE_OUTPUT_BYTES,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new SocialProjectExportRenderError("invalid-media");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SocialProjectExportRenderError("invalid-media");
  }
  const value = parsed as { format?: { duration?: unknown }; streams?: unknown };
  const duration = Number(value.format?.duration);
  const streams = Array.isArray(value.streams) ? value.streams : [];
  const streamTypes = streams.flatMap((stream) =>
    typeof stream === "object" && stream !== null && "codec_type" in stream
      ? [(stream as { codec_type?: unknown }).codec_type]
      : [],
  );
  return {
    durationMs: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0,
    hasAudio: streamTypes.includes("audio"),
    hasVideo: streamTypes.includes("video"),
  };
}
