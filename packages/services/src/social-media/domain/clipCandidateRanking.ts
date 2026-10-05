import type {
  SocialMediaAsset,
  SocialMediaClipCandidate,
  SocialMediaClipCandidateResult,
  SocialMediaTranscriptSegment,
} from "@social-harness/shared";
import { socialMediaClipCandidateResultSchema } from "@social-harness/shared";
import {
  CLIP_DURATIONS_SECONDS,
  overlapHeatmap,
  retainPromising,
  selectDiverseTopCandidates,
} from "./clipCandidateRankingUtils.js";

function isCompletePhrase(text: string): boolean {
  return /[.!?…]["')\]}»”’]*$/u.test(text.trim());
}

function normalizeTranscriptSegments(
  segments: SocialMediaTranscriptSegment[],
): SocialMediaTranscriptSegment[] {
  const ordered = [...segments].sort(
    (first, second) =>
      first.startSeconds - second.startSeconds || first.endSeconds - second.endSeconds,
  );
  const normalized: SocialMediaTranscriptSegment[] = [];
  for (const segment of ordered) {
    const previous = normalized.at(-1);
    if (!previous || segment.startSeconds >= previous.endSeconds) {
      normalized.push({ ...segment });
    } else if (segment.text.trim() === previous.text.trim()) {
      previous.endSeconds = Math.max(previous.endSeconds, segment.endSeconds);
    } else {
      previous.endSeconds = Math.max(previous.endSeconds, segment.endSeconds);
      previous.text = `${previous.text} ${segment.text}`.trim().slice(0, 4_096);
    }
  }
  return normalized;
}

function nearestEndIndex(
  segments: SocialMediaTranscriptSegment[],
  startIndex: number,
  targetSeconds: number,
): number {
  let low = startIndex;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle]!.endSeconds < targetSeconds) low = middle + 1;
    else high = middle;
  }
  if (low >= segments.length) return segments.length - 1;
  if (low === startIndex) return low;
  const previous = low - 1;
  return Math.abs(segments[previous]!.endSeconds - targetSeconds) <=
    Math.abs(segments[low]!.endSeconds - targetSeconds)
    ? previous
    : low;
}

function boundaryEndIndex(
  segments: SocialMediaTranscriptSegment[],
  startIndex: number,
  targetSeconds: number,
  maximumSeconds: number,
): number {
  const nearest = nearestEndIndex(segments, startIndex, targetSeconds);
  const start = segments[startIndex]!.startSeconds;
  const minimumEnd = start + 15;
  const maximumEnd = Math.min(start + maximumSeconds, segments.at(-1)!.endSeconds);
  const low = Math.max(startIndex, nearest - 4);
  const high = Math.min(segments.length - 1, nearest + 4);
  let best = nearest;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestComplete = false;
  for (let index = low; index <= high; index += 1) {
    const end = segments[index]!.endSeconds;
    if (end < minimumEnd || end > maximumEnd) continue;
    const complete = isCompletePhrase(segments[index]!.text);
    const distance = Math.abs(end - targetSeconds);
    if ((complete && !bestComplete) || (complete === bestComplete && distance < bestDistance)) {
      best = index;
      bestDistance = distance;
      bestComplete = complete;
    }
  }
  return best;
}

function pauseSeconds(
  current: SocialMediaTranscriptSegment,
  neighbor: SocialMediaTranscriptSegment | undefined,
  side: "before" | "after",
): number {
  if (!neighbor) return 0;
  return Math.min(
    30,
    Math.max(
      0,
      side === "before"
        ? current.startSeconds - neighbor.endSeconds
        : neighbor.startSeconds - current.endSeconds,
    ),
  );
}

function scorePodcastCandidate(input: {
  durationSeconds: number;
  completePhrase: boolean;
  beforeSeconds: number;
  afterSeconds: number;
  meanHeatmap: number | null;
}): number {
  const factors = [
    { value: Math.max(0, 100 - Math.abs(input.durationSeconds - 30) * 2.4), weight: 0.3 },
    { value: input.completePhrase ? 100 : 55, weight: 0.35 },
    {
      value: ((Math.min(input.beforeSeconds, 1.2) + Math.min(input.afterSeconds, 1.2)) / 2.4) * 100,
      weight: 0.2,
    },
    ...(input.meanHeatmap === null ? [] : [{ value: input.meanHeatmap * 100, weight: 0.15 }]),
  ];
  const weightTotal = factors.reduce((total, factor) => total + factor.weight, 0);
  return Math.round(
    factors.reduce((total, factor) => total + factor.value * factor.weight, 0) / weightTotal,
  );
}

export function rankPodcastClipCandidates(asset: SocialMediaAsset): SocialMediaClipCandidateResult {
  const transcript = asset.transcript;
  if (!transcript?.segments.length) {
    return socialMediaClipCandidateResultSchema.parse({
      accountId: asset.accountId,
      mediaId: asset.mediaId,
      mode: "podcast",
      candidates: [],
      unavailableReason: "transcript-unavailable",
    });
  }

  const segments = normalizeTranscriptSegments(transcript.segments);
  const durationSeconds = asset.sourceDurationSeconds ?? segments.at(-1)!.endSeconds;
  if (durationSeconds < 15) {
    return socialMediaClipCandidateResultSchema.parse({
      accountId: asset.accountId,
      mediaId: asset.mediaId,
      mode: "podcast",
      candidates: [],
      unavailableReason: "duration-out-of-range",
    });
  }

  const candidates: SocialMediaClipCandidate[] = [];
  let lastStartSeconds = Number.NEGATIVE_INFINITY;
  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const startSegment = segments[startIndex]!;
    const previous = segments[startIndex - 1];
    const gapBefore = previous ? startSegment.startSeconds - previous.endSeconds : 30;
    if (gapBefore < 0.35 && startSegment.startSeconds - lastStartSeconds < 5) continue;
    lastStartSeconds = startSegment.startSeconds;

    for (const targetDuration of CLIP_DURATIONS_SECONDS) {
      const targetEnd = startSegment.startSeconds + targetDuration;
      if (targetEnd < 15 || startSegment.startSeconds >= durationSeconds) continue;
      const endIndex = boundaryEndIndex(segments, startIndex, targetEnd, 60);
      const endSegment = segments[endIndex]!;
      if (endSegment.endSeconds > durationSeconds) continue;
      const endSeconds = Math.min(endSegment.endSeconds, durationSeconds);
      const clipDuration = endSeconds - startSegment.startSeconds;
      if (clipDuration < 15 || clipDuration > 60) continue;

      const completePhrase = isCompletePhrase(endSegment.text);
      const beforeSeconds = pauseSeconds(startSegment, previous, "before");
      const afterSeconds = pauseSeconds(endSegment, segments[endIndex + 1], "after");
      const heatmap = overlapHeatmap(asset.heatmap, startSegment.startSeconds, endSeconds);
      const excerpt = segments
        .slice(startIndex, endIndex + 1)
        .map((segment) => segment.text.trim())
        .join(" ")
        .slice(0, 2_000);
      const evidence = [
        { kind: "speech" as const, excerpt, completePhrase },
        { kind: "pause" as const, beforeSeconds, afterSeconds },
        ...(heatmap ? [{ kind: "heatmap" as const, ...heatmap }] : []),
      ];
      retainPromising(candidates, {
        startSeconds: startSegment.startSeconds,
        endSeconds,
        score: scorePodcastCandidate({
          durationSeconds: clipDuration,
          completePhrase,
          beforeSeconds,
          afterSeconds,
          meanHeatmap: heatmap?.meanIntensity ?? null,
        }),
        evidence,
      });
    }
  }

  return socialMediaClipCandidateResultSchema.parse({
    accountId: asset.accountId,
    mediaId: asset.mediaId,
    mode: "podcast",
    candidates: selectDiverseTopCandidates(candidates),
    unavailableReason: candidates.length === 0 ? "transcript-too-short" : null,
  });
}
