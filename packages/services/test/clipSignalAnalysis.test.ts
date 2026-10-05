import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFfmpegClipAnalysisArgs,
  buildFfprobeClipAnalysisArgs,
  createClipSignalAccumulators,
} from "../src/social-media/adapters/clipSignalAnalysis.js";
import { parseFfprobeClipAnalysisOutput } from "../src/social-media/adapters/ffmpegClipSignalAnalyzer.js";

test("clip analysis commands pass media paths as arguments and sample bounded streams", () => {
  const path = "/private/social harness/original video.mp4";
  const probeArgs = buildFfprobeClipAnalysisArgs(path);
  const ffmpegArgs = buildFfmpegClipAnalysisArgs({ mediaPath: path, hasVideo: true });
  assert.equal(probeArgs.at(-1), path);
  assert.equal(ffmpegArgs.includes(path), true);
  assert.ok(ffmpegArgs.includes("pipe:1"));
  assert.ok(ffmpegArgs.includes("pipe:3"));
  assert.ok(ffmpegArgs.includes("fps=1/2,scale=32:18:flags=area,format=gray"));
});

test("ffprobe output is reduced to validated media duration and stream presence", () => {
  assert.deepEqual(
    parseFfprobeClipAnalysisOutput(
      JSON.stringify({
        format: { duration: "120.5" },
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      }),
    ),
    { durationSeconds: 120.5, hasAudio: true, hasVideo: true },
  );
  assert.throws(() => parseFfprobeClipAnalysisOutput("not json"));
  assert.throws(() => parseFfprobeClipAnalysisOutput('{"format":{"duration":"N/A"}}'));
});

test("signal accumulators handle arbitrary stream chunking and sparse frame changes", () => {
  const seconds = 20;
  const samples = new Float32Array(4_000 * seconds);
  for (let index = 0; index < samples.length; index += 1) {
    const atSeconds = index / 4_000;
    const envelope = atSeconds % 0.5 < 0.14 ? 0.8 : 0.08;
    samples[index] = envelope * Math.sin((2 * Math.PI * 220 * index) / 4_000);
  }
  const pcm = Buffer.from(samples.buffer);
  const accumulators = createClipSignalAccumulators();
  for (let offset = 0; offset < pcm.length; offset += 337) {
    accumulators.onAudioChunk(pcm.subarray(offset, Math.min(offset + 337, pcm.length)));
  }

  const frameBytes = 32 * 18;
  const first = Buffer.alloc(frameBytes, 0);
  const second = Buffer.alloc(frameBytes, 255);
  const third = Buffer.alloc(frameBytes, 255);
  const frames = Buffer.concat([first, second, third]);
  for (let offset = 0; offset < frames.length; offset += 211) {
    accumulators.onVisualChunk(frames.subarray(offset, Math.min(offset + 211, frames.length)));
  }

  const result = accumulators.finish();
  assert.equal(result.durationSeconds, seconds);
  assert.ok(result.peakAudioRms > 0.01);
  assert.equal(result.audioWindows.length, seconds);
  assert.ok(result.audioWindows.some((window) => window.energy === 1));
  assert.ok(result.rhythm && result.rhythm.bpm >= 115 && result.rhythm.bpm <= 125);
  assert.deepEqual(result.visualSamples, [{ atSeconds: 2, changeScore: 1 }]);
});
