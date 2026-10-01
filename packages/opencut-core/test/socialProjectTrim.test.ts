import assert from "node:assert/strict";
import test from "node:test";
import type { SocialProjectClip } from "@social-harness/shared";
import { computeSocialProjectClipResize } from "../src/contract.js";

type VideoClip = Extract<SocialProjectClip, { kind: "video" }>;
type TextClip = Extract<SocialProjectClip, { kind: "text" }>;

function videoClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    clipId: "clip-video",
    kind: "video",
    mediaId: "media-video",
    timelineStartMs: 500,
    sourceStartMs: 1000,
    sourceEndMs: 5000,
    playbackRate: 2,
    volume: 1,
    keyframes: [],
    ...overrides,
  };
}

function textClip(overrides: Partial<TextClip> = {}): TextClip {
  return {
    clipId: "clip-text",
    kind: "text",
    timelineStartMs: 500,
    durationMs: 2000,
    text: "Caption",
    style: { fontFamily: "sans-serif", fontSize: 32, color: "#FFFFFF", alignment: "center" },
    keyframes: [],
    ...overrides,
  };
}

const frameRate = { numerator: 30, denominator: 1 };

test("OpenCut resize snaps once and maps media trim through playback rate", () => {
  const clip = videoClip();
  const originalEndMs =
    clip.timelineStartMs + (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate;
  const result = computeSocialProjectClipResize({
    clip,
    side: "left",
    deltaTimelineMs: 101,
    frameRate,
  });

  assert.equal(result.deltaTimelineMs, 100);
  assert.equal(result.clip.kind, "video");
  if (result.clip.kind !== "video") return;
  assert.equal(result.clip.timelineStartMs, 600);
  assert.equal(result.clip.sourceStartMs, 1200);
  assert.equal(result.clip.sourceEndMs, clip.sourceEndMs);
  assert.equal(
    result.clip.timelineStartMs +
      (result.clip.sourceEndMs - result.clip.sourceStartMs) / result.clip.playbackRate,
    originalEndMs,
  );
});

test("left resize clamps to source headroom and preserves the opposite edge", () => {
  const clip = videoClip({
    timelineStartMs: 1000,
    sourceStartMs: 30,
    sourceEndMs: 3030,
    playbackRate: 1,
  });
  const originalEndMs = clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs;
  const result = computeSocialProjectClipResize({
    clip,
    side: "left",
    deltaTimelineMs: -200,
    frameRate,
  });

  assert.equal(result.clip.kind, "video");
  if (result.clip.kind !== "video") return;
  assert.equal(result.clip.timelineStartMs, 970);
  assert.equal(result.clip.sourceStartMs, 0);
  assert.equal(
    result.clip.timelineStartMs + result.clip.sourceEndMs - result.clip.sourceStartMs,
    originalEndMs,
  );
});

test("right resize respects a one-frame minimum and the known source boundary", () => {
  const clip = videoClip({
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    playbackRate: 1,
  });
  const minimum = computeSocialProjectClipResize({
    clip,
    side: "right",
    deltaTimelineMs: -10_000,
    frameRate,
    maximumSourceEndMs: 1000,
  });
  assert.equal(minimum.clip.kind, "video");
  if (minimum.clip.kind !== "video") return;
  assert.equal(minimum.clip.sourceEndMs, 34);

  const maximum = computeSocialProjectClipResize({
    clip,
    side: "right",
    deltaTimelineMs: 5000,
    frameRate,
    maximumSourceEndMs: 1030,
  });
  assert.equal(maximum.clip.kind, "video");
  if (maximum.clip.kind !== "video") return;
  assert.equal(maximum.clip.sourceEndMs, 1030);
  assert.equal(maximum.deltaTimelineMs, 30);
});

test("text resize keeps the fixed edge at rational frame rates", () => {
  const clip = textClip({ timelineStartMs: 500, durationMs: 2000 });
  const originalEndMs = clip.timelineStartMs + clip.durationMs;
  const result = computeSocialProjectClipResize({
    clip,
    side: "left",
    deltaTimelineMs: 40,
    frameRate: { numerator: 30_000, denominator: 1001 },
  });

  assert.equal(result.clip.kind, "text");
  if (result.clip.kind !== "text") return;
  assert.equal(result.clip.timelineStartMs, 533);
  assert.equal(result.clip.timelineStartMs + result.clip.durationMs, originalEndMs);
});

test("media shorter than one project frame and invalid deltas remain unchanged", () => {
  const clip = videoClip({
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 33,
    playbackRate: 1,
  });
  const tooShort = computeSocialProjectClipResize({
    clip,
    side: "right",
    deltaTimelineMs: 100,
    frameRate,
  });
  assert.strictEqual(tooShort.clip, clip);

  const invalid = computeSocialProjectClipResize({
    clip,
    side: "left",
    deltaTimelineMs: Number.NaN,
    frameRate,
  });
  assert.strictEqual(invalid.clip, clip);
});
