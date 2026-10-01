import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createFfmpegClipSignalAnalyzer } from "../src/social-media/adapters/ffmpegClipSignalAnalyzer.js";

const mediaToolsAvailable =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

test(
  "FFmpeg analysis extracts audio windows and sparse visual changes from a managed-style source",
  { skip: !mediaToolsAvailable },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "social-media-clip-signal-"));
    try {
      const mediaPath = join(root, "source.mkv");
      await promisify(execFile)("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x36:r=1:d=10",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=64x36:r=1:d=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=20",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        mediaPath,
      ]);

      const result = await createFfmpegClipSignalAnalyzer().analyze({ mediaPath, hasVideo: true });
      assert.equal(result.available, true);
      if (!result.available) return;
      assert.equal(result.signals.durationSeconds, 20);
      assert.equal(result.signals.audioWindows.length, 20);
      assert.ok(
        result.signals.visualSamples.some(
          (sample) => sample.atSeconds === 10 && sample.changeScore > 0.9,
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
