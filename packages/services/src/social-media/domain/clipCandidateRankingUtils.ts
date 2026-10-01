import type { SocialMediaClipCandidate, SocialMediaHeatmapSegment } from "@social-harness/shared";

export const CLIP_DURATIONS_SECONDS = [15, 30, 45, 60] as const;
const MAX_RETAINED_CANDIDATES = 48;

export function overlapHeatmap(
  heatmap: SocialMediaHeatmapSegment[] | undefined,
  startSeconds: number,
  endSeconds: number,
) {
  if (!heatmap?.length) return null;
  let weightedIntensity = 0;
  let coveredSeconds = 0;
  let peakIntensity = 0;
  for (const segment of heatmap) {
    const overlap = Math.max(
      0,
      Math.min(endSeconds, segment.endSeconds) - Math.max(startSeconds, segment.startSeconds),
    );
    if (overlap === 0) continue;
    weightedIntensity += overlap * segment.intensity;
    coveredSeconds += overlap;
    peakIntensity = Math.max(peakIntensity, segment.intensity);
  }
  return coveredSeconds > 0
    ? { meanIntensity: weightedIntensity / coveredSeconds, peakIntensity }
    : null;
}

export function retainPromising(
  candidates: SocialMediaClipCandidate[],
  candidate: SocialMediaClipCandidate,
): void {
  candidates.push(candidate);
  if (candidates.length > MAX_RETAINED_CANDIDATES * 2) {
    candidates.sort(
      (first, second) => second.score - first.score || first.startSeconds - second.startSeconds,
    );
    candidates.length = MAX_RETAINED_CANDIDATES;
  }
}

export function selectDiverseTopCandidates(
  candidates: SocialMediaClipCandidate[],
): SocialMediaClipCandidate[] {
  const ordered = [...candidates].sort(
    (first, second) =>
      second.score - first.score ||
      first.startSeconds - second.startSeconds ||
      first.endSeconds - second.endSeconds,
  );
  const selected: SocialMediaClipCandidate[] = [];
  for (const candidate of ordered) {
    const duration = candidate.endSeconds - candidate.startSeconds;
    const duplicates = selected.some((existing) => {
      const overlap = Math.max(
        0,
        Math.min(existing.endSeconds, candidate.endSeconds) -
          Math.max(existing.startSeconds, candidate.startSeconds),
      );
      return overlap / Math.min(duration, existing.endSeconds - existing.startSeconds) > 0.7;
    });
    if (!duplicates) selected.push(candidate);
    if (selected.length === 5) break;
  }
  return selected;
}
