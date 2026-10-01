import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveWhisperCppBuildPlan } from "../../../scripts/social-media-tools-config.mjs";
import { buildWhisperCppConfigureArgs, prepareWhisperRuntime } from "./prepare-whisper-runtime.mjs";

test("Whisper build plan pins the official source and covers all desktop targets", () => {
  for (const platformKey of [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win32-arm64",
    "win32-x64",
  ]) {
    const [platform, arch] = platformKey.split("-");
    const plan = resolveWhisperCppBuildPlan({ platform, arch });
    assert.equal(plan.platformKey, platformKey);
    assert.equal(plan.version, "1.9.4");
    assert.equal(plan.platform === "win32", plan.binaryName.endsWith(".exe"));
    assert.equal(plan.sourceSizeBytes, 9_353_438);
    assert.match(plan.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(plan.sourceUrl, /ggml-org\/whisper\.cpp\/archive\/refs\/tags\/v1\.9\.4\.tar\.gz$/);
  }
});

test("Whisper build is static and disables nonportable CPU/GPU acceleration", () => {
  const args = buildWhisperCppConfigureArgs("/tmp/source", "/tmp/build");
  for (const option of [
    "-DBUILD_SHARED_LIBS=OFF",
    "-DGGML_STATIC=ON",
    "-DWHISPER_BUILD_IS_DEV=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DGGML_NATIVE=OFF",
    "-DGGML_AVX2=OFF",
    "-DGGML_METAL=OFF",
    "-DGGML_CUDA=OFF",
    "-DGGML_VULKAN=OFF",
  ]) {
    assert.ok(args.includes(option), `missing CMake option ${option}`);
  }
});

test("preparation rejects an unpinned source archive before invoking CMake", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "social-harness-whisper-test-"));
  const cmakeCalls = [];
  try {
    await assert.rejects(
      prepareWhisperRuntime({
        platform: "linux",
        arch: "x64",
        outputRoot,
        fetchImpl: async () => new Response(Buffer.from("not the pinned archive"), { status: 200 }),
        runCommandImpl: (...args) => cmakeCalls.push(args),
      }),
      /source archive checksum mismatch/,
    );
    assert.equal(cmakeCalls.length, 0);
    await assert.rejects(access(join(outputRoot, "linux-x64", "whisper.cpp", "whisper-cli")));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
