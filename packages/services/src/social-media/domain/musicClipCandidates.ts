import type {
  SocialMediaAsset,
  SocialMediaClipCandidate,
  SocialMediaClipCandidateResult,
} from "@social-harness/shared";
import { socialMediaClipCandidateResultSchema } from "@social-harness/shared";
import type { SocialMediaClipSignals } from "./clipSignals.js";
import {
  CLIP_DURATIONS_SECONDS,
  overlapHeatmap,
  retainPromising,
  selectDiverseTopCandidates,
} from "./clipCandidateRankingUtils.js";

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreMusicCandidate(input: {
  durationSeconds: number;
  energy: number;
  energyVariation: number;
  onsetRate: number;
  rhythmConfidence: number | null;
  heatmapIntensity: number | null;
  visualChange: number | null;
}): number {
  const factors = [
    { value: input.energy * 100, weight: 0.3 },
    { value: input.energyVariation * 100, weight: 0.2 },
    { value: input.onsetRate * 100, weight: 0.2 },
    ...(input.rhythmConfidence === null
      ? []
      : [{ value: input.rhythmConfidence * 100, weight: 0.15 }]),
    ...(input.heatmapIntensity === null
      ? []
      : [{ value: input.heatmapIntensity * 100, weight: 0.1 }]),
    ...(input.visualChange === null ? [] : [{ value: input.visualChange * 100, weight: 0.05 }]),
    { value: Math.max(0, 100 - Math.abs(input.durationSeconds - 30) * 2), weight: 0.1 },
  ];
  const weightTotal = factors.reduce((total, factor) => total + factor.weight, 0);
  return Math.round(
    factors.reduce((total, factor) => total + factor.value * factor.weight, 0) / weightTotal,
  );
}

function rankCandidate(
  asset: SocialMediaAsset,
  signals: SocialMediaClipSignals,
  startSeconds: number,
  clipDuration: number,
): SocialMediaClipCandidate | null {
  const endSeconds = startSeconds + clipDuration;
  if (endSeconds > signals.durationSeconds) return null;
  const windows = signals.audioWindows.filter(
    (window) => window.endSeconds > startSeconds && window.startSeconds < endSeconds,
  );
  if (windows.length === 0) return null;

  const energyValues = windows.map((window) => window.energy);
  const meanEnergy = mean(energyValues);
  const energyVariation = Math.min(
    1,
    Math.sqrt(mean(energyValues.map((energy) => (energy - meanEnergy) ** 2))) * 2,
  );
  const onsetRate = mean(windows.map((window) => window.onsetRate));
  const heatmap = overlapHeatmap(asset.heatmap, startSeconds, endSeconds);
  const visualSamples = signals.visualSamples.filter(
    (sample) => sample.atSeconds >= startSeconds && sample.atSeconds <= endSeconds,
  );
  const strongestVisualSamples = [...visualSamples]
    .sort((first, second) => second.changeScore - first.changeScore)
    .slice(0, 5)
    .map((sample) => sample.atSeconds)
    .sort((first, second) => first - second);
  const maxChangeScore = visualSamples.reduce(
    (maximum, sample) => Math.max(maximum, sample.changeScore),
    0,
  );
  const evidence = [
    { kind: "audio" as const, meanEnergy, energyVariation, onsetRate },
    ...(signals.rhythm ? [{ kind: "rhythm" as const, ...signals.rhythm }] : []),
    ...(heatmap ? [{ kind: "heatmap" as const, ...heatmap }] : []),
    ...(strongestVisualSamples.length > 0
      ? [
          {
            kind: "visual-change" as const,
            sampleTimesSeconds: strongestVisualSamples,
            maxChangeScore,
          },
        ]
      : []),
  ];
  return {
    startSeconds,
    endSeconds,
    score: scoreMusicCandidate({
      durationSeconds: clipDuration,
      energy: meanEnergy,
      energyVariation,
      onsetRate,
      rhythmConfidence: signals.rhythm?.confidence ?? null,
      heatmapIntensity: heatmap?.meanIntensity ?? null,
      visualChange: strongestVisualSamples.length > 0 ? maxChangeScore : null,
    }),
    evidence,
  };
}

export function rankMusicClipCandidates(
  asset: SocialMediaAsset,
  signals: SocialMediaClipSignals | null,
): SocialMediaClipCandidateResult {
  if (!signals?.audioWindows.length || signals.peakAudioRms < 0.002) {
    return socialMediaClipCandidateResultSchema.parse({
      accountId: asset.accountId,
      mediaId: asset.mediaId,
      mode: "music",
      candidates: [],
      unavailableReason: "audio-unavailable",
    });
  }
  if (signals.durationSeconds < 15) {
    return socialMediaClipCandidateResultSchema.parse({
      accountId: asset.accountId,
      mediaId: asset.mediaId,
      mode: "music",
      candidates: [],
      unavailableReason: "duration-out-of-range",
    });
  }

  const candidates: SocialMediaClipCandidate[] = [];
  for (let startSeconds = 0; startSeconds + 15 <= signals.durationSeconds; startSeconds += 5) {
    for (const clipDuration of CLIP_DURATIONS_SECONDS) {
      const candidate = rankCandidate(asset, signals, startSeconds, clipDuration);
      if (candidate) retainPromising(candidates, candidate);
    }
  }
  return socialMediaClipCandidateResultSchema.parse({
    accountId: asset.accountId,
    mediaId: asset.mediaId,
    mode: "music",
    candidates: selectDiverseTopCandidates(candidates),
    unavailableReason: candidates.length === 0 ? "audio-unavailable" : null,
  });
}
