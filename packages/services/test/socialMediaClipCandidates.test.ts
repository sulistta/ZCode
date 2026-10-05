import assert from "node:assert/strict";
import test from "node:test";
import { socialMediaAssetSchema } from "@social-harness/shared";
import type { SocialMediaClipSignals } from "../src/social-media/domain/clipSignals.js";
import { rankPodcastClipCandidates } from "../src/social-media/domain/clipCandidateRanking.js";
import { rankMusicClipCandidates } from "../src/social-media/domain/musicClipCandidates.js";

function createPodcastAsset() {
  const segments = Array.from({ length: 45 }, (_, index) => ({
    startSeconds: index * 2.2,
    endSeconds: index * 2.2 + 1.8,
    text: index % 3 === 2 ? `Frase importante número ${index}.` : `Trecho falado ${index}`,
  }));
  return socialMediaAssetSchema.parse({
    mediaId: "00000000-0000-4000-8000-000000000001",
    accountId: "podcast-account",
    sourceKind: "youtube",
    originalName: "podcast.mp4",
    mediaKind: "video",
    extension: ".mp4",
    mimeType: "video/mp4",
    sizeBytes: 512,
    sha256: "a".repeat(64),
    importedAt: 100,
    sourceVideoId: "dQw4w9WgXcQ",
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    sourceTitle: "Podcast",
    sourceDurationSeconds: 120,
    transcript: {
      method: "whisper-local",
      languageCode: "pt-BR",
      modelId: "small",
      createdAt: 100,
      segments,
    },
    heatmap: [{ startSeconds: 10, endSeconds: 50, intensity: 0.8 }],
  });
}

test("podcast candidates are deterministic, phrase-bounded, and limited to five", () => {
  const asset = createPodcastAsset();
  const first = rankPodcastClipCandidates(asset);
  const second = rankPodcastClipCandidates(asset);

  assert.deepEqual(first, second);
  assert.equal(first.mode, "podcast");
  assert.equal(first.unavailableReason, null);
  assert.equal(first.candidates.length, 5);
  for (const candidate of first.candidates) {
    assert.ok(candidate.endSeconds - candidate.startSeconds >= 15);
    assert.ok(candidate.endSeconds - candidate.startSeconds <= 60);
    assert.ok(candidate.evidence.some((evidence) => evidence.kind === "speech"));
    assert.ok(candidate.evidence.some((evidence) => evidence.kind === "pause"));
  }
  assert.ok(
    first.candidates.some((candidate) =>
      candidate.evidence.some((item) => item.kind === "heatmap"),
    ),
  );
});

test("podcast mode reports unavailable transcript instead of inventing candidates", () => {
  const asset = socialMediaAssetSchema.parse({ ...createPodcastAsset(), transcript: undefined });
  const result = rankPodcastClipCandidates(asset);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.unavailableReason, "transcript-unavailable");

  const shortTranscript = socialMediaAssetSchema.parse({
    ...createPodcastAsset(),
    transcript: {
      method: "whisper-local",
      languageCode: "pt-BR",
      modelId: "small",
      createdAt: 100,
      segments: [{ startSeconds: 0, endSeconds: 8, text: "Uma fala curta." }],
    },
  });
  assert.equal(
    rankPodcastClipCandidates(shortTranscript).unavailableReason,
    "transcript-too-short",
  );
});

test("music candidates use measured audio and sparse visual evidence without a transcript", () => {
  const asset = socialMediaAssetSchema.parse({
    ...createPodcastAsset(),
    transcript: undefined,
  });
  const signals: SocialMediaClipSignals = {
    durationSeconds: 120,
    peakAudioRms: 0.4,
    audioWindows: Array.from({ length: 120 }, (_, index) => ({
      startSeconds: index,
      endSeconds: index + 1,
      energy: 0.25 + (index % 8) * 0.08,
      onsetRate: index % 2 === 0 ? 0.7 : 0.2,
    })),
    rhythm: { bpm: 120, confidence: 0.84 },
    visualSamples: [
      { atSeconds: 18, changeScore: 0.42 },
      { atSeconds: 42, changeScore: 0.71 },
      { atSeconds: 79, changeScore: 0.55 },
    ],
  };
  const result = rankMusicClipCandidates(asset, signals);

  assert.equal(result.unavailableReason, null);
  assert.equal(result.candidates.length, 5);
  assert.ok(result.candidates.every((candidate) => candidate.endSeconds <= 120));
  assert.ok(
    result.candidates.every((candidate) =>
      candidate.evidence.some((item) => item.kind === "audio"),
    ),
  );
  assert.ok(
    result.candidates.some((candidate) =>
      candidate.evidence.some((item) => item.kind === "rhythm"),
    ),
  );
  assert.ok(
    result.candidates.some((candidate) =>
      candidate.evidence.some((item) => item.kind === "visual-change"),
    ),
  );
  assert.ok(
    result.candidates.every(
      (candidate) => !candidate.evidence.some((item) => item.kind === "speech"),
    ),
  );
});

test("music mode reports missing audio and duration as unavailable", () => {
  const asset = createPodcastAsset();
  const missingAudio = rankMusicClipCandidates(asset, null);
  assert.equal(missingAudio.unavailableReason, "audio-unavailable");
  assert.deepEqual(missingAudio.candidates, []);

  const silence = rankMusicClipCandidates(asset, {
    durationSeconds: 60,
    peakAudioRms: 0,
    audioWindows: Array.from({ length: 60 }, (_, index) => ({
      startSeconds: index,
      endSeconds: index + 1,
      energy: 0,
      onsetRate: 0,
    })),
    rhythm: null,
    visualSamples: [],
  });
  assert.equal(silence.unavailableReason, "audio-unavailable");
  assert.deepEqual(silence.candidates, []);

  const short = rankMusicClipCandidates(asset, {
    durationSeconds: 12,
    peakAudioRms: 0.3,
    audioWindows: [{ startSeconds: 0, endSeconds: 12, energy: 0.5, onsetRate: 0.4 }],
    rhythm: null,
    visualSamples: [],
  });
  assert.equal(short.unavailableReason, "duration-out-of-range");
});
