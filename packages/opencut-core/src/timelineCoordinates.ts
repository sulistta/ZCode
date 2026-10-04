// Social Project's millisecond adapter for OpenCut Classic scale, pixel and
// zoom calculations pinned at cf5e79e919144200294fb9fed22a222592a0aeea.
// Exact upstream source files are retained under ../upstream/opencut-classic.
const BASE_TIMELINE_PIXELS_PER_SECOND = 50;
const TIMELINE_ZOOM_MIN = 0.1;
const TIMELINE_ZOOM_MAX = 100;
const PADDING_MAX_RATIO = 0.75;
const PADDING_MIN_RATIO = 0.15;
const PADDING_MIN_AT_ZOOM_PERCENT = 0.2;

export { BASE_TIMELINE_PIXELS_PER_SECOND, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX };

export function getTimelinePixelsPerSecond({
  zoomLevel,
  basePixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND,
}: {
  zoomLevel: number;
  basePixelsPerSecond?: number;
}): number {
  return basePixelsPerSecond * zoomLevel;
}

export function timelineTimeMsToPixels({
  timeMs,
  pixelsPerSecond,
}: {
  timeMs: number;
  pixelsPerSecond: number;
}): number {
  return (timeMs / 1000) * pixelsPerSecond;
}

export function pixelsToTimelineTimeMs({
  pixel,
  pixelsPerSecond,
}: {
  pixel: number;
  pixelsPerSecond: number;
}): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  return (pixel / pixelsPerSecond) * 1000;
}

function resolveDevicePixelRatio(devicePixelRatio?: number): number {
  return typeof devicePixelRatio === "number" && Number.isFinite(devicePixelRatio)
    ? Math.max(devicePixelRatio, 0.01)
    : 1;
}

export function snapPixelToDeviceGrid({
  pixel,
  devicePixelRatio,
}: {
  pixel: number;
  devicePixelRatio?: number;
}): number {
  return (
    Math.round(pixel * resolveDevicePixelRatio(devicePixelRatio)) /
    resolveDevicePixelRatio(devicePixelRatio)
  );
}

export function timelineTimeMsToSnappedPixels({
  timeMs,
  pixelsPerSecond,
  devicePixelRatio,
}: {
  timeMs: number;
  pixelsPerSecond: number;
  devicePixelRatio?: number;
}): number {
  return snapPixelToDeviceGrid({
    pixel: timelineTimeMsToPixels({ timeMs, pixelsPerSecond }),
    devicePixelRatio,
  });
}

export function getCenteredLineLeft({
  centerPixel,
  lineWidthPx = 2,
}: {
  centerPixel: number;
  lineWidthPx?: number;
}): number {
  return centerPixel - lineWidthPx / 2;
}

export function getTimelineZoomMin({
  durationMs,
  containerWidth,
  basePixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND,
  maxZoom = TIMELINE_ZOOM_MAX,
}: {
  durationMs: number;
  containerWidth: number | null | undefined;
  basePixelsPerSecond?: number;
  maxZoom?: number;
}): number {
  const safeDurationSeconds = Math.max(durationMs / 1000, 1);
  const safeContainerWidth = containerWidth ?? 1000;
  const availableWidth = safeContainerWidth * (1 - PADDING_MAX_RATIO);
  const zoomToFit = availableWidth / (safeDurationSeconds * basePixelsPerSecond);
  const safeMaxZoom = Math.max(TIMELINE_ZOOM_MIN, maxZoom);
  return Math.min(safeMaxZoom, Math.max(TIMELINE_ZOOM_MIN, zoomToFit));
}

function getZoomPercent({
  zoomLevel,
  minZoom,
  maxZoom,
}: {
  zoomLevel: number;
  minZoom: number;
  maxZoom: number;
}): number {
  if (maxZoom <= minZoom) return 1;
  return Math.max(0, Math.min(1, (zoomLevel - minZoom) / (maxZoom - minZoom)));
}

export function getTimelinePaddingPx({
  containerWidth,
  zoomLevel,
  minZoom,
  maxZoom = TIMELINE_ZOOM_MAX,
}: {
  containerWidth: number;
  zoomLevel: number;
  minZoom: number;
  maxZoom?: number;
}): number {
  const zoomPercent = getZoomPercent({ zoomLevel, minZoom, maxZoom });
  const transition = Math.min(zoomPercent / PADDING_MIN_AT_ZOOM_PERCENT, 1);
  const paddingRatio = PADDING_MAX_RATIO - (PADDING_MAX_RATIO - PADDING_MIN_RATIO) * transition;
  return containerWidth * paddingRatio;
}

export function sliderToZoom({
  sliderPosition,
  minZoom,
  maxZoom = TIMELINE_ZOOM_MAX,
}: {
  sliderPosition: number;
  minZoom: number;
  maxZoom?: number;
}): number {
  if (minZoom <= 0 || maxZoom <= minZoom) return Math.max(minZoom, maxZoom);
  const position = Math.max(0, Math.min(1, sliderPosition));
  return minZoom * (maxZoom / minZoom) ** position;
}

export function zoomToSlider({
  zoomLevel,
  minZoom,
  maxZoom = TIMELINE_ZOOM_MAX,
}: {
  zoomLevel: number;
  minZoom: number;
  maxZoom?: number;
}): number {
  if (minZoom <= 0 || maxZoom <= minZoom) return 0;
  const zoom = Math.max(minZoom, Math.min(maxZoom, zoomLevel));
  return Math.log(zoom / minZoom) / Math.log(maxZoom / minZoom);
}
