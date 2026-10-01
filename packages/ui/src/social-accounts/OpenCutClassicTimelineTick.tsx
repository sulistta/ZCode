import { formatRulerLabel, timelineTimeMsToSnappedPixels } from "@social-harness/opencut-core";

// Adapted from OpenCut Classic apps/web/src/timeline/components/timeline-tick.tsx
// at cf5e79e919144200294fb9fed22a222592a0aeea. The pinned source snapshot is
// retained under packages/opencut-core/upstream; this adapter uses Social
// Harness millisecond times and shared UI tokens.
export function OpenCutClassicTimelineTick({
  timeSeconds,
  pixelsPerSecond,
  devicePixelRatio,
  frameRateNumerator,
  frameRateDenominator,
  showLabel,
}: {
  timeSeconds: number;
  pixelsPerSecond: number;
  devicePixelRatio?: number;
  frameRateNumerator: number;
  frameRateDenominator: number;
  showLabel: boolean;
}) {
  const left = timelineTimeMsToSnappedPixels({
    timeMs: timeSeconds * 1000,
    pixelsPerSecond,
    devicePixelRatio,
  });
  const fps = { numerator: frameRateNumerator, denominator: frameRateDenominator };

  return (
    <span
      className="absolute bottom-0 top-0 border-l border-border"
      style={{ left: `${left}px` }}
      data-social-ruler-tick=""
      data-time-seconds={timeSeconds}
    >
      {showLabel ? (
        <span className="absolute left-1 top-1 whitespace-nowrap border-0 text-ui-xs text-foreground-subtle">
          {formatRulerLabel({ timeInSeconds: timeSeconds, fps })}
        </span>
      ) : null}
    </span>
  );
}
