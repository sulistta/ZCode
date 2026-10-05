// Social Project's viewport-aware ruler adapter based on OpenCut Classic
// ruler-utils.ts and timeline-ruler.tsx at cf5e79e919144200294fb9fed22a222592a0aeea.
// The pinned source is retained under ../upstream/opencut-classic.
export interface TimelineFrameRate {
  numerator: number;
  denominator: number;
}

export interface RulerConfig {
  labelIntervalSeconds: number;
  tickIntervalSeconds: number;
}

export interface VisibleRulerTickRange {
  effectiveDurationSeconds: number;
  startTickIndex: number;
  endTickIndex: number;
  totalTickCount: number;
}

const LABEL_FRAME_INTERVALS = [2, 3, 5, 10, 15] as const;
const TICK_FRAME_INTERVALS = [1, 2, 3, 5, 10, 15] as const;
const SECOND_MULTIPLIERS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] as const;
const MIN_LABEL_SPACING_PX = 120;
const MIN_TICK_SPACING_PX = 18;
const MIN_VIEWPORT_BUFFER_PX = 200;
const VIEWPORT_BUFFER_RATIO = 0.15;

/** Returns the inclusive tick-index range needed for the visible ruler viewport. */
export function getVisibleRulerTickRange({
  durationSeconds,
  tickIntervalSeconds,
  pixelsPerSecond,
  scrollLeftPx,
  viewportWidthPx,
  rulerOriginOffsetPx = 0,
}: {
  durationSeconds: number;
  tickIntervalSeconds: number;
  pixelsPerSecond: number;
  scrollLeftPx: number;
  viewportWidthPx: number;
  rulerOriginOffsetPx?: number;
}): VisibleRulerTickRange {
  const safeDurationSeconds = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const safeTickIntervalSeconds =
    Number.isFinite(tickIntervalSeconds) && tickIntervalSeconds > 0 ? tickIntervalSeconds : 1;
  const safePixelsPerSecond =
    Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 1;
  const safeScrollLeftPx = Number.isFinite(scrollLeftPx) ? Math.max(0, scrollLeftPx) : 0;
  const safeViewportWidthPx = Number.isFinite(viewportWidthPx) ? Math.max(0, viewportWidthPx) : 0;
  const safeRulerOriginOffsetPx = Number.isFinite(rulerOriginOffsetPx)
    ? Math.max(0, rulerOriginOffsetPx)
    : 0;
  // The label column stays pinned, so the ruler always begins after it in the viewport.
  const rulerScrollLeftPx = safeScrollLeftPx;
  const rulerViewportWidthPx = Math.max(0, safeViewportWidthPx - safeRulerOriginOffsetPx);
  const viewportEndPx = rulerScrollLeftPx + rulerViewportWidthPx;
  const effectiveDurationSeconds = Math.max(
    safeDurationSeconds,
    viewportEndPx / safePixelsPerSecond,
  );
  const totalTickCount = Math.floor(effectiveDurationSeconds / safeTickIntervalSeconds) + 1;
  const bufferPx = Math.max(MIN_VIEWPORT_BUFFER_PX, viewportEndPx * VIEWPORT_BUFFER_RATIO);
  const visibleStartSeconds = Math.max(0, (rulerScrollLeftPx - bufferPx) / safePixelsPerSecond);
  const visibleEndSeconds = (viewportEndPx + bufferPx) / safePixelsPerSecond;
  const lastTickIndex = Math.max(0, totalTickCount - 1);

  return {
    effectiveDurationSeconds,
    startTickIndex: Math.min(
      lastTickIndex,
      Math.floor(visibleStartSeconds / safeTickIntervalSeconds),
    ),
    endTickIndex: Math.min(lastTickIndex, Math.ceil(visibleEndSeconds / safeTickIntervalSeconds)),
    totalTickCount,
  };
}

function framesPerSecond(frameRate: TimelineFrameRate): number {
  if (
    !Number.isFinite(frameRate.numerator) ||
    !Number.isFinite(frameRate.denominator) ||
    frameRate.numerator <= 0 ||
    frameRate.denominator <= 0
  ) {
    return 30;
  }
  return frameRate.numerator / frameRate.denominator;
}

export function getRulerConfig({
  zoomLevel,
  fps,
  basePixelsPerSecond = 50,
}: {
  zoomLevel: number;
  fps: TimelineFrameRate;
  basePixelsPerSecond?: number;
}): RulerConfig {
  const fpsFloat = framesPerSecond(fps);
  const pixelsPerSecond = basePixelsPerSecond * zoomLevel;
  const pixelsPerFrame = pixelsPerSecond / fpsFloat;
  const labelIntervalSeconds = findOptimalInterval({
    pixelsPerFrame,
    pixelsPerSecond,
    fps: fpsFloat,
    minSpacingPx: MIN_LABEL_SPACING_PX,
    frameIntervals: LABEL_FRAME_INTERVALS,
  });
  const rawTickIntervalSeconds = findOptimalInterval({
    pixelsPerFrame,
    pixelsPerSecond,
    fps: fpsFloat,
    minSpacingPx: MIN_TICK_SPACING_PX,
    frameIntervals: TICK_FRAME_INTERVALS,
  });
  const labelFrames = Math.round(labelIntervalSeconds * fpsFloat);
  const tickFrames = Math.round(rawTickIntervalSeconds * fpsFloat);
  if (tickFrames > 0 && labelFrames % tickFrames === 0) {
    return { labelIntervalSeconds, tickIntervalSeconds: rawTickIntervalSeconds };
  }
  for (const candidateFrames of TICK_FRAME_INTERVALS) {
    if (labelFrames % candidateFrames === 0) {
      const spacing = pixelsPerFrame * candidateFrames;
      if (spacing >= MIN_TICK_SPACING_PX) {
        return { labelIntervalSeconds, tickIntervalSeconds: candidateFrames / fpsFloat };
      }
    }
  }
  for (const candidateSeconds of SECOND_MULTIPLIERS) {
    const ratio = labelIntervalSeconds / candidateSeconds;
    if (Math.abs(ratio - Math.round(ratio)) < 0.0001) {
      if (pixelsPerSecond * candidateSeconds >= MIN_TICK_SPACING_PX) {
        return { labelIntervalSeconds, tickIntervalSeconds: candidateSeconds };
      }
    }
  }
  return { labelIntervalSeconds, tickIntervalSeconds: labelIntervalSeconds };
}

function findOptimalInterval({
  pixelsPerFrame,
  pixelsPerSecond,
  fps,
  minSpacingPx,
  frameIntervals,
}: {
  pixelsPerFrame: number;
  pixelsPerSecond: number;
  fps: number;
  minSpacingPx: number;
  frameIntervals: readonly number[];
}): number {
  for (const frameInterval of frameIntervals) {
    if (pixelsPerFrame * frameInterval >= minSpacingPx) return frameInterval / fps;
  }
  for (const seconds of SECOND_MULTIPLIERS) {
    if (pixelsPerSecond * seconds >= minSpacingPx) return seconds;
  }
  return 60;
}

export function shouldShowLabel({
  timeSeconds,
  labelIntervalSeconds,
}: {
  timeSeconds: number;
  labelIntervalSeconds: number;
}): boolean {
  if (labelIntervalSeconds <= 0) return false;
  const remainder = timeSeconds % labelIntervalSeconds;
  return remainder < 0.0001 || remainder > labelIntervalSeconds - 0.0001;
}

export function formatRulerLabel({
  timeInSeconds,
  fps,
}: {
  timeInSeconds: number;
  fps: TimelineFrameRate;
}): string {
  const remainder = timeInSeconds % 1;
  if (remainder < 0.0001 || remainder > 1 - 0.0001) {
    const totalSeconds = Math.round(timeInSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = minutes.toString().padStart(2, "0");
    const ss = seconds.toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  const frame = Math.round(remainder * framesPerSecond(fps));
  return `${frame}f`;
}
