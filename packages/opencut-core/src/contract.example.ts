import {
  buildSocialProjectKeyframeExpression,
  computeSocialProjectClipResize,
  evaluateSocialProjectSceneExpression,
  getRulerConfig,
  getTimelinePixelsPerSecond,
  getTimelineSnapThresholdMs,
  getVisibleRulerTickRange,
  resolveTimelineSnap,
  resolveTimelineMoveSnap,
  type SnapPoint,
} from "./contract.js";

const zoomLevel = 1.5;
const pixelsPerSecond = getTimelinePixelsPerSecond({ zoomLevel });
const ruler = getRulerConfig({ zoomLevel, fps: { numerator: 30, denominator: 1 } });
const visibleTicks = getVisibleRulerTickRange({
  durationSeconds: 120,
  tickIntervalSeconds: ruler.tickIntervalSeconds,
  pixelsPerSecond,
  scrollLeftPx: 0,
  viewportWidthPx: 900,
  rulerOriginOffsetPx: 88,
});
const snapPoints: SnapPoint[] = [{ timeMs: 5_000, type: "playhead" }];
const snap = resolveTimelineSnap({
  targetTimeMs: 5_120,
  snapPoints,
  maxSnapDistanceMs: getTimelineSnapThresholdMs({ pixelsPerSecond }),
});
const moveSnap = resolveTimelineMoveSnap({
  targetStartMs: 4_950,
  clipDurationMs: 2_000,
  movingClipId: "clip-moving-example",
  snapPoints: [
    { timeMs: 5_000, type: "clip-start", clipId: "clip-target-example" },
    { timeMs: 7_000, type: "keyframe", clipId: "clip-target-example" },
  ],
  maxSnapDistanceMs: getTimelineSnapThresholdMs({ pixelsPerSecond }),
});
const resize = computeSocialProjectClipResize({
  clip: {
    clipId: "clip-trim-example",
    kind: "video",
    mediaId: "media-example",
    timelineStartMs: 500,
    sourceStartMs: 1000,
    sourceEndMs: 5000,
    playbackRate: 1.5,
    volume: 1,
    keyframes: [],
  },
  side: "left",
  deltaTimelineMs: 1000 / 30,
  frameRate: { numerator: 30, denominator: 1 },
  maximumSourceEndMs: 5000,
});

export const timelineExample = {
  ruler,
  pixelsPerSecond,
  visibleTicks,
  snappedTimeMs: snap.snappedTimeMs,
  snappedMoveStartMs: moveSnap.snappedTimeMs,
  resize,
};

const positionExpression = buildSocialProjectKeyframeExpression(
  {
    clipId: "clip-example",
    kind: "text",
    timelineStartMs: 500,
    durationMs: 2000,
    text: "Example",
    style: { fontFamily: "sans-serif", fontSize: 48, color: "#ffffff", alignment: "center" },
    keyframes: [
      {
        keyframeId: "position-start",
        timeMs: 0,
        property: "x",
        value: 0,
        easing: "ease-in-out",
      },
      {
        keyframeId: "position-end",
        timeMs: 1000,
        property: "x",
        value: 100,
        easing: "linear",
      },
    ],
  },
  "x",
  0,
);

export const sceneExample = {
  expression: positionExpression,
  positionAt750Ms: evaluateSocialProjectSceneExpression(positionExpression, { timeMs: 250 }),
};
