import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveYtDlpReleasePlan } from "../../../scripts/social-media-tools-config.mjs";
import { prepareSocialMediaTools } from "./prepare-social-media-tools.mjs";

test("yt-dlp release plan covers the six supported desktop targets with pinned official assets", () => {
  const expected = {
    "darwin-arm64": "yt-dlp_macos",
    "darwin-x64": "yt-dlp_macos",
    "linux-arm64": "yt-dlp_linux_aarch64",
    "linux-x64": "yt-dlp_linux",
    "win32-arm64": "yt-dlp_arm64.exe",
    "win32-x64": "yt-dlp.exe",
  };

  for (const [platformKey, assetName] of Object.entries(expected)) {
    const [platform, arch] = platformKey.split("-");
    const plan = resolveYtDlpReleasePlan({ platform, arch });
    assert.equal(plan.version, "2026.08.19");
    assert.equal(plan.platformKey, platformKey);
    assert.equal(plan.assetName, assetName);
    assert.match(plan.sourceUrl, /^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\//);
    assert.match(plan.sha256, /^[a-f0-9]{64}$/);
    assert.ok(plan.sizeBytes > 1_000_000);
  }
});

test("preparation rejects an asset with an incorrect pinned checksum and leaves no executable staged", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "social-harness-ytdlp-test-"));
  const plan = resolveYtDlpReleasePlan({ platform: "linux", arch: "x64" });
  try {
    await assert.rejects(
      prepareSocialMediaTools({
        platform: "linux",
        arch: "x64",
        outputRoot,
        fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      }),
      /checksum mismatch/,
    );
    await assert.rejects(readFile(join(outputRoot, plan.platformKey, "yt-dlp", plan.binaryName)));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
