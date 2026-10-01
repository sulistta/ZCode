import { z } from "zod";
import { editorialProfileSchema, socialAutomationPolicySchema } from "./social-account.js";
import { socialMediaClipCandidateResultSchema, socialMediaIdSchema } from "./social-media.js";
import { socialProjectSummarySchema } from "./social-project.js";
import { socialMediaYouTubeSearchResultSchema } from "./social-media.js";
import { socialProjectIdSchema } from "./social-project.js";
import { instagramPublicationStatusSchema } from "./social-publishing.js";

const socialAgentPublicationHistoryItemSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  projectRevision: z.number().int().nonnegative(),
  status: instagramPublicationStatusSchema,
  caption: z.string().trim().min(1).max(2200),
  permalink: z.string().url().max(1024).optional(),
  createdAt: z.number().int().nonnegative(),
});

export const socialAgentContextSchema = z.object({
  editorialProfile: editorialProfileSchema,
  automationPolicy: socialAutomationPolicySchema,
  projects: z.array(socialProjectSummarySchema.omit({ accountId: true })).max(100),
  completedExports: z
    .array(
      z.object({
        exportId: socialProjectIdSchema,
        projectId: socialProjectIdSchema,
        projectRevision: z.number().int().nonnegative(),
        createdAt: z.number().int().nonnegative(),
      }),
    )
    .max(100),
  publicationHistory: z.object({
    status: z.enum(["available", "unavailable"]),
    items: z.array(socialAgentPublicationHistoryItemSchema).max(25),
  }),
});

export const socialAgentMediaAssetSchema = z.object({
  mediaId: socialMediaIdSchema,
  sourceKind: z.enum(["local-file", "youtube", "remote-url"]),
  sourceOrigin: z.enum(["youtube-search", "video-url"]).optional(),
  originalName: z.string().trim().min(1).max(1024),
  mediaKind: z.enum(["video", "audio", "image"]),
  sizeBytes: z.number().int().positive().safe(),
  importedAt: z.number().int().nonnegative().safe(),
  sourceUrl: z.string().url().optional(),
  sourceTitle: z.string().trim().min(1).max(1000).optional(),
  sourceChannel: z.string().trim().min(1).max(500).nullable().optional(),
  sourceDurationSeconds: z.number().finite().nonnegative().nullable().optional(),
  transcript: z
    .object({
      languageCode: z.string().min(2).max(48),
      method: z.enum(["youtube-subtitles", "whisper-local"]),
      segmentCount: z.number().int().positive().max(20_000),
    })
    .nullable(),
  heatmapSegmentCount: z.number().int().nonnegative().max(5000),
});

export const socialAgentQueryParamsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("context") }).strict(),
  z.object({ action: z.literal("list-media") }).strict(),
  z
    .object({
      action: z.literal("search-youtube"),
      query: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      action: z.literal("suggest-candidates"),
      mediaId: socialMediaIdSchema,
      mode: z.enum(["podcast", "music"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("request-publication"),
      exportId: socialProjectIdSchema,
      caption: z.string().trim().min(1).max(2_200),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
    })
    .strict(),
]);

export const socialAgentPublicationRequestResultSchema = z.object({
  publicationId: z.string().uuid(),
  projectId: socialProjectIdSchema,
  projectRevision: z.number().int().nonnegative(),
  status: instagramPublicationStatusSchema,
  caption: z.string().trim().min(1).max(2_200),
  createdAt: z.number().int().nonnegative(),
});

export const socialAgentQueryResultSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("context"),
      context: socialAgentContextSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("list-media"),
      assets: z.array(socialAgentMediaAssetSchema).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("search-youtube"),
      results: z.array(socialMediaYouTubeSearchResultSchema).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("suggest-candidates"),
      result: socialMediaClipCandidateResultSchema.omit({ accountId: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("request-publication"),
      result: socialAgentPublicationRequestResultSchema,
    })
    .strict(),
]);

export type SocialAgentContext = z.infer<typeof socialAgentContextSchema>;
export type SocialAgentPublicationRequestResult = z.infer<
  typeof socialAgentPublicationRequestResultSchema
>;
export type SocialAgentMediaAsset = z.infer<typeof socialAgentMediaAssetSchema>;
export type SocialAgentQueryParams = z.infer<typeof socialAgentQueryParamsSchema>;
export type SocialAgentQueryResult = z.infer<typeof socialAgentQueryResultSchema>;
