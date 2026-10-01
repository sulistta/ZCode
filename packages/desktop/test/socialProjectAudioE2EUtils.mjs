import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function decodeAudioSegment(
  executable,
  inputPath,
  startSeconds,
  durationSeconds,
  sampleRate,
) {
  const result = spawnSync(
    executable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ss",
      String(Math.max(0, startSeconds)),
      "-t",
      String(durationSeconds),
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  const bytes = result.stdout;
  assert.equal(bytes.length % 4, 0, "FFmpeg should return complete float32 audio samples");
  const samples = new Float32Array(bytes.length / 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readFloatLE(index * 4);
  }
  return samples;
}

export function measureToneAmplitude(samples, sampleRate, frequency) {
  assert.ok(
    samples.length > sampleRate / frequency,
    "Audio sample should contain several tone periods",
  );
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = (2 * Math.PI * frequency * index) / sampleRate;
    real += samples[index] * Math.cos(angle);
    imaginary -= samples[index] * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / samples.length;
}
