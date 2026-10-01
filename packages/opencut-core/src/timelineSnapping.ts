// Millisecond adaptation of OpenCut Classic's threshold, snap-resolution and
// group-edge rules at cf5e79e919144200294fb9fed22a222592a0aeea. The pinned
// source is retained under ../upstream/opencut-classic.
export const DEFAULT_TIMELINE_SNAP_THRESHOLD_PX = 10;

export type SnapPointType = "clip-start" | "clip-end" | "keyframe" | "playhead";

export interface SnapPoint {
  timeMs: number;
  type: SnapPointType;
  clipId?: string;
  trackId?: string;
}

export interface SnapResult {
  snappedTimeMs: number;
  snapPoint: SnapPoint | null;
  snapDistanceMs: number;
}

export function getTimelineSnapThresholdMs({
  pixelsPerSecond,
  snapThresholdPx = DEFAULT_TIMELINE_SNAP_THRESHOLD_PX,
}: {
  pixelsPerSecond: number;
  snapThresholdPx?: number;
}): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  return (snapThresholdPx / pixelsPerSecond) * 1000;
}

export function resolveTimelineSnap({
  targetTimeMs,
  snapPoints,
  maxSnapDistanceMs,
}: {
  targetTimeMs: number;
  snapPoints: readonly SnapPoint[];
  maxSnapDistanceMs: number;
}): SnapResult {
  let closestSnapPoint: SnapPoint | null = null;
  let closestDistanceMs = Number.POSITIVE_INFINITY;

  for (const snapPoint of snapPoints) {
    const distanceMs = Math.abs(targetTimeMs - snapPoint.timeMs);
    if (distanceMs <= maxSnapDistanceMs && distanceMs < closestDistanceMs) {
      closestDistanceMs = distanceMs;
      closestSnapPoint = snapPoint;
    }
  }

  return {
    snappedTimeMs: closestSnapPoint ? closestSnapPoint.timeMs : targetTimeMs,
    snapPoint: closestSnapPoint,
    snapDistanceMs: closestDistanceMs,
  };
}

export function resolveTimelineMoveSnap({
  targetStartMs,
  clipDurationMs,
  movingClipId,
  snapPoints,
  maxSnapDistanceMs,
}: {
  targetStartMs: number;
  clipDurationMs: number;
  movingClipId: string;
  snapPoints: readonly SnapPoint[];
  maxSnapDistanceMs: number;
}): SnapResult {
  if (
    !Number.isFinite(targetStartMs) ||
    !Number.isFinite(clipDurationMs) ||
    clipDurationMs < 0 ||
    !Number.isFinite(maxSnapDistanceMs) ||
    maxSnapDistanceMs < 0
  ) {
    return {
      snappedTimeMs: Number.isFinite(targetStartMs) ? Math.max(0, targetStartMs) : 0,
      snapPoint: null,
      snapDistanceMs: Number.POSITIVE_INFINITY,
    };
  }

  const normalizedTargetStartMs = Math.max(0, Math.round(targetStartMs));
  const eligibleSnapPoints = snapPoints.filter((point) => point.clipId !== movingClipId);
  const startEdgeSnap = resolveTimelineSnap({
    targetTimeMs: normalizedTargetStartMs,
    snapPoints: eligibleSnapPoints,
    maxSnapDistanceMs,
  });
  const endEdgeSnap = resolveTimelineSnap({
    targetTimeMs: normalizedTargetStartMs + clipDurationMs,
    snapPoints: eligibleSnapPoints,
    maxSnapDistanceMs,
  });
  if (endEdgeSnap.snapPoint && endEdgeSnap.snapDistanceMs < startEdgeSnap.snapDistanceMs) {
    const snappedStartMs = Math.round(endEdgeSnap.snappedTimeMs - clipDurationMs);
    if (snappedStartMs >= 0) return { ...endEdgeSnap, snappedTimeMs: snappedStartMs };
  }
  if (startEdgeSnap.snapPoint) {
    return {
      ...startEdgeSnap,
      snappedTimeMs: Math.max(0, Math.round(startEdgeSnap.snappedTimeMs)),
    };
  }
  return {
    snappedTimeMs: normalizedTargetStartMs,
    snapPoint: null,
    snapDistanceMs: Number.POSITIVE_INFINITY,
  };
}
