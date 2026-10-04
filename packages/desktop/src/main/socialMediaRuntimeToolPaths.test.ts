import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getSocialMediaRuntimeToolLayout,
  resolveSocialMediaRuntimeToolPath,
  resolveYtDlpBinaryPath,
} from "./socialMediaRuntimeToolPaths.js";

test("staged FFmpeg executables use the prepared archive's bin directory", () => {
  assert.deepEqual(getSocialMediaRuntimeToolLayout("ffmpeg"), {
    directory: "ffmpeg",
    binaryName: "bin/ffmpeg",
  });
  assert.deepEqual(getSocialMediaRuntimeToolLayout("ffprobe"), {
    directory: "ffmpeg",
    binaryName: "bin/ffprobe",
  });
});

test("packaged yt-dlp resolution prefers the bundled executable over a development override", () => {
  assert.equal(
    resolveYtDlpBinaryPath({
      packaged: true,
      platform: "linux",
      resourcesPath: "/application/resources",
      bundledPath: "/application/resources/tools/yt-dlp/yt-dlp",
      explicitPath: "/usr/local/bin/yt-dlp",
    }),
    "/application/resources/tools/yt-dlp/yt-dlp",
  );
});

test("packaged yt-dlp resolution returns its fixed resources path when the binary is missing", () => {
  assert.equal(
    resolveYtDlpBinaryPath({
      packaged: true,
      platform: "win32",
      resourcesPath: "C:\\SocialHarness\\resources",
      explicitPath: "C:\\Users\\vitor\\yt-dlp.exe",
    }),
    join("C:\\SocialHarness\\resources", "tools", "yt-dlp", "yt-dlp.exe"),
  );
});

test("development uses an explicit yt-dlp override only when it exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-harness-ytdlp-path-test-"));
  const binaryPath = join(directory, "yt-dlp");
  try {
    assert.equal(
      resolveYtDlpBinaryPath({
        packaged: false,
        platform: "linux",
        explicitPath: binaryPath,
      }),
      undefined,
    );
    await writeFile(binaryPath, "fixture");
    assert.equal(
      resolveYtDlpBinaryPath({
        packaged: false,
        platform: "linux",
        explicitPath: binaryPath,
      }),
      binaryPath,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("development yt-dlp overrides take precedence over a bundled local binary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-harness-ytdlp-override-test-"));
  const overridePath = join(directory, "fake-yt-dlp.mjs");
  const bundledPath = join(directory, "bundled-yt-dlp");
  try {
    await writeFile(overridePath, "fixture");
    assert.equal(
      resolveYtDlpBinaryPath({
        packaged: false,
        platform: "linux",
        bundledPath,
        explicitPath: overridePath,
      }),
      overridePath,
    );
    assert.equal(
      resolveYtDlpBinaryPath({
        packaged: false,
        platform: "linux",
        bundledPath,
      }),
      bundledPath,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("packaged Whisper resolution uses its fixed resources path without a PATH fallback", () => {
  assert.equal(
    resolveSocialMediaRuntimeToolPath({
      tool: "whisper.cpp",
      packaged: true,
      platform: "linux",
      resourcesPath: "/application/resources",
      explicitPath: "/usr/local/bin/whisper-cli",
    }),
    join("/application/resources", "tools", "whisper.cpp", "whisper-cli"),
  );
});

test("packaged FFmpeg tools resolve to platform-specific executable names", () => {
  assert.equal(
    resolveSocialMediaRuntimeToolPath({
      tool: "ffmpeg",
      packaged: true,
      platform: "win32",
      resourcesPath: "C:\\SocialHarness\\resources",
    }),
    join("C:\\SocialHarness\\resources", "tools", "ffmpeg", "bin", "ffmpeg.exe"),
  );
  assert.equal(
    resolveSocialMediaRuntimeToolPath({
      tool: "ffprobe",
      packaged: true,
      platform: "darwin",
      resourcesPath: "/Applications/Social Harness.app/Contents/Resources",
    }),
    join(
      "/Applications/Social Harness.app/Contents/Resources",
      "tools",
      "ffmpeg",
      "bin",
      "ffprobe",
    ),
  );
});
