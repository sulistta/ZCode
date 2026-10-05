import assert from "node:assert/strict";
import test from "node:test";
import type { SocialProject, SocialProjectClip, SocialProjectTrack } from "@social-harness/shared";
import {
  buildSocialProjectClipColorExpressions,
  buildSocialProjectKeyframeExpression,
  compileSocialProjectSceneExpression,
  evaluateSocialProjectSceneExpression,
  getActiveSocialProjectClips,
  getSocialProjectClipColorFilter,
  getSocialProjectClipTransitionOpacity,
  getSocialProjectKeyframedValue,
  getSocialProjectRenderableClips,
} from "../src/contract.js";

function textClip(overrides: Partial<Extract<SocialProjectClip, { kind: "text" }>> = {}) {
  return {
    clipId: "text-clip",
    kind: "text" as const,
    timelineStartMs: 500,
    durationMs: 1000,
    text: "Scene fixture",
    style: {
      fontFamily: "sans-serif",
      fontSize: 32,
      color: "#ffffff",
      alignment: "center" as const,
    },
    keyframes: [],
    ...overrides,
  };
}

function track(overrides: Partial<SocialProjectTrack> = {}): SocialProjectTrack {
  return {
    trackId: "track-1",
    name: "Track",
    type: "video",
    muted: false,
    hidden: false,
    clips: [],
    ...overrides,
  };
}

function project(tracks: SocialProjectTrack[]): SocialProject {
  return {
    projectId: "project-1",
    accountId: "account-1",
    displayName: "Scene fixture",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    editControlOwner: "user",
    settings: {
      width: 1080,
      height: 1920,
      frameRate: { numerator: 30, denominator: 1 },
      backgroundColor: "#000000",
    },
    tracks,
  };
}

test("shared keyframe evaluation uses clip-local base values and outgoing easing", () => {
  const clip = textClip({
    transform: { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    keyframes: [
      { keyframeId: "x-start", timeMs: 100, property: "x", value: 20, easing: "ease-out" },
      { keyframeId: "x-end", timeMs: 300, property: "x", value: 100, easing: "linear" },
    ],
  });
  const expression = buildSocialProjectKeyframeExpression(clip, "x", 10);

  assert.equal(getSocialProjectKeyframedValue(clip, "x", 500, 10), 10);
  assert.equal(getSocialProjectKeyframedValue(clip, "x", 550, 10), 15);
  assert.equal(getSocialProjectKeyframedValue(clip, "x", 600, 10), 20);
  assert.equal(getSocialProjectKeyframedValue(clip, "x", 700, 10), 80);
  assert.equal(getSocialProjectKeyframedValue(clip, "x", 900, 10), 100);
  assert.equal(
    evaluateSocialProjectSceneExpression(expression, { timeMs: 200 }),
    getSocialProjectKeyframedValue(clip, "x", 700, 10),
  );
  assert.match(compileSocialProjectSceneExpression(expression), /if\(lt\(/);
});

test("duplicate keyframe timestamps resolve to the last entry in document order", () => {
  const clip = textClip({
    keyframes: [
      { keyframeId: "first", timeMs: 0, property: "x", value: 10, easing: "linear" },
      { keyframeId: "last", timeMs: 0, property: "x", value: 30, easing: "linear" },
      { keyframeId: "end", timeMs: 100, property: "x", value: 40, easing: "linear" },
    ],
  });

  assert.equal(getSocialProjectKeyframedValue(clip, "x", 500, 0), 30);
  assert.equal(getSocialProjectKeyframedValue(clip, "x", 550, 0), 35);
});

test("overlapping incoming and outgoing transitions multiply their opacity ramps", () => {
  const clip = textClip({
    durationMs: 1000,
    transitionIn: { kind: "fade", durationMs: 800 },
    transitionOut: { kind: "dissolve", durationMs: 800 },
  });

  assert.equal(getSocialProjectClipTransitionOpacity(clip, 1000), 0.390625);
  assert.equal(getSocialProjectClipTransitionOpacity(clip, 1500), 0);
});

test("shared render order skips hidden tracks and orders visible layers by track and start time", () => {
  const first = textClip({ clipId: "first", timelineStartMs: 100 });
  const second = textClip({ clipId: "second", timelineStartMs: 0 });
  const hidden = textClip({ clipId: "hidden", timelineStartMs: 0 });
  const audio: SocialProjectClip = {
    clipId: "audio",
    mediaId: "audio-media",
    kind: "audio",
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
  };
  const scene = project([
    track({ clips: [first, second] }),
    track({ trackId: "hidden-track", hidden: true, clips: [hidden] }),
    track({ trackId: "audio-track", type: "audio", muted: true, clips: [audio] }),
  ]);

  assert.deepEqual(
    getSocialProjectRenderableClips(scene).map(({ clip }) => clip.clipId),
    ["second", "first"],
  );
  assert.deepEqual(
    getActiveSocialProjectClips(scene, 600).map(({ clip }) => clip.clipId),
    ["second", "first"],
  );
});

test("shared RGB expressions apply CSS-ordered color matrices and expose one preview filter string", () => {
  const clip: SocialProjectClip = {
    clipId: "video",
    mediaId: "video-media",
    kind: "video",
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
    colorAdjustments: { brightness: 0.5, contrast: 1.5, saturation: 0, hue: 0 },
  };
  const expressions = buildSocialProjectClipColorExpressions(clip);
  const values = { timeMs: 0, red: 0.2, green: 0.2, blue: 0.2 };

  for (const channel of [expressions.red, expressions.green, expressions.blue]) {
    assert.ok(Math.abs(evaluateSocialProjectSceneExpression(channel, values) - 0.2) < 1e-9);
  }
  assert.equal(getSocialProjectClipColorFilter(clip), "brightness(1.5) contrast(1.5) saturate(0)");

  const grayscale = buildSocialProjectClipColorExpressions({
    ...clip,
    colorAdjustments: { brightness: 0, contrast: 1, saturation: 0, hue: 0 },
  });
  for (const channel of [grayscale.red, grayscale.green, grayscale.blue]) {
    assert.ok(
      Math.abs(evaluateSocialProjectSceneExpression(channel, { timeMs: 0, red: 1 }) - 0.213) < 1e-9,
    );
  }
});
