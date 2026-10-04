import { createHash, randomUUID } from "node:crypto";
import { Emitter } from "@social-harness/rpc";
import {
  normalizeSocialMediaSourceUrl,
  socialAccountIdSchema,
  socialMediaAssetSchema,
  socialMediaClipCandidateRequestSchema,
  socialMediaClipCandidateResultSchema,
  socialMediaIdSchema,
  socialMediaJobActionRequestSchema,
  socialMediaJobSchema,
  socialMediaLocalFileImportRequestSchema,
  socialMediaPreviewRequestSchema,
  socialMediaPreviewSchema,
  socialMediaTranscriptionModelRequestSchema,
  socialMediaSourceUrlDownloadRequestSchema,
  socialMediaSourceKeySchema,
  socialMediaYouTubeSearchRequestSchema,
  socialMediaYouTubeSearchResultSchema,
  SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT,
  type SocialMediaAsset,
  type SocialMediaLocalFileImportRequest,
  type SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";
import type { ISocialAccountService } from "../../social-account/contract.js";
import type { ISocialMediaService, SocialMediaChange, SocialMediaJobChange } from "../contract.js";
import type { ISocialMediaPreviewService } from "../previewContract.js";
import type { SocialMediaStore } from "./ports/socialMediaStore.js";
import type { SocialMediaSourceUrlDownload } from "./ports/socialMediaSourceDownload.js";
import type { SocialMediaYouTubeSearch } from "./ports/socialMediaYouTubeSearch.js";
import type { SocialMediaTranscriptionModelManager } from "./ports/socialMediaTranscriptionModelManager.js";
import type { SocialMediaTranscriber } from "./ports/socialMediaTranscriber.js";
import type { SocialMediaClipSignalAnalyzer } from "./ports/socialMediaClipSignalAnalyzer.js";
import {
  SocialMediaAccountNotFoundError,
  SocialMediaAssetNotFoundError,
  SocialMediaJobNotFoundError,
  SocialMediaSourceDownloadFailedError,
  SocialMediaSourceDownloadUnavailableError,
  SocialMediaPreviewUnavailableError,
} from "./errors.js";
import { createSocialMediaJobQueue } from "./socialMediaJobQueue.js";
import { rankPodcastClipCandidates } from "../domain/clipCandidateRanking.js";
import { rankMusicClipCandidates } from "../domain/musicClipCandidates.js";

interface SocialMediaServiceOptions {
  store: SocialMediaStore;
  socialAccountService: ISocialAccountService;
  youTubeSearch: SocialMediaYouTubeSearch;
  transcriptionModelManager: SocialMediaTranscriptionModelManager;
  transcriber: SocialMediaTranscriber;
  clipSignalAnalyzer?: SocialMediaClipSignalAnalyzer;
  sourceUrlDownload?: SocialMediaSourceUrlDownload;
  createPreviewUrl?: (path: string) => Promise<{ url: string; expiresAt: number }>;
  now?: () => number;
  createMediaId?: () => string;
}

export interface SocialMediaServiceLifecycle {
  previewService: ISocialMediaPreviewService;
  disposeAll(): void;
  disposeAllAndWait(): Promise<void>;
}

export function createSocialMediaService(
  options: SocialMediaServiceOptions,
): ISocialMediaService & SocialMediaServiceLifecycle {
  const now = options.now ?? Date.now;
  const createMediaId = options.createMediaId ?? randomUUID;
  const changed = new Emitter<SocialMediaChange>();
  const jobChanged = new Emitter<SocialMediaJobChange>();
  const transcriptionSetupChanged = new Emitter<{ updatedAt: number }>();
  const sourceUrlDownload =
    options.sourceUrlDownload ??
    ({
      start() {
        throw new SocialMediaSourceDownloadUnavailableError();
      },
    } satisfies SocialMediaSourceUrlDownload);

  async function requireAccount(accountId: string) {
    const account = await options.socialAccountService.get(accountId);
    if (!account) throw new SocialMediaAccountNotFoundError(accountId);
    return account;
  }

  const jobQueue = createSocialMediaJobQueue({
    store: options.store,
    socialAccountService: options.socialAccountService,
    sourceUrlDownload,
    transcriptionModelManager: options.transcriptionModelManager,
    transcriber: options.transcriber,
    now,
    onJobChanged(job) {
      jobChanged.fire({ accountId: job.accountId, jobId: job.jobId, updatedAt: job.updatedAt });
    },
    onMediaImported(asset) {
      changed.fire({
        accountId: asset.accountId,
        mediaId: asset.mediaId,
        importedAt: asset.importedAt,
      });
    },
  });

  const emitTranscriptionSetupChanged = () => {
    transcriptionSetupChanged.fire({ updatedAt: Math.max(0, Math.trunc(now())) });
  };

  const previewService: ISocialMediaPreviewService = {
    async prepare(request) {
      const input = socialMediaPreviewRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const asset = await options.store.getAsset(input.accountId, input.mediaId);
      if (!asset) throw new SocialMediaAssetNotFoundError(input.mediaId);
      if (!options.createPreviewUrl) throw new SocialMediaPreviewUnavailableError();
      try {
        const path = await options.store.getManagedOriginalPath(asset);
        const capability = await options.createPreviewUrl(path);
        return socialMediaPreviewSchema.parse({
          accountId: asset.accountId,
          mediaId: asset.mediaId,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          url: capability.url,
          expiresAt: capability.expiresAt,
        });
      } catch {
        // Keep managed storage paths out of renderer-visible adapter errors.
        throw new SocialMediaPreviewUnavailableError();
      }
    },
  };

  const service: ISocialMediaService & SocialMediaServiceLifecycle = {
    previewService,
    async list(accountId) {
      const validatedAccountId = socialAccountIdSchema.parse(accountId);
      await requireAccount(validatedAccountId);
      return options.store.list(validatedAccountId);
    },
    async listJobs(accountId) {
      const validatedAccountId = socialAccountIdSchema.parse(accountId);
      await requireAccount(validatedAccountId);
      return options.store.listJobs(validatedAccountId);
    },
    async importLocalFile(request: SocialMediaLocalFileImportRequest): Promise<SocialMediaAsset> {
      const input = socialMediaLocalFileImportRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const importedAt = Math.max(0, Math.trunc(now()));
      const mediaId = socialMediaIdSchema.parse(createMediaId());
      const asset = socialMediaAssetSchema.parse(
        await options.store.importLocalFile({ ...input, mediaId, importedAt }),
      );
      changed.fire({ accountId: asset.accountId, mediaId: asset.mediaId, importedAt });
      return asset;
    },
    async downloadSourceUrl(request) {
      const input = socialMediaSourceUrlDownloadRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const normalizedSource = normalizeSocialMediaSourceUrl(input.url);
      if (!normalizedSource) throw new SocialMediaSourceDownloadFailedError();
      const sourceVideoId = normalizedSource.sourceVideoId;
      const sourceKey = socialMediaSourceKeySchema.parse(
        sourceVideoId ??
          `url-${createHash("sha256").update(normalizedSource.sourceUrl).digest("hex")}`,
      );
      const createdAt = Math.max(0, Math.trunc(now()));
      const job = socialMediaJobSchema.parse({
        jobId: createMediaId(),
        accountId: input.accountId,
        sourceKind: normalizedSource.sourceKind,
        sourceKey,
        ...(sourceVideoId ? { sourceVideoId } : {}),
        sourceOrigin: "video-url",
        sourceUrl: normalizedSource.sourceUrl,
        state: "queued",
        downloadedBytes: 0,
        totalBytes: null,
        etaSeconds: null,
        mediaId: null,
        errorCode: null,
        createdAt,
        updatedAt: createdAt,
      });
      const result = await options.store.createOrGetSourceUrlJob(job);
      if (result.created) {
        jobChanged.fire({
          accountId: result.job.accountId,
          jobId: result.job.jobId,
          updatedAt: result.job.updatedAt,
        });
        jobQueue.requestQueueRun();
      }
      return result.job;
    },
    async cancelJob(request) {
      const input = socialMediaJobActionRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const job = await options.store.requestCancel(
        input.accountId,
        input.jobId,
        Math.max(0, Math.trunc(now())),
      );
      if (!job) throw new SocialMediaJobNotFoundError(input.jobId);
      jobChanged.fire({ accountId: job.accountId, jobId: job.jobId, updatedAt: job.updatedAt });
      await jobQueue.cancelActiveJob(job);
      return job;
    },
    async retryJob(request) {
      const input = socialMediaJobActionRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const existing = await options.store.getJob(input.accountId, input.jobId);
      if (!existing) throw new SocialMediaJobNotFoundError(input.jobId);
      const retried = await options.store.updateJob(
        input.accountId,
        input.jobId,
        ["failed", "cancelled"],
        { state: "queued", errorCode: null, updatedAt: Math.max(0, Math.trunc(now())) },
      );
      if (!retried) throw new SocialMediaJobNotFoundError(input.jobId);
      if (retried.state === "queued" && existing.state !== "queued") {
        jobChanged.fire({
          accountId: retried.accountId,
          jobId: retried.jobId,
          updatedAt: retried.updatedAt,
        });
        jobQueue.requestQueueRun();
      }
      return retried;
    },
    async getTranscriptionSetup() {
      return options.transcriptionModelManager.getSetup();
    },
    async selectTranscriptionModel(request) {
      const input = socialMediaTranscriptionModelRequestSchema.parse(request);
      const setup = await options.transcriptionModelManager.selectModel(input.modelId);
      emitTranscriptionSetupChanged();
      return setup;
    },
    async downloadTranscriptionModel(request) {
      const input = socialMediaTranscriptionModelRequestSchema.parse(request);
      return options.transcriptionModelManager.downloadModel(
        input.modelId,
        emitTranscriptionSetupChanged,
      );
    },
    async cancelTranscriptionModelDownload(request) {
      const input = socialMediaTranscriptionModelRequestSchema.parse(request);
      return options.transcriptionModelManager.cancelDownload(
        input.modelId,
        emitTranscriptionSetupChanged,
      );
    },
    async searchYouTube(request): Promise<SocialMediaYouTubeSearchResult[]> {
      const input = socialMediaYouTubeSearchRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const candidates = await options.youTubeSearch.search(
        input.query,
        SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT,
      );
      const seenVideoIds = new Set<string>();
      const results: SocialMediaYouTubeSearchResult[] = [];
      for (const candidate of candidates) {
        const parsed = socialMediaYouTubeSearchResultSchema.safeParse(candidate);
        if (!parsed.success || seenVideoIds.has(parsed.data.videoId)) continue;
        seenVideoIds.add(parsed.data.videoId);
        results.push(parsed.data);
        if (results.length === SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT) break;
      }
      return results;
    },
    async suggestClipCandidates(request) {
      const input = socialMediaClipCandidateRequestSchema.parse(request);
      await requireAccount(input.accountId);
      const asset = await options.store.getAsset(input.accountId, input.mediaId);
      if (!asset) throw new SocialMediaAssetNotFoundError(input.mediaId);
      if (asset.mediaKind === "image") {
        return socialMediaClipCandidateResultSchema.parse({
          accountId: asset.accountId,
          mediaId: asset.mediaId,
          mode: input.mode,
          candidates: [],
          unavailableReason: "unsupported-media-kind",
        });
      }
      if (input.mode === "podcast") return rankPodcastClipCandidates(asset);
      if (!options.clipSignalAnalyzer) {
        return socialMediaClipCandidateResultSchema.parse({
          accountId: asset.accountId,
          mediaId: asset.mediaId,
          mode: "music",
          candidates: [],
          unavailableReason: "audio-unavailable",
        });
      }
      const analysis = await options.clipSignalAnalyzer.analyze({
        mediaPath: await options.store.getManagedOriginalPath(asset),
        hasVideo: asset.mediaKind === "video",
      });
      if (!analysis.available) {
        return socialMediaClipCandidateResultSchema.parse({
          accountId: asset.accountId,
          mediaId: asset.mediaId,
          mode: "music",
          candidates: [],
          unavailableReason: analysis.reason,
        });
      }
      return rankMusicClipCandidates(asset, analysis.signals);
    },
    onChanged: changed.event,
    onJobChanged: jobChanged.event,
    onTranscriptionSetupChanged: transcriptionSetupChanged.event,
    disposeAll() {
      jobQueue.disposeAll();
      options.transcriptionModelManager.disposeAll();
      changed.dispose();
      jobChanged.dispose();
      transcriptionSetupChanged.dispose();
    },
    async disposeAllAndWait() {
      options.transcriptionModelManager.disposeAll();
      await Promise.all([
        jobQueue.disposeAllAndWait(),
        options.transcriptionModelManager.disposeAllAndWait(),
      ]);
      changed.dispose();
      jobChanged.dispose();
      transcriptionSetupChanged.dispose();
    },
  };

  // The durable queue is recovered only after acquiring its cross-process lock.
  jobQueue.requestQueueRun();
  return service;
}
