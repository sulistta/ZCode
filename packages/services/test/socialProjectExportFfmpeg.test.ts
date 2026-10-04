import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getSocialProjectClipTransform,
  getSocialProjectClipTransitionOpacity,
} from "@social-harness/opencut-core";
import { socialProjectSchema } from "@social-harness/shared";
import type { SocialMediaAsset } from "../src/social-media/contract.js";
import { buildSocialProjectExportGraph } from "../src/social-project/adapters/socialProjectExportPlan.js";
import { createSocialProjectExportFfmpegRenderer } from "../src/social-project/adapters/socialProjectExportFfmpeg.js";
import { SocialProjectExportRenderError } from "../src/social-project/app/errors.js";
import {
  probeSocialProjectExportMedia,
  runSocialProjectExportProcess,
} from "../src/social-project/adapters/socialProjectExportProcesses.js";

const ffmpegExecutable = process.env.SOCIAL_HARNESS_FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobeExecutable = process.env.SOCIAL_HARNESS_FFPROBE_PATH?.trim() || "ffprobe";
const ffmpegAvailable = spawnSync(ffmpegExecutable, ["-version"], { stdio: "ignore" }).status === 0;
const ffprobeAvailable =
  spawnSync(ffprobeExecutable, ["-version"], { stdio: "ignore" }).status === 0;

test("captures bounded render diagnostics when explicitly enabled for tests", async () => {
  const result = runSocialProjectExportProcess({
    executable: process.execPath,
    args: ["-e", "process.stderr.write('x'.repeat(20000)); process.exitCode = 2"],
    timeoutMs: 5_000,
    maximumOutputBytes: 1_024,
    diagnosticsEnabled: true,
  });

  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof SocialProjectExportRenderError);
    assert.equal(error.code, "render-failed");
    assert.equal(error.message, "render-failed");
    assert.equal(error.diagnostic?.length, 8 * 1024);
    assert.equal(error.diagnostic, "x".repeat(8 * 1024));
    return true;
  });
});

test("does not retain renderer stderr when diagnostics are disabled", async () => {
  const result = runSocialProjectExportProcess({
    executable: process.execPath,
    args: ["-e", "process.stderr.write('private-path'); process.exitCode = 2"],
    timeoutMs: 5_000,
    maximumOutputBytes: 1_024,
    diagnosticsEnabled: false,
  });

  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof SocialProjectExportRenderError);
    assert.equal(error.code, "render-failed");
    assert.equal(error.diagnostic, undefined);
    return true;
  });
});

function createMediaAsset(
  mediaId: string,
  mediaKind: SocialMediaAsset["mediaKind"],
): SocialMediaAsset {
  const extension = mediaKind === "video" ? ".mp4" : mediaKind === "audio" ? ".wav" : ".ppm";
  return {
    mediaId,
    accountId: "account-parity",
    sourceKind: "local-file",
    originalName: `${mediaId}${extension}`,
    mediaKind,
    extension,
    mimeType:
      mediaKind === "video"
        ? "video/mp4"
        : mediaKind === "audio"
          ? "audio/wav"
          : "image/x-portable-pixmap",
    sizeBytes: 1,
    sha256: "b".repeat(64),
    importedAt: 1,
  };
}

function decodeFrames(path: string): Buffer {
  const result = spawnSync(
    ffmpegExecutable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function probeExportEncoding(path: string) {
  const result = spawnSync(
    ffprobeExecutable,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name:stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,sample_rate",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    format?: { format_name?: string };
    streams?: Array<Record<string, unknown>>;
  };
}

function assertInstagramReelEncoding(path: string) {
  const output = probeExportEncoding(path);
  assert.match(output.format?.format_name ?? "", /mp4/u);
  const video = output.streams?.find((stream) => stream.codec_type === "video");
  const audio = output.streams?.find((stream) => stream.codec_type === "audio");
  assert.ok(video);
  assert.ok(audio);
  assert.equal(video.codec_name, "h264");
  assert.ok(Number(video.width) <= 1920);
  assert.ok(Number(video.height) <= 1920);
  const [frameRateNumerator, frameRateDenominator] = String(video.r_frame_rate)
    .split("/")
    .map(Number);
  const frameRate = frameRateNumerator! / frameRateDenominator!;
  assert.ok(frameRate >= 23 && frameRate <= 60, `Unexpected output frame rate ${frameRate}`);
  assert.ok(Number(video.bit_rate) <= 25_000_000);
  assert.equal(audio.codec_name, "aac");
  assert.equal(audio.sample_rate, "48000");
  assert.ok(Number(audio.bit_rate) <= 128_000, `AAC bitrate exceeded the limit: ${audio.bit_rate}`);
}

function getFrame(frames: Buffer, frameIndex: number): Buffer {
  const frameLength = 64 * 64 * 3;
  assert.equal(frames.length % frameLength, 0, "Decoded video must contain complete RGB frames");
  const start = frameIndex * frameLength;
  assert.ok(start + frameLength <= frames.length, `Missing frame ${frameIndex}`);
  return frames.subarray(start, start + frameLength);
}

function analyzeRedRegion(frame: Buffer) {
  const points: Array<{ x: number; y: number; red: number }> = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 3;
      const red = frame[offset]!;
      const green = frame[offset + 1]!;
      const blue = frame[offset + 2]!;
      if (red > 65 && red > green * 1.6 && red > blue * 1.6) points.push({ x, y, red });
    }
  }
  assert.ok(points.length > 0, "The transformed red source region should remain visible");
  return {
    count: points.length,
    centerX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    centerY: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    width: Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)) + 1,
    height: Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)) + 1,
    meanRed: points.reduce((sum, point) => sum + point.red, 0) / points.length,
  };
}

function countPixels(
  frame: Buffer,
  matches: (red: number, green: number, blue: number, x: number, y: number) => boolean,
) {
  let count = 0;
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 3;
      if (matches(frame[offset]!, frame[offset + 1]!, frame[offset + 2]!, x, y)) count += 1;
    }
  }
  return count;
}

function getPixelBounds(
  frame: Buffer,
  matches: (red: number, green: number, blue: number, x: number, y: number) => boolean,
) {
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 3;
      if (matches(frame[offset]!, frame[offset + 1]!, frame[offset + 2]!, x, y))
        points.push({ x, y });
    }
  }
  return {
    count: points.length,
    minX: points.length ? Math.min(...points.map(({ x }) => x)) : undefined,
    maxX: points.length ? Math.max(...points.map(({ x }) => x)) : undefined,
    minY: points.length ? Math.min(...points.map(({ y }) => y)) : undefined,
    maxY: points.length ? Math.max(...points.map(({ y }) => y)) : undefined,
  };
}

function decodeMonoAudio(path: string): Float32Array {
  const result = spawnSync(
    ffmpegExecutable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.length % 4, 0);
  const samples = new Float32Array(result.stdout.length / 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = result.stdout.readFloatLE(index * 4);
  }
  return samples;
}

function toneAmplitude(
  samples: Float32Array,
  startSeconds: number,
  durationSeconds: number,
  frequency: number,
): number {
  const start = Math.round(startSeconds * 48_000);
  const length = Math.round(durationSeconds * 48_000);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < length; index += 1) {
    const angle = (2 * Math.PI * frequency * index) / 48_000;
    const value = samples[start + index]!;
    real += value * Math.cos(angle);
    imaginary -= value * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / length;
}

function closeTo(actual: number, expected: number, tolerance: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function createVideoProject(clipOverrides: Record<string, unknown> = {}) {
  const clip = {
    clipId: "clip-neutral",
    kind: "video",
    mediaId: "media-neutral",
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
    ...clipOverrides,
  };
  return socialProjectSchema.parse({
    projectId: "project-neutral",
    accountId: "account-neutral",
    displayName: "Identity appearance graph fixture",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    editControlOwner: "user",
    settings: {
      width: 64,
      height: 64,
      frameRate: { numerator: 24, denominator: 1 },
      backgroundColor: "#000000",
    },
    tracks: [
      {
        trackId: "track-neutral",
        name: "Video",
        type: "video",
        muted: false,
        hidden: false,
        clips: [clip],
      },
    ],
  });
}

function createTextProject() {
  const project = createVideoProject();
  return socialProjectSchema.parse({
    ...project,
    projectId: "project-text-path",
    displayName: "Windows text path graph fixture",
    tracks: [
      {
        trackId: "track-text-path",
        name: "Captions",
        type: "text",
        muted: false,
        hidden: false,
        clips: [
          {
            clipId: "clip-text-path",
            kind: "text",
            timelineStartMs: 0,
            durationMs: 1000,
            text: "Social Harness",
            style: {
              fontFamily: "DejaVu Sans",
              fontSize: 12,
              color: "#ffffff",
              alignment: "center",
            },
            keyframes: [],
          },
        ],
      },
    ],
  });
}

function buildVideoGraph(clipOverrides: Record<string, unknown> = {}) {
  return buildSocialProjectExportGraph({
    project: createVideoProject(clipOverrides),
    inputIndexByClipId: new Map([["clip-neutral", 1]]),
    textFileByClipId: new Map(),
    clipsWithAudio: new Set(),
  });
}

test("FFmpeg text paths escape a Windows drive colon only once", () => {
  const graph = buildSocialProjectExportGraph({
    project: createTextProject(),
    inputIndexByClipId: new Map([["clip-text-path", 1]]),
    textFileByClipId: new Map([["clip-text-path", "D:\\social-harness\\caption%1.txt"]]),
    clipsWithAudio: new Set(),
  });

  assert.ok(
    graph.filterComplex.includes("textfile='D\\:/social-harness/caption\\%1.txt'"),
    graph.filterComplex,
  );
});

test("FFmpeg graph skips per-pixel sampling for identity media appearance only", () => {
  const neutralGraph = buildVideoGraph({
    keyframes: [
      {
        keyframeId: "volume-only",
        timeMs: 0,
        property: "volume",
        value: 1,
        easing: "linear",
      },
    ],
  });
  assert.doesNotMatch(neutralGraph.filterComplex, /geq=/);
  assert.match(neutralGraph.filterComplex, /trim=duration=1/);
  assert.match(neutralGraph.filterComplex, /scale=64:64/);

  const changedAppearances: Array<[string, Record<string, unknown>]> = [
    ["transform", { transform: { x: 1, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }],
    ["transition", { transitionIn: { kind: "fade", durationMs: 100 } }],
    [
      "visual keyframe",
      {
        keyframes: [{ keyframeId: "x", timeMs: 0, property: "x", value: 0, easing: "linear" }],
      },
    ],
    [
      "color adjustment",
      { colorAdjustments: { brightness: 0.1, contrast: 1, saturation: 1, hue: 0 } },
    ],
  ];

  for (const [appearance, overrides] of changedAppearances) {
    assert.match(buildVideoGraph(overrides).filterComplex, /geq=/, `${appearance} must use geq`);
  }
});

test(
  "FFmpeg export applies shared color and transition evaluation, verifies the MP4, and creates an opaque download capability",
  { skip: !ffmpegAvailable || !ffprobeAvailable },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "social-project-export-ffmpeg-"));
    const sourcePath = join(directory, "source.mp4");
    const exportDirectory = join(directory, "exports");
    const exportId = "33333333-3333-4333-8333-333333333333";
    try {
      const fixture = spawnSync(
        ffmpegExecutable,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=64x64:r=24:d=1",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=880:sample_rate=48000:duration=1",
          "-shortest",
          "-threads",
          "1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          sourcePath,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      assert.equal(fixture.status, 0, fixture.stderr);

      const mediaAsset: SocialMediaAsset = {
        mediaId: "media-smoke",
        accountId: "account-smoke",
        sourceKind: "local-file",
        originalName: "source.mp4",
        mediaKind: "video",
        extension: ".mp4",
        mimeType: "video/mp4",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        importedAt: 1,
      };
      const project = socialProjectSchema.parse({
        projectId: "project-smoke",
        accountId: mediaAsset.accountId,
        displayName: "Smoke Reel",
        revision: 3,
        createdAt: 1,
        updatedAt: 2,
        editControlOwner: "user",
        settings: {
          width: 64,
          height: 64,
          frameRate: { numerator: 24, denominator: 1 },
          backgroundColor: "#000000",
        },
        tracks: [
          {
            trackId: "track-video",
            name: "Video",
            type: "video",
            muted: false,
            hidden: false,
            clips: [
              {
                clipId: "clip-video",
                kind: "video",
                mediaId: mediaAsset.mediaId,
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 750,
                playbackRate: 1,
                volume: 0.5,
                keyframes: [],
                colorAdjustments: { brightness: -0.1, contrast: 0.8, saturation: 0, hue: 45 },
                transitionIn: { kind: "fade", durationMs: 250 },
                transitionOut: { kind: "dissolve", durationMs: 250 },
              },
            ],
          },
        ],
      });
      let capabilityTarget = "";
      const renderer = createSocialProjectExportFfmpegRenderer({
        ffmpegExecutablePath: ffmpegExecutable,
        ffprobeExecutablePath: ffprobeExecutable,
        exportDirectory,
        resolveMediaPath: async (asset) => {
          assert.equal(asset.accountId, mediaAsset.accountId);
          return sourcePath;
        },
        async createDownloadUrl(path) {
          capabilityTarget = path;
          return {
            url: "social-harness-media://local/preview/opaque",
            expiresAt: Date.now() + 60_000,
          };
        },
      });
      const rendered = await renderer.render({
        exportId,
        project,
        mediaAssets: new Map([[mediaAsset.mediaId, mediaAsset]]),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
      assert.ok(rendered.fileSizeBytes > 0);
      assert.match(rendered.sha256, /^[\da-f]{64}$/);
      const output = await probeSocialProjectExportMedia({
        executable: ffprobeExecutable,
        path: capabilityTarget || join(exportDirectory, `${exportId}.mp4`),
      });
      assert.equal(output.hasVideo, true);
      assert.equal(output.hasAudio, true);
      assert.ok(output.durationMs >= 700 && output.durationMs <= 900);
      assertInstagramReelEncoding(capabilityTarget || join(exportDirectory, `${exportId}.mp4`));

      const samplePixel = (timeSeconds: number) => {
        const sampledPixel = spawnSync(
          ffmpegExecutable,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            join(exportDirectory, `${exportId}.mp4`),
            "-ss",
            String(timeSeconds),
            "-vf",
            "scale=1:1:flags=neighbor",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ],
          { timeout: 20_000 },
        );
        assert.equal(sampledPixel.status, 0, sampledPixel.stderr.toString());
        assert.equal(sampledPixel.stdout.length, 3);
        return [...sampledPixel.stdout] as number[];
      };
      const firstPixel = samplePixel(0);
      assert.ok(
        Math.max(...firstPixel) <= 8,
        `Incoming transition should begin at black: ${firstPixel}`,
      );
      const [red, green, blue] = samplePixel(0.35);
      assert.ok(Math.max(red!, green!, blue!) - Math.min(red!, green!, blue!) <= 8);
      assert.ok(
        Math.abs((red! + green! + blue!) / 3 - 65) <= 12,
        `Expected the shared neutralized-color result near 65, received ${red}, ${green}, ${blue}`,
      );
      const lastPixel = samplePixel(0.6);
      assert.ok(
        Math.max(...lastPixel) <= 45 && Math.max(...lastPixel) >= 16,
        `Outgoing transition should dim the clip toward black: ${lastPixel}`,
      );

      const download = await renderer.createDownloadUrl({
        exportId,
        sha256: rendered.sha256,
        fileSizeBytes: rendered.fileSizeBytes,
      });
      assert.equal(download.url, "social-harness-media://local/preview/opaque");
      assert.equal(capabilityTarget, join(exportDirectory, `${exportId}.mp4`));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "FFmpeg frames and audio follow shared preview evaluation across video, image, text, keyframes, transitions, and a mix",
  { skip: !ffmpegAvailable || !ffprobeAvailable },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "social-project-export-parity-"));
    const videoPath = join(directory, "video.mp4");
    const audioPath = join(directory, "audio.wav");
    const imagePath = join(directory, "image.ppm");
    const exportDirectory = join(directory, "exports");
    const exportId = "44444444-4444-4444-8444-444444444444";
    const videoAsset = createMediaAsset("video-parity", "video");
    const imageAsset = createMediaAsset("image-parity", "image");
    const audioAsset = createMediaAsset("audio-parity", "audio");
    try {
      const videoFixture = spawnSync(
        ffmpegExecutable,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=64x64:r=24:d=1,drawbox=x=20:y=24:w=24:h=16:color=red:t=fill",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=880:sample_rate=48000:duration=1",
          "-shortest",
          "-threads",
          "1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          videoPath,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      assert.equal(videoFixture.status, 0, videoFixture.stderr);

      const audioFixture = spawnSync(
        ffmpegExecutable,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000:duration=1",
          "-c:a",
          "pcm_s16le",
          audioPath,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      assert.equal(audioFixture.status, 0, audioFixture.stderr);

      const ppmHeader = Buffer.from("P6\n64 64\n255\n", "ascii");
      const ppm = Buffer.alloc(ppmHeader.length + 64 * 64 * 3);
      ppmHeader.copy(ppm);
      for (let offset = ppmHeader.length; offset < ppm.length; offset += 3) {
        ppm[offset] = 0;
        ppm[offset + 1] = 0;
        ppm[offset + 2] = 255;
      }
      await writeFile(imagePath, ppm);

      const project = socialProjectSchema.parse({
        projectId: "project-parity",
        accountId: videoAsset.accountId,
        displayName: "Deterministic parity fixture",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        editControlOwner: "user",
        settings: {
          width: 64,
          height: 64,
          frameRate: { numerator: 24, denominator: 1 },
          backgroundColor: "#000000",
        },
        tracks: [
          {
            trackId: "track-video-parity",
            name: "Video",
            type: "video",
            muted: false,
            hidden: false,
            clips: [
              {
                clipId: "clip-video-parity",
                kind: "video",
                mediaId: videoAsset.mediaId,
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 1000,
                playbackRate: 1,
                volume: 0.8,
                keyframes: [
                  {
                    keyframeId: "x-start",
                    timeMs: 0,
                    property: "x",
                    value: -8,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "x-end",
                    timeMs: 1000,
                    property: "x",
                    value: 8,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "y-start",
                    timeMs: 0,
                    property: "y",
                    value: -6,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "y-end",
                    timeMs: 1000,
                    property: "y",
                    value: 6,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "scale-x-start",
                    timeMs: 0,
                    property: "scaleX",
                    value: 0.75,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "scale-x-end",
                    timeMs: 1000,
                    property: "scaleX",
                    value: 1.25,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "scale-y-start",
                    timeMs: 0,
                    property: "scaleY",
                    value: 1.25,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "scale-y-end",
                    timeMs: 1000,
                    property: "scaleY",
                    value: 0.75,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "rotation-start",
                    timeMs: 0,
                    property: "rotation",
                    value: 0,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "rotation-end",
                    timeMs: 1000,
                    property: "rotation",
                    value: 90,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "opacity-start",
                    timeMs: 0,
                    property: "opacity",
                    value: 1,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "opacity-end",
                    timeMs: 1000,
                    property: "opacity",
                    value: 0.5,
                    easing: "ease-in-out",
                  },
                  {
                    keyframeId: "video-volume-start",
                    timeMs: 0,
                    property: "volume",
                    value: 0.8,
                    easing: "linear",
                  },
                  {
                    keyframeId: "video-volume-end",
                    timeMs: 1000,
                    property: "volume",
                    value: 0.2,
                    easing: "linear",
                  },
                ],
                transitionIn: { kind: "fade", durationMs: 200 },
                transitionOut: { kind: "dissolve", durationMs: 200 },
              },
            ],
          },
          {
            trackId: "track-image-parity",
            name: "Image",
            type: "video",
            muted: false,
            hidden: false,
            clips: [
              {
                clipId: "clip-image-parity",
                kind: "image",
                mediaId: imageAsset.mediaId,
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 1000,
                playbackRate: 1,
                volume: 0,
                keyframes: [],
                transform: { x: -26, y: -26, scaleX: 0.15, scaleY: 0.15, rotation: 0, opacity: 1 },
              },
            ],
          },
          {
            trackId: "track-text-parity",
            name: "Captions",
            type: "text",
            muted: false,
            hidden: false,
            clips: [
              {
                clipId: "clip-text-parity",
                kind: "text",
                timelineStartMs: 0,
                durationMs: 1000,
                text: "X",
                style: {
                  fontFamily: "DejaVu Sans",
                  fontSize: 8,
                  color: "#ffffff",
                  alignment: "center",
                },
                keyframes: [],
                transform: { x: 20, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.9 },
              },
            ],
          },
          {
            trackId: "track-audio-parity",
            name: "Audio mix",
            type: "audio",
            muted: false,
            hidden: false,
            clips: [
              {
                clipId: "clip-audio-parity",
                kind: "audio",
                mediaId: audioAsset.mediaId,
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 1000,
                playbackRate: 1,
                volume: 0.2,
                transitionIn: { kind: "fade", durationMs: 200 },
                transitionOut: { kind: "dissolve", durationMs: 200 },
                keyframes: [
                  {
                    keyframeId: "audio-volume-start",
                    timeMs: 0,
                    property: "volume",
                    value: 0.2,
                    easing: "linear",
                  },
                  {
                    keyframeId: "audio-volume-mid",
                    timeMs: 500,
                    property: "volume",
                    value: 0.6,
                    easing: "linear",
                  },
                  {
                    keyframeId: "audio-volume-end",
                    timeMs: 1000,
                    property: "volume",
                    value: 0.6,
                    easing: "linear",
                  },
                ],
              },
            ],
          },
        ],
      });

      const sourcePathByMediaId = new Map([
        [videoAsset.mediaId, videoPath],
        [imageAsset.mediaId, imagePath],
        [audioAsset.mediaId, audioPath],
      ]);
      let capabilityTarget = "";
      const renderer = createSocialProjectExportFfmpegRenderer({
        ffmpegExecutablePath: ffmpegExecutable,
        ffprobeExecutablePath: ffprobeExecutable,
        exportDirectory,
        async resolveMediaPath(asset) {
          assert.equal(asset.accountId, videoAsset.accountId);
          const path = sourcePathByMediaId.get(asset.mediaId);
          assert.ok(path, `Unexpected media asset ${asset.mediaId}`);
          return path;
        },
        async createDownloadUrl(path) {
          capabilityTarget = path;
          return {
            url: "social-harness-media://local/preview/parity",
            expiresAt: Date.now() + 60_000,
          };
        },
      });
      const rendered = await renderer.render({
        exportId,
        project,
        mediaAssets: new Map([
          [videoAsset.mediaId, videoAsset],
          [imageAsset.mediaId, imageAsset],
          [audioAsset.mediaId, audioAsset],
        ]),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
      assert.ok(rendered.fileSizeBytes > 0);
      const outputPath = join(exportDirectory, `${exportId}.mp4`);
      assert.equal(
        capabilityTarget,
        "",
        "Rendering should not create a download capability implicitly",
      );
      const output = await probeSocialProjectExportMedia({
        executable: ffprobeExecutable,
        path: outputPath,
      });
      assert.equal(output.hasVideo, true);
      assert.equal(output.hasAudio, true);
      assert.ok(output.durationMs >= 900 && output.durationMs <= 1100);

      const frames = decodeFrames(outputPath);
      const videoClip = project.tracks[0]!.clips[0]!;
      const frameIndices = [3, 15];
      for (const frameIndex of frameIndices) {
        const playheadMs = (frameIndex * 1000) / 24;
        const transform = getSocialProjectClipTransform(videoClip, playheadMs);
        const transitionOpacity = getSocialProjectClipTransitionOpacity(videoClip, playheadMs);
        const sampledFrame = getFrame(frames, frameIndex);
        const region = analyzeRedRegion(sampledFrame);
        const radians = (transform.rotation * Math.PI) / 180;
        const expectedWidth =
          Math.abs(24 * transform.scaleX * Math.cos(radians)) +
          Math.abs(16 * transform.scaleY * Math.sin(radians));
        const expectedHeight =
          Math.abs(24 * transform.scaleX * Math.sin(radians)) +
          Math.abs(16 * transform.scaleY * Math.cos(radians));
        const frameContext = JSON.stringify({ region, transform, transitionOpacity });
        closeTo(
          region.centerX,
          32 + transform.x,
          2.5,
          `Frame ${frameIndex} red-region center x ${frameContext}`,
        );
        closeTo(
          region.centerY,
          32 + transform.y,
          2.5,
          `Frame ${frameIndex} red-region center y ${frameContext}`,
        );
        closeTo(region.width, expectedWidth, 8, `Frame ${frameIndex} transformed red-region width`);
        closeTo(
          region.height,
          expectedHeight,
          8,
          `Frame ${frameIndex} transformed red-region height`,
        );
        closeTo(
          region.meanRed,
          255 * transform.opacity * transitionOpacity,
          48,
          `Frame ${frameIndex} keyframed opacity and transition`,
        );
      }
      const firstPreviewSample = getFrame(frames, frameIndices[0]!);
      const blueImagePixels = countPixels(
        firstPreviewSample,
        (red, green, blue, x, y) =>
          x < 20 && y < 20 && blue > 90 && blue > red * 1.6 && blue > green * 1.3,
      );
      assert.ok(
        blueImagePixels > 75,
        `Expected the transformed image layer, found ${blueImagePixels} blue pixels`,
      );
      const whiteCaptionPixels = getPixelBounds(
        firstPreviewSample,
        (red, green, blue) =>
          red > 70 &&
          green > 70 &&
          blue > 70 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) < 55,
      );
      assert.ok(
        whiteCaptionPixels.count > 2,
        `Expected visible caption glyphs, found ${JSON.stringify(whiteCaptionPixels)} pixels`,
      );
      assert.ok(
        whiteCaptionPixels.minX !== undefined &&
          whiteCaptionPixels.minX >= 45 &&
          whiteCaptionPixels.minY !== undefined &&
          whiteCaptionPixels.minY >= 45,
        `Caption should follow its lower-right transform, received ${JSON.stringify(whiteCaptionPixels)}`,
      );

      const samples = decodeMonoAudio(outputPath);
      const earlyVideoTone = toneAmplitude(samples, 0.2, 0.1, 880);
      const lateVideoTone = toneAmplitude(samples, 0.65, 0.1, 880);
      const earlyAudioTone = toneAmplitude(samples, 0.2, 0.1, 440);
      const lateAudioTone = toneAmplitude(samples, 0.65, 0.1, 440);
      const incomingAudioTone = toneAmplitude(samples, 0.05, 0.1, 440);
      const establishedAudioTone = toneAmplitude(samples, 0.25, 0.1, 440);
      const beforeAudioFadeOut = toneAmplitude(samples, 0.65, 0.1, 440);
      const duringAudioFadeOut = toneAmplitude(samples, 0.85, 0.1, 440);
      assert.ok(
        earlyVideoTone > 0.005 && earlyAudioTone > 0.005,
        "Both audio tracks should reach the mixed export",
      );
      const videoVolumeRatio = lateVideoTone / earlyVideoTone;
      const audioVolumeRatio = lateAudioTone / earlyAudioTone;
      const audioFadeInRatio = incomingAudioTone / establishedAudioTone;
      const audioFadeOutRatio = duringAudioFadeOut / beforeAudioFadeOut;
      assert.ok(
        videoVolumeRatio > 0.3 && videoVolumeRatio < 0.8,
        `Video-source 880 Hz level should follow its descending keyframes, received ratio ${videoVolumeRatio}`,
      );
      assert.ok(
        audioVolumeRatio > 1.3 && audioVolumeRatio < 2.2,
        `Audio-track 440 Hz level should follow its ascending keyframes, received ratio ${audioVolumeRatio}`,
      );
      assert.ok(
        audioFadeInRatio > 0.18 && audioFadeInRatio < 0.65,
        `Audio-track 440 Hz level should fade in, received ratio ${audioFadeInRatio}`,
      );
      assert.ok(
        audioFadeOutRatio > 0.4 && audioFadeOutRatio < 0.8,
        `Audio-track 440 Hz level should fade out, received ratio ${audioFadeOutRatio}`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
