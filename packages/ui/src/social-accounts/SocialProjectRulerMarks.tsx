import { memo } from "react";
import { getVisibleRulerTickRange, shouldShowLabel } from "@social-harness/opencut-core";
import { OpenCutClassicTimelineTick } from "./OpenCutClassicTimelineTick.js";

export const SocialProjectRulerMarks = memo(function SocialProjectRulerMarks({
  durationSeconds,
  frameRateNumerator,
  frameRateDenominator,
  pixelsPerSecond,
  devicePixelRatio,
  tickIntervalSeconds,
  labelIntervalSeconds,
  scrollLeftPx,
  viewportWidthPx,
  rulerOriginOffsetPx,
}: {
  durationSeconds: number;
  frameRateNumerator: number;
  frameRateDenominator: number;
  pixelsPerSecond: number;
  devicePixelRatio?: number;
  tickIntervalSeconds: number;
  labelIntervalSeconds: number;
  scrollLeftPx: number;
  viewportWidthPx: number;
  rulerOriginOffsetPx: number;
}) {
  const range = getVisibleRulerTickRange({
    durationSeconds,
    tickIntervalSeconds,
    pixelsPerSecond,
    scrollLeftPx,
    viewportWidthPx,
    rulerOriginOffsetPx,
  });
  const tickIndices = Array.from(
    { length: range.endTickIndex - range.startTickIndex + 1 },
    (_, index) => range.startTickIndex + index,
  );
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-testid="social-project-ruler-marks"
      data-start-tick-index={range.startTickIndex}
      data-end-tick-index={range.endTickIndex}
      data-total-tick-count={range.totalTickCount}
    >
      {tickIndices.map((tickIndex) => {
        const tick = tickIndex * tickIntervalSeconds;
        return (
          <OpenCutClassicTimelineTick
            key={tickIndex}
            timeSeconds={tick}
            pixelsPerSecond={pixelsPerSecond}
            devicePixelRatio={devicePixelRatio}
            frameRateNumerator={frameRateNumerator}
            frameRateDenominator={frameRateDenominator}
            showLabel={shouldShowLabel({ timeSeconds: tick, labelIntervalSeconds })}
          />
        );
      })}
    </div>
  );
});
