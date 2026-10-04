import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRulerLabel,
  getRulerConfig,
  getTimelinePaddingPx,
  getTimelinePixelsPerSecond,
  getTimelineSnapThresholdMs,
  getTimelineZoomMin,
  getVisibleRulerTickRange,
  pixelsToTimelineTimeMs,
  resolveTimelineMoveSnap,
  resolveTimelineSnap,
  sliderToZoom,
  timelineTimeMsToPixels,
  zoomToSlider,
} from "../src/index.js";

test("OpenCut timeline coordinates round-trip Social Harness millisecond times", () => {
  const pixelsPerSecond = getTimelinePixelsPerSecond({ zoomLevel: 2 });
  const pixel = timelineTimeMsToPixels({ timeMs: 12_500, pixelsPerSecond });
  assert.equal(pixelsPerSecond, 100);
  assert.equal(pixel, 1_250);
  assert.equal(pixelsToTimelineTimeMs({ pixel, pixelsPerSecond }), 12_500);
});

test("timeline snap threshold follows zoom and chooses the closest point", () => {
  const maxSnapDistanceMs = getTimelineSnapThresholdMs({ pixelsPerSecond: 50 });
  const result = resolveTimelineSnap({
    targetTimeMs: 4_930,
    maxSnapDistanceMs,
    snapPoints: [
      { timeMs: 5_000, type: "playhead" },
      { timeMs: 4_900, type: "clip-end", clipId: "clip-a" },
    ],
  });
  assert.equal(maxSnapDistanceMs, 200);
  assert.equal(result.snappedTimeMs, 4_900);
  assert.equal(result.snapPoint?.clipId, "clip-a");
});

test("OpenCut move snapping compares both clip edges and keeps the closest snap", () => {
  const result = resolveTimelineMoveSnap({
    targetStartMs: 4_900,
    clipDurationMs: 2_000,
    movingClipId: "moving",
    maxSnapDistanceMs: 200,
    snapPoints: [
      { timeMs: 5_000, type: "clip-start", clipId: "start-target" },
      { timeMs: 6_905, type: "keyframe", clipId: "keyframe-target" },
    ],
  });

  assert.equal(result.snappedTimeMs, 4_905);
  assert.equal(result.snapPoint?.type, "keyframe");
  assert.equal(result.snapDistanceMs, 5);
});

test("timeline move snapping ignores its own edges and clamps at timeline zero", () => {
  const ownEdge = resolveTimelineMoveSnap({
    targetStartMs: 1_010,
    clipDurationMs: 1_000,
    movingClipId: "moving",
    maxSnapDistanceMs: 20,
    snapPoints: [
      { timeMs: 1_000, type: "clip-start", clipId: "moving" },
      { timeMs: 2_000, type: "clip-end", clipId: "moving" },
    ],
  });
  assert.equal(ownEdge.snappedTimeMs, 1_010);
  assert.equal(ownEdge.snapPoint, null);

  const beforeTimelineStart = resolveTimelineMoveSnap({
    targetStartMs: -100,
    clipDurationMs: 1_000,
    movingClipId: "moving",
    maxSnapDistanceMs: 20,
    snapPoints: [],
  });
  assert.equal(beforeTimelineStart.snappedTimeMs, 0);
});

test("ruler selects readable frame ticks and formats time labels", () => {
  const ruler = getRulerConfig({
    zoomLevel: 4,
    fps: { numerator: 30_000, denominator: 1_001 },
  });
  assert.ok(ruler.tickIntervalSeconds > 0);
  assert.ok(ruler.labelIntervalSeconds >= ruler.tickIntervalSeconds);
  assert.equal(
    formatRulerLabel({ timeInSeconds: 90, fps: { numerator: 30, denominator: 1 } }),
    "01:30",
  );
  assert.equal(
    formatRulerLabel({ timeInSeconds: 1.5, fps: { numerator: 30, denominator: 1 } }),
    "15f",
  );
});

test("ruler virtualizes ticks to the viewport with an OpenCut-sized scroll buffer", () => {
  const range = getVisibleRulerTickRange({
    durationSeconds: 600,
    tickIntervalSeconds: 1,
    pixelsPerSecond: 50,
    scrollLeftPx: 10_088,
    viewportWidthPx: 600,
    rulerOriginOffsetPx: 88,
  });

  assert.equal(range.totalTickCount, 601);
  assert.ok(range.startTickIndex > 150);
  assert.ok(range.endTickIndex < range.totalTickCount - 1);
  assert.ok(range.endTickIndex >= range.startTickIndex);
});

test("ruler viewport range excludes the pinned track-label column after horizontal scrolling", () => {
  const range = getVisibleRulerTickRange({
    durationSeconds: 600,
    tickIntervalSeconds: 1,
    pixelsPerSecond: 100,
    scrollLeftPx: 10_000,
    viewportWidthPx: 888,
    rulerOriginOffsetPx: 88,
  });

  assert.equal(range.startTickIndex, 83);
  assert.equal(range.effectiveDurationSeconds, 600);
  assert.equal(range.endTickIndex, 125);
});

test("zoom slider maps linearly to an exponential zoom curve", () => {
  assert.equal(sliderToZoom({ sliderPosition: 0.5, minZoom: 0.5, maxZoom: 8 }), 2);
  assert.equal(zoomToSlider({ zoomLevel: 2, minZoom: 0.5, maxZoom: 8 }), 0.5);
});

test("timeline minimum zoom follows the visible width and the UI maximum", () => {
  const narrow = getTimelineZoomMin({
    durationMs: 10_000,
    containerWidth: 400,
    basePixelsPerSecond: 50,
    maxZoom: 8,
  });
  const wide = getTimelineZoomMin({
    durationMs: 10_000,
    containerWidth: 1_600,
    basePixelsPerSecond: 50,
    maxZoom: 8,
  });
  const capped = getTimelineZoomMin({
    durationMs: 1_000,
    containerWidth: 10_000,
    basePixelsPerSecond: 0.5,
    maxZoom: 8,
  });

  assert.equal(narrow, 0.2);
  assert.equal(wide, 0.8);
  assert.equal(capped, 8);
});

test("timeline trailing ruler padding follows the configured zoom range", () => {
  assert.equal(
    getTimelinePaddingPx({ containerWidth: 400, zoomLevel: 0.2, minZoom: 0.2, maxZoom: 8 }),
    300,
  );
  assert.equal(
    Math.round(
      getTimelinePaddingPx({ containerWidth: 400, zoomLevel: 8, minZoom: 0.2, maxZoom: 8 }),
    ),
    60,
  );
  assert.equal(
    getTimelinePaddingPx({ containerWidth: 400, zoomLevel: 0, minZoom: 0.2, maxZoom: 8 }),
    300,
  );
});
