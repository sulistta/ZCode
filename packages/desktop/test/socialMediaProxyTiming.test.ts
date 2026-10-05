import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFfmpegPreviewProxyRenderer } from "../../services/src/social-media/adapters/ffmpegPreviewProxyRenderer.js";
import { resolveE2EMediaTools } from "./socialHarnessAccountE2EUtils.mjs";

const execute = promisify(execFile);
const { ffmpegExecutable, ffprobeExecutable } = resolveE2EMediaTools();
const renderer = createFfmpegPreviewProxyRenderer({
  ffmpegExecutablePath: ffmpegExecutable,
  ffprobeExecutablePath: ffprobeExecutable,
});

async function run(args: string[]) {
  await execute(ffmpegExecutable, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

async function probe(path: string, entries: string) {
  const { stdout } = await execute(
    ffprobeExecutable,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "json", path],
    { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  return JSON.parse(stdout);
}

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "social-native-proxy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("real proxy preserves variable-rate frame timestamps without duplicating frames", async (t) => {
  const root = await fixture(t);
  const original = join(root, "variable-rate.mkv");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x120:r=10:d=2",
    "-vf",
    "setpts=if(lt(N\\,10)\\,N/(10*TB)\\,(N-10)/(5*TB)+1/TB)",
    "-fps_mode",
    "passthrough",
    "-c:v",
    "ffv1",
    original,
  ]);
  const bytes = await readFile(original);
  const task = renderer.start({ mediaPath: original, workingDirectory: root, onProgress() {} });
  t.after(() => task.cancel());
  const completed = await task.completion;
  const inputFrames = (await probe(original, "frame=best_effort_timestamp_time")).frames.map(
    (frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time),
  );
  const outputFrames = (
    await probe(completed.outputPath, "frame=best_effort_timestamp_time")
  ).frames.map((frame: { best_effort_timestamp_time: string }) =>
    Number(frame.best_effort_timestamp_time),
  );
  assert.equal(inputFrames.length, 20);
  assert.equal(outputFrames.length, inputFrames.length);
  for (let index = 0; index < inputFrames.length; index++)
    assert.ok(
      Math.abs(inputFrames[index] - outputFrames[index]) < 0.002,
      `Frame ${index} source timestamp changed`,
    );
  assert.deepEqual(await readFile(original), bytes);
});

test("real proxy keeps display aspect for nonsquare pixels", async (t) => {
  const root = await fixture(t);
  const original = join(root, "anamorphic.mkv");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=720x480:r=25:d=1",
    "-vf",
    "setsar=2/1",
    "-c:v",
    "ffv1",
    original,
  ]);
  const task = renderer.start({ mediaPath: original, workingDirectory: root, onProgress() {} });
  t.after(() => task.cancel());
  const { outputPath } = await task.completion;
  const stream = (await probe(outputPath, "stream=width,height,sample_aspect_ratio")).streams[0];
  assert.equal(stream.sample_aspect_ratio, "1:1");
  assert.ok(Math.abs(stream.width / stream.height - 3) < 0.01);
  assert.ok(Math.max(stream.width, stream.height) <= 1280);
});

test("real proxy preserves orientation from a source rotation matrix", async (t) => {
  const root = await fixture(t);
  const unrotated = join(root, "unrotated.mp4");
  const original = join(root, "rotated.mp4");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x240:r=25:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    unrotated,
  ]);
  // FFmpeg 9 不再通过 rotate 元数据创建矩阵；先验证输入方向，避免夹具误报代理损坏。
  await run(["-display_rotation:v:0", "90", "-i", unrotated, "-c", "copy", original]);
  const input = (await probe(original, "stream=width,height:stream_side_data=rotation")).streams[0];
  assert.equal(
    input.side_data_list?.find((data: { rotation?: number }) => data.rotation)?.rotation,
    90,
  );
  const task = renderer.start({ mediaPath: original, workingDirectory: root, onProgress() {} });
  t.after(() => task.cancel());
  const { outputPath } = await task.completion;
  const stream = (await probe(outputPath, "stream=width,height:stream_side_data=rotation"))
    .streams[0];
  assert.equal(stream.width, 240);
  assert.equal(stream.height, 320);
  assert.ok(!stream.side_data_list?.some((data: { rotation?: number }) => data.rotation));
});
