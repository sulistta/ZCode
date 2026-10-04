import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveFfmpegReleasePlan } from "../../../scripts/social-media-tools-config.mjs";
import {
  FFMPEG_RUNTIME_SMOKE_FIXTURE,
  ffmpegSourceProvenanceMatches,
  hasPassingFfmpegRuntimeSmoke,
  parseFfmpegRuntimeSmokeProbe,
} from "./ffmpeg-runtime-assets.mjs";
import { prepareFfmpegRuntime } from "./prepare-ffmpeg-runtime.mjs";

test("FFmpeg GPL release plans pin all six targets and require the libx264 build family", () => {
  for (const [platform, arch] of [
    ["darwin", "x64"],
    ["darwin", "arm64"],
    ["linux", "x64"],
    ["linux", "arm64"],
    ["win32", "x64"],
    ["win32", "arm64"],
  ]) {
    const plan = resolveFfmpegReleasePlan({ platform, arch });
    assert.equal(plan.version, "9.0.1");
    assert.equal(plan.platformKey, `${platform}-${arch}`);
    assert.ok(plan.assets.length > 0);
    assert.equal(plan.variant.startsWith("gpl"), true);
    assert.match(plan.expectedVersionPrefix, /9\.0\.1/);
    assert.match(plan.ffmpegSourceCommit, /^[a-f0-9]{40}$/);
    assert.match(plan.buildScriptSource.revision, /^[a-f0-9]{40}$/);
    assert.match(plan.buildScriptSource.revisionUrl, /^https:\/\//);
    assert.match(plan.buildScriptSource.sourceArchiveUrl, /^https:\/\//);
    assert.ok(plan.buildScriptSource.sourceArchiveSizeBytes > 10_000);
    assert.match(plan.buildScriptSource.sourceArchiveSha256, /^[a-f0-9]{64}$/);
    for (const asset of plan.assets) {
      assert.match(asset.url, /^https:\/\//);
      assert.ok(asset.sizeBytes > 1_000_000);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }
    if (platform === "linux" || platform === "win32") {
      assert.equal(plan.provider, "BtbN FFmpeg-Builds");
      assert.equal(plan.variant, "gpl-shared");
      assert.equal(plan.buildScriptSource.revisionStatus, "release-tagged");
    } else {
      assert.equal(plan.provider, "Martin Riedl FFmpeg Build Server");
      assert.equal(plan.variant, "gpl-static");
      assert.equal(plan.buildScriptSource.revisionStatus, "candidate-unverified");
    }
  }
});

test("FFmpeg provenance validation reads the manifest's explicit source and build-script revisions", () => {
  const plan = resolveFfmpegReleasePlan({ platform: "linux", arch: "x64" });
  assert.equal(
    ffmpegSourceProvenanceMatches(
      {
        ffmpegSourceCommit: plan.ffmpegSourceCommit,
        buildScriptSource: plan.buildScriptSource,
      },
      plan,
    ),
    true,
  );
  assert.equal(
    ffmpegSourceProvenanceMatches(
      {
        sourceCommit: plan.ffmpegSourceCommit,
        buildScriptSource: plan.buildScriptSource,
      },
      plan,
    ),
    false,
  );
  assert.equal(
    ffmpegSourceProvenanceMatches(
      {
        ffmpegSourceCommit: plan.ffmpegSourceCommit,
        buildScriptSource: { ...plan.buildScriptSource, revision: "unverified" },
      },
      plan,
    ),
    false,
  );
});

test("FFmpeg runtime smoke accepts only a probed six-frame H.264 MP4 fixture", () => {
  const observed = parseFfmpegRuntimeSmokeProbe(
    JSON.stringify({
      streams: [{ codec_name: "h264", width: 64, height: 64, nb_frames: "6" }],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    }),
  );
  const smoke = {
    status: "passed",
    fixture: FFMPEG_RUNTIME_SMOKE_FIXTURE,
    observed,
  };
  assert.deepEqual(observed, {
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    codecName: "h264",
    width: 64,
    height: 64,
    frameCount: 6,
  });
  assert.equal(hasPassingFfmpegRuntimeSmoke(smoke), true);
  assert.equal(hasPassingFfmpegRuntimeSmoke({ ...smoke, status: "failed" }), false);
  assert.equal(
    hasPassingFfmpegRuntimeSmoke({
      ...smoke,
      observed: { ...observed, codecName: "mpeg4" },
    }),
    false,
  );
  assert.throws(
    () => parseFfmpegRuntimeSmokeProbe(JSON.stringify({ streams: [], format: {} })),
    /expected H\.264 MP4 fixture/u,
  );
  assert.throws(() => parseFfmpegRuntimeSmokeProbe("not json"), /invalid ffprobe JSON/u);
});

test("preparation rejects a corrupt pinned FFmpeg archive before writing a runtime", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "social-harness-ffmpeg-test-"));
  const plan = resolveFfmpegReleasePlan({ platform: process.platform, arch: process.arch });
  try {
    await assert.rejects(
      prepareFfmpegRuntime({
        platform: process.platform,
        arch: process.arch,
        outputRoot,
        fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      }),
      /checksum mismatch/,
    );
    await assert.rejects(readdir(join(outputRoot, plan.platformKey, "ffmpeg")));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
