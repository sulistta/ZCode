import assert from "node:assert/strict";
import test from "node:test";
import type { SocialProject, SocialProjectTrack } from "@social-harness/shared";
import { getSocialProjectClipColorFilter } from "../src/social-accounts/socialProjectPreviewModel.js";
import {
  getActiveSocialProjectClips,
  getSocialProjectClipTransform,
  getSocialProjectClipDurationMs,
  getSocialProjectEndMs,
  getSocialProjectSourceTimeMs,
} from "../src/social-accounts/socialProjectPlayback.js";
import {
  canMoveSocialProjectClipToTrack,
  getSocialProjectClipTrimPreview,
  getSocialProjectClipMoveSnap,
  getSocialProjectDragStartMs,
} from "../src/social-accounts/socialProjectTimelineDrag.js";

function createProject(tracks: SocialProjectTrack[]): SocialProject {
  return {
    projectId: "project-1",
    accountId: "account-1",
    displayName: "Preview fixture",
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

test("preview color filters match visual adjustments and leave neutral or audio clips unchanged", () => {
  const videoClip: SocialProjectTrack["clips"][number] = {
    clipId: "color-video",
    mediaId: "media-video",
    kind: "video",
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
  };
  const adjustedClip = {
    ...videoClip,
    colorAdjustments: { brightness: -0.5, contrast: 1.5, saturation: 0, hue: 45 },
  };
  const audioClip: SocialProjectTrack["clips"][number] = {
    ...videoClip,
    clipId: "color-audio",
    mediaId: "media-audio",
    kind: "audio",
  };

  assert.equal(getSocialProjectClipColorFilter(videoClip), undefined);
  assert.equal(
    getSocialProjectClipColorFilter(adjustedClip),
    "brightness(0.5) contrast(1.5) saturate(0) hue-rotate(45deg)",
  );
  assert.equal(getSocialProjectClipColorFilter(audioClip), undefined);
});

test("project playback derives active clips from the accepted timeline and track visibility", () => {
  const video: SocialProjectTrack = {
    trackId: "video-1",
    name: "Video",
    type: "video",
    muted: false,
    hidden: false,
    clips: [
      {
        clipId: "clip-1",
        mediaId: "media-1",
        kind: "video",
        timelineStartMs: 1000,
        sourceStartMs: 5000,
        sourceEndMs: 9000,
        playbackRate: 2,
        volume: 1,
        keyframes: [],
      },
      {
        clipId: "clip-2",
        mediaId: "media-2",
        kind: "image",
        timelineStartMs: 2000,
        sourceStartMs: 0,
        sourceEndMs: 6000,
        playbackRate: 1,
        volume: 0,
        keyframes: [],
      },
    ],
  };
  const mutedAudio: SocialProjectTrack = {
    trackId: "audio-1",
    name: "Muted audio",
    type: "audio",
    muted: true,
    hidden: false,
    clips: [
      {
        clipId: "clip-3",
        mediaId: "media-3",
        kind: "audio",
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: 20_000,
        playbackRate: 1,
        volume: 1,
        keyframes: [],
      },
    ],
  };
  const project = createProject([video, mutedAudio]);

  assert.deepEqual(
    getActiveSocialProjectClips(project, 2500).map(({ clip }) => clip.clipId),
    ["clip-1", "clip-2"],
  );
  assert.deepEqual(
    getActiveSocialProjectClips(project, 3000).map(({ clip }) => clip.clipId),
    ["clip-2"],
  );
  assert.equal(getSocialProjectEndMs(project), 20_000);
});

test("playback-rate timing maps timeline positions to bounded source timestamps", () => {
  const clip = {
    clipId: "clip-1",
    mediaId: "media-1",
    kind: "video" as const,
    timelineStartMs: 1000,
    sourceStartMs: 5000,
    sourceEndMs: 9000,
    playbackRate: 2,
    volume: 1,
    keyframes: [],
  };

  assert.equal(getSocialProjectClipDurationMs(clip), 2000);
  assert.equal(getSocialProjectSourceTimeMs(clip, 1500), 6000);
  assert.equal(getSocialProjectSourceTimeMs(clip, 5000), 9000);
});

test("keyframed transforms interpolate on clip-local time and apply the declared easing", () => {
  const project = createProject([
    {
      trackId: "video-1",
      name: "Video",
      type: "video",
      muted: false,
      hidden: false,
      clips: [
        {
          clipId: "clip-1",
          mediaId: "media-1",
          kind: "video",
          timelineStartMs: 500,
          sourceStartMs: 0,
          sourceEndMs: 4000,
          playbackRate: 1,
          volume: 1,
          keyframes: [
            {
              keyframeId: "keyframe-1",
              timeMs: 0,
              property: "x",
              value: 0,
              easing: "ease-in",
            },
            {
              keyframeId: "keyframe-2",
              timeMs: 1000,
              property: "x",
              value: 100,
              easing: "linear",
            },
          ],
        },
      ],
    },
  ]);
  const clip = project.tracks[0]!.clips[0]!;

  assert.equal(getSocialProjectClipTransform(clip, 1000).x, 25);
  assert.equal(getSocialProjectClipTransform(clip, 1500).x, 100);
});

test("timeline drag previews snapped time and only accepts compatible tracks", () => {
  const clip: SocialProjectTrack["clips"][number] = {
    clipId: "clip-1",
    mediaId: "media-1",
    kind: "image",
    timelineStartMs: 1000,
    sourceStartMs: 0,
    sourceEndMs: 5000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
  };
  const videoTrack: SocialProjectTrack = {
    trackId: "video-1",
    name: "Video",
    type: "video",
    muted: false,
    hidden: false,
    clips: [],
  };
  const audioTrack: SocialProjectTrack = { ...videoTrack, trackId: "audio-1", type: "audio" };

  assert.equal(
    getSocialProjectDragStartMs({ initialStartMs: 1000, deltaX: 13, pixelsPerSecond: 10 }),
    2300,
  );
  assert.equal(
    getSocialProjectDragStartMs({
      initialStartMs: 1000,
      deltaX: 12.345,
      pixelsPerSecond: 10,
    }),
    2235,
  );
  assert.equal(
    getSocialProjectDragStartMs({ initialStartMs: 1000, deltaX: -50, pixelsPerSecond: 10 }),
    0,
  );
  assert.equal(canMoveSocialProjectClipToTrack(clip, videoTrack), true);
  assert.equal(canMoveSocialProjectClipToTrack(clip, audioTrack), false);
});

test("timeline drag snaps the clip start to the playhead or another clip edge", () => {
  const movingClip: SocialProjectTrack["clips"][number] = {
    clipId: "moving",
    mediaId: "media-moving",
    kind: "video",
    timelineStartMs: 1000,
    sourceStartMs: 0,
    sourceEndMs: 4000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
  };
  const targetClip: SocialProjectTrack["clips"][number] = {
    ...movingClip,
    clipId: "target",
    mediaId: "media-target",
    timelineStartMs: 4900,
  };
  const project = createProject([
    {
      trackId: "video-1",
      name: "Video",
      type: "video",
      muted: false,
      hidden: false,
      clips: [movingClip, targetClip],
    },
  ]);

  const clipEdgeSnap = getSocialProjectClipMoveSnap({
    project,
    movingClip,
    targetStartMs: 4920,
    playheadMs: 8000,
    pixelsPerSecond: 50,
  });
  assert.equal(clipEdgeSnap.snappedTimeMs, 4900);
  assert.equal(clipEdgeSnap.snapPoint?.clipId, "target");

  const playheadSnap = getSocialProjectClipMoveSnap({
    project,
    movingClip,
    targetStartMs: 7920,
    playheadMs: 8000,
    pixelsPerSecond: 50,
  });
  assert.equal(playheadSnap.snappedTimeMs, 8000);
  assert.equal(playheadSnap.snapPoint?.type, "playhead");
});

test("timeline move snaps its nearest edge to another clip keyframe", () => {
  const movingClip: SocialProjectTrack["clips"][number] = {
    clipId: "moving-keyframe",
    mediaId: "media-moving",
    kind: "video",
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 4000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
  };
  const targetClip: SocialProjectTrack["clips"][number] = {
    ...movingClip,
    clipId: "keyframe-target",
    mediaId: "media-target",
    timelineStartMs: 5000,
    keyframes: [
      {
        keyframeId: "target-position",
        timeMs: 1500,
        property: "x",
        value: 25,
        easing: "linear",
      },
    ],
  };
  const project = createProject([
    {
      trackId: "video-1",
      name: "Video",
      type: "video",
      muted: false,
      hidden: false,
      clips: [movingClip, targetClip],
    },
  ]);

  const result = getSocialProjectClipMoveSnap({
    project,
    movingClip,
    targetStartMs: 2510,
    playheadMs: 20_000,
    pixelsPerSecond: 50,
  });

  assert.equal(result.snappedTimeMs, 2500);
  assert.equal(result.snapPoint?.type, "keyframe");
  assert.equal(result.snapPoint?.clipId, "keyframe-target");
});

test("media trim gestures preserve the opposite edge and map through playback rate", () => {
  const clip: SocialProjectTrack["clips"][number] = {
    clipId: "trim-video",
    mediaId: "media-1",
    kind: "video",
    timelineStartMs: 1000,
    sourceStartMs: 2000,
    sourceEndMs: 10_000,
    playbackRate: 2,
    volume: 1,
    keyframes: [],
  };

  const startTrim = getSocialProjectClipTrimPreview({
    clip,
    edge: "start",
    deltaTimelineMs: 101,
    frameRate: { numerator: 30, denominator: 1 },
  });
  assert.equal(startTrim.kind, "video");
  if (startTrim.kind !== "video") return;
  assert.equal(startTrim.timelineStartMs, 1100);
  assert.equal(startTrim.sourceStartMs, 2200);
  assert.equal(startTrim.sourceEndMs, clip.sourceEndMs);
  assert.equal(
    startTrim.timelineStartMs +
      (startTrim.sourceEndMs - startTrim.sourceStartMs) / clip.playbackRate,
    clip.timelineStartMs + (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate,
  );

  const endTrim = getSocialProjectClipTrimPreview({
    clip,
    edge: "end",
    deltaTimelineMs: 5000,
    frameRate: { numerator: 30, denominator: 1 },
    maximumSourceEndMs: 12_000,
  });
  assert.equal(endTrim.kind, "video");
  if (endTrim.kind !== "video") return;
  assert.equal(endTrim.timelineStartMs, clip.timelineStartMs);
  assert.equal(endTrim.sourceEndMs, 12_000);

  const minimumTrim = getSocialProjectClipTrimPreview({
    clip,
    edge: "end",
    deltaTimelineMs: -10_000,
    frameRate: { numerator: 30, denominator: 1 },
  });
  assert.equal(minimumTrim.kind, "video");
  if (minimumTrim.kind !== "video") return;
  assert.equal(minimumTrim.sourceEndMs - minimumTrim.sourceStartMs, 67);
});

test("text trim gestures preserve the opposite edge and respect project duration limits", () => {
  const clip: SocialProjectTrack["clips"][number] = {
    clipId: "trim-caption",
    kind: "text",
    timelineStartMs: 1000,
    durationMs: 5000,
    text: "Caption",
    style: { fontFamily: "sans-serif", fontSize: 32, color: "#FFFFFF", alignment: "center" },
    keyframes: [],
  };

  const startTrim = getSocialProjectClipTrimPreview({
    clip,
    edge: "start",
    deltaTimelineMs: 300,
    frameRate: { numerator: 30, denominator: 1 },
  });
  assert.equal(startTrim.kind, "text");
  if (startTrim.kind !== "text") return;
  assert.equal(startTrim.timelineStartMs, 1300);
  assert.equal(startTrim.durationMs, 4700);
  assert.equal(
    startTrim.timelineStartMs + startTrim.durationMs,
    clip.timelineStartMs + clip.durationMs,
  );

  const clampedStart = getSocialProjectClipTrimPreview({
    clip,
    edge: "start",
    deltaTimelineMs: -10_000,
    frameRate: { numerator: 30, denominator: 1 },
  });
  assert.equal(clampedStart.kind, "text");
  if (clampedStart.kind !== "text") return;
  assert.equal(clampedStart.timelineStartMs, 0);
  assert.equal(clampedStart.durationMs, 6000);

  const clampedEnd = getSocialProjectClipTrimPreview({
    clip,
    edge: "end",
    deltaTimelineMs: 1_000_000,
    frameRate: { numerator: 30, denominator: 1 },
  });
  assert.equal(clampedEnd.kind, "text");
  if (clampedEnd.kind !== "text") return;
  assert.equal(clampedEnd.durationMs, 600_000);
});
