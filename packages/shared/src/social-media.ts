import { z } from "zod";
export {
  socialMediaJobSchema,
  socialMediaJobStateSchema,
  socialMediaJobErrorCodeSchema,
} from "./social-media-jobs.js";
export type { SocialMediaJob } from "./social-media-jobs.js";
import { socialMediaPreviewProxySchema } from "./social-media-preview-proxy.js";
export { socialMediaPreviewProxySchema } from "./social-media-preview-proxy.js";
export type { SocialMediaPreviewProxy } from "./social-media-preview-proxy.js";
import { socialAccountIdSchema } from "./social-account.js";
import { socialMediaIdSchema, socialMediaYouTubeVideoIdSchema } from "./social-media-primitives.js";
import { normalizeSocialMediaSourceUrl } from "./social-media-source.js";

export { socialMediaIdSchema, socialMediaYouTubeVideoIdSchema } from "./social-media-primitives.js";
export {
  normalizeSocialMediaSourceUrl,
  normalizeSocialMediaYouTubeVideoUrl,
  socialMediaSourceKeySchema,
  socialMediaSourceUrlDownloadRequestSchema,
} from "./social-media-source.js";
export type {
  NormalizedSocialMediaSourceUrl,
  SocialMediaSourceUrlDownloadRequest,
} from "./social-media-source.js";
export {
  socialMediaClipCandidateEvidenceSchema,
  socialMediaClipCandidateModeSchema,
  socialMediaClipCandidateRequestSchema,
  socialMediaClipCandidateResultSchema,
  socialMediaClipCandidateSchema,
  socialMediaClipCandidateUnavailableReasonSchema,
} from "./social-media-clip-candidates.js";
export type {
  SocialMediaClipCandidate,
  SocialMediaClipCandidateEvidence,
  SocialMediaClipCandidateMode,
  SocialMediaClipCandidateRequest,
  SocialMediaClipCandidateResult,
  SocialMediaClipCandidateUnavailableReason,
} from "./social-media-clip-candidates.js";

export const socialMediaKindSchema = z.enum(["video", "audio", "image"]);
export const socialMediaJobIdSchema = z.string().uuid();
export const socialMediaTranscriptionModelIdSchema = z.enum([
  "tiny",
  "base",
  "small",
  "large-v3-turbo",
]);
export const socialMediaTranscriptionModelErrorSchema = z.enum([
  "download-failed",
  "integrity-failed",
]);
export const socialMediaYouTubeUploadDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

export const socialMediaHeatmapSegmentSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    intensity: z.number().finite().min(0).max(1),
  })
  .refine((segment) => segment.endSeconds > segment.startSeconds);

export const socialMediaSubtitleTrackSchema = z.object({
  languageCode: z.string().regex(/^[A-Za-z0-9-]{2,32}$/),
  automatic: z.boolean(),
  extension: z.literal(".vtt"),
  sizeBytes: z.number().int().positive().safe(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const socialMediaTranscriptSegmentSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    text: z.string().trim().min(1).max(4096),
  })
  .refine((segment) => segment.endSeconds > segment.startSeconds);

const socialMediaTranscriptBaseSchema = {
  languageCode: z.string().regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/),
  segments: z.array(socialMediaTranscriptSegmentSchema).min(1).max(20_000),
  createdAt: z.number().int().nonnegative().safe(),
};

export const socialMediaTranscriptSchema = z.discriminatedUnion("method", [
  z.object({
    ...socialMediaTranscriptBaseSchema,
    method: z.literal("youtube-subtitles"),
    automatic: z.boolean(),
  }),
  z.object({
    ...socialMediaTranscriptBaseSchema,
    method: z.literal("whisper-local"),
    modelId: socialMediaTranscriptionModelIdSchema,
  }),
]);

export const socialMediaAssetSchema = z
  .object({
    mediaId: socialMediaIdSchema,
    accountId: socialAccountIdSchema,
    sourceKind: z.enum(["local-file", "youtube", "remote-url"]),
    sourceOrigin: z.enum(["youtube-search", "video-url"]).optional(),
    originalName: z.string().trim().min(1).max(1024),
    mediaKind: socialMediaKindSchema,
    extension: z.string().regex(/^\.[a-z0-9]{1,12}$/),
    mimeType: z.string().min(3).max(128),
    sizeBytes: z.number().int().positive().safe(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    importedAt: z.number().int().nonnegative(),
    sourceVideoId: socialMediaYouTubeVideoIdSchema.optional(),
    sourceUrl: z.string().url().optional(),
    sourceTitle: z.string().trim().min(1).max(1000).optional(),
    sourceChannel: z.string().trim().min(1).max(500).nullable().optional(),
    sourceDurationSeconds: z.number().finite().nonnegative().nullable().optional(),
    sourceViewCount: z.number().int().nonnegative().safe().nullable().optional(),
    sourceUploadDate: socialMediaYouTubeUploadDateSchema.nullable().optional(),
    subtitleTracks: z.array(socialMediaSubtitleTrackSchema).max(4).optional(),
    transcript: socialMediaTranscriptSchema.optional(),
    heatmap: z.array(socialMediaHeatmapSegmentSchema).max(5_000).optional(),
    previewProxy: socialMediaPreviewProxySchema.optional(),
  })
  .superRefine((asset, context) => {
    if (
      asset.previewProxy &&
      (asset.mediaKind !== "video" || asset.previewProxy.sourceSha256 !== asset.sha256)
    ) {
      context.addIssue({
        code: "custom",
        path: ["previewProxy"],
        message: "A preview proxy must belong to the same immutable video",
      });
    }
    if (asset.sourceKind === "local-file" && asset.sourceOrigin !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceOrigin"],
        message: "Local files cannot declare a YouTube source origin",
      });
    }
    if (asset.sourceKind === "youtube") {
      if (
        !asset.sourceVideoId ||
        asset.sourceUrl !== `https://www.youtube.com/watch?v=${asset.sourceVideoId}`
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "YouTube source URL must match the validated video ID",
        });
      }
      if (!asset.sourceTitle) {
        context.addIssue({
          code: "custom",
          path: ["sourceTitle"],
          message: "YouTube title is required",
        });
      }
    }
    if (asset.sourceKind === "remote-url") {
      const normalizedSource = asset.sourceUrl
        ? normalizeSocialMediaSourceUrl(asset.sourceUrl)
        : null;
      if (
        asset.sourceOrigin !== "video-url" ||
        !normalizedSource ||
        normalizedSource.sourceKind !== "remote-url" ||
        normalizedSource.sourceUrl !== asset.sourceUrl ||
        asset.sourceVideoId !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "Remote media must retain its canonical, non-YouTube source URL",
        });
      }
      if (!asset.sourceTitle) {
        context.addIssue({
          code: "custom",
          path: ["sourceTitle"],
          message: "Remote media title is required",
        });
      }
    }
  })
  .transform((asset) => {
    // 旧版 YouTube 目录只能由 URL 下载流程创建，因此缺少字段时可安全补为 video-url。
    if (asset.sourceKind === "youtube" && asset.sourceOrigin === undefined) {
      return { ...asset, sourceOrigin: "video-url" as const };
    }
    return asset;
  });

export const socialMediaLocalFileImportRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  sourcePath: z.string().trim().min(1).max(32768),
});

export const SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT = 10;
export const SOCIAL_MEDIA_YOUTUBE_SEARCH_QUERY_MAX_LENGTH = 240;
export const SOCIAL_MEDIA_PREVIEW_CAPABILITY_TTL_MS = 30 * 60 * 1000;

export const socialMediaPreviewRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  mediaId: socialMediaIdSchema,
});

export const socialMediaPreviewSchema = z.object({
  accountId: socialAccountIdSchema,
  mediaId: socialMediaIdSchema,
  mimeType: z.string().min(3).max(128),
  sizeBytes: z.number().int().positive().safe(),
  url: z.string().trim().min(1).max(2048),
  expiresAt: z.number().int().nonnegative().safe(),
  representation: z.enum(["original", "proxy"]).default("original"),
});

export const socialMediaYouTubeSearchRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  query: z.string().trim().min(1).max(SOCIAL_MEDIA_YOUTUBE_SEARCH_QUERY_MAX_LENGTH),
});

export const socialMediaYouTubeSearchResultSchema = z
  .object({
    videoId: socialMediaYouTubeVideoIdSchema,
    videoUrl: z.string().url(),
    title: z.string().trim().min(1).max(1000),
    channel: z.string().trim().min(1).max(500).nullable(),
    durationSeconds: z.number().finite().nonnegative().nullable(),
    viewCount: z.number().int().nonnegative().safe().nullable(),
    uploadDate: socialMediaYouTubeUploadDateSchema.nullable(),
  })
  .superRefine((result, context) => {
    if (result.videoUrl !== `https://www.youtube.com/watch?v=${result.videoId}`) {
      context.addIssue({
        code: "custom",
        message: "YouTube URL must match the validated video ID",
      });
    }
  });

export const socialMediaJobActionRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  jobId: socialMediaJobIdSchema,
});

export const socialMediaJobChangeSchema = z.object({
  accountId: socialAccountIdSchema,
  jobId: socialMediaJobIdSchema,
  updatedAt: z.number().int().nonnegative(),
});

export const socialMediaTranscriptionModelRequestSchema = z.object({
  modelId: socialMediaTranscriptionModelIdSchema,
});

export const socialMediaTranscriptionModelStatusSchema = z.object({
  modelId: socialMediaTranscriptionModelIdSchema,
  sizeBytes: z.number().int().positive().safe(),
  installed: z.boolean(),
  downloading: z.boolean(),
  downloadedBytes: z.number().int().nonnegative().safe(),
  errorCode: socialMediaTranscriptionModelErrorSchema.nullable(),
});

export const socialMediaTranscriptionSetupSchema = z.object({
  selectedModelId: socialMediaTranscriptionModelIdSchema,
  models: z.array(socialMediaTranscriptionModelStatusSchema).min(1),
  updatedAt: z.number().int().nonnegative(),
});

export type SocialMediaAsset = z.infer<typeof socialMediaAssetSchema>;
export type SocialMediaPreviewRequest = z.infer<typeof socialMediaPreviewRequestSchema>;
export type SocialMediaPreview = z.infer<typeof socialMediaPreviewSchema>;
export type SocialMediaKind = z.infer<typeof socialMediaKindSchema>;

export type SocialMediaJobChange = z.infer<typeof socialMediaJobChangeSchema>;
export type SocialMediaHeatmapSegment = z.infer<typeof socialMediaHeatmapSegmentSchema>;
export type SocialMediaSubtitleTrack = z.infer<typeof socialMediaSubtitleTrackSchema>;
export type SocialMediaTranscriptSegment = z.infer<typeof socialMediaTranscriptSegmentSchema>;
export type SocialMediaTranscript = z.infer<typeof socialMediaTranscriptSchema>;
export type SocialMediaLocalFileImportRequest = z.infer<
  typeof socialMediaLocalFileImportRequestSchema
>;
export type SocialMediaYouTubeSearchRequest = z.infer<typeof socialMediaYouTubeSearchRequestSchema>;
export type SocialMediaYouTubeSearchResult = z.infer<typeof socialMediaYouTubeSearchResultSchema>;
export type SocialMediaJobActionRequest = z.infer<typeof socialMediaJobActionRequestSchema>;
export type SocialMediaTranscriptionModelId = z.infer<typeof socialMediaTranscriptionModelIdSchema>;
export type SocialMediaTranscriptionModelRequest = z.infer<
  typeof socialMediaTranscriptionModelRequestSchema
>;
export type SocialMediaTranscriptionModelStatus = z.infer<
  typeof socialMediaTranscriptionModelStatusSchema
>;
export type SocialMediaTranscriptionSetup = z.infer<typeof socialMediaTranscriptionSetupSchema>;
