import { z } from "zod";
import { socialAccountIdSchema } from "./social-account.js";
import { socialMediaIdSchema, socialMediaYouTubeVideoIdSchema } from "./social-media-primitives.js";
import {
  normalizeSocialMediaSourceUrl,
  socialMediaSourceKeySchema,
} from "./social-media-source.js";
const socialMediaJobIdSchema = z.string().uuid();
export const socialMediaJobStateSchema = z.enum([
  "queued",
  "downloading",
  "transcribing",
  "proxying",
  "finalizing",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
]);

export const socialMediaJobErrorCodeSchema = z.enum([
  "tool-unavailable",
  "download-failed",
  "output-invalid",
  "transcription-model-unavailable",
  "transcription-tool-unavailable",
  "transcription-output-invalid",
  "transcription-failed",
  "preview-proxy-failed",
  "preview-proxy-tool-unavailable",
]);

export const socialMediaJobSchema = z
  .object({
    jobId: socialMediaJobIdSchema,
    accountId: socialAccountIdSchema,
    sourceKind: z.enum(["youtube", "remote-url", "preview-proxy"]).default("youtube"),
    sourceKey: z
      .union([socialMediaSourceKeySchema, z.string().regex(/^preview-[a-f0-9-]{36}$/)])
      .optional(),
    sourceOrigin: z.enum(["youtube-search", "video-url", "preview"]).default("video-url"),
    sourceVideoId: socialMediaYouTubeVideoIdSchema.optional(),
    sourceUrl: z.string().url().optional(),
    state: socialMediaJobStateSchema,
    downloadedBytes: z.number().int().nonnegative().safe(),
    totalBytes: z.number().int().positive().safe().nullable(),
    etaSeconds: z.number().int().nonnegative().nullable(),
    processedSeconds: z.number().finite().nonnegative().optional(),
    durationSeconds: z.number().finite().positive().optional(),
    mediaId: socialMediaIdSchema.nullable(),
    errorCode: socialMediaJobErrorCodeSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((job, context) => {
    if (job.sourceKind === "youtube") {
      if (
        job.sourceOrigin === "preview" ||
        !job.sourceVideoId ||
        job.sourceUrl !== `https://www.youtube.com/watch?v=${job.sourceVideoId}` ||
        (job.sourceKey !== undefined && job.sourceKey !== job.sourceVideoId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "YouTube job source must match its validated video ID",
        });
      }
    } else if (job.sourceKind === "remote-url") {
      const normalizedSource = job.sourceUrl ? normalizeSocialMediaSourceUrl(job.sourceUrl) : null;
      if (
        job.sourceOrigin !== "video-url" ||
        !normalizedSource ||
        normalizedSource.sourceKind !== "remote-url" ||
        normalizedSource.sourceUrl !== job.sourceUrl ||
        !job.sourceKey?.startsWith("url-")
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "Remote URL job must retain its canonical source key and URL",
        });
      }
    }
    if (
      job.sourceKind === "preview-proxy" &&
      (job.mediaId === null ||
        job.sourceKey !== `preview-${job.mediaId}` ||
        job.sourceUrl !== undefined ||
        job.sourceVideoId !== undefined ||
        job.sourceOrigin !== "preview")
    ) {
      context.addIssue({
        code: "custom",
        message: "Preview jobs must identify their owned media without a remote source",
      });
    }
    if (job.state === "proxying" && job.sourceKind !== "preview-proxy") {
      context.addIssue({ code: "custom", message: "Only preview jobs can transcode a proxy" });
    }
    if (
      job.sourceKind === "preview-proxy" &&
      ["downloading", "transcribing", "finalizing"].includes(job.state)
    ) {
      context.addIssue({
        code: "custom",
        message: "Preview jobs cannot enter source download or transcription states",
      });
    }
    if (job.state === "transcribing" && job.mediaId === null) {
      context.addIssue({
        code: "custom",
        path: ["mediaId"],
        message: "A transcribing job must point to its durable source asset",
      });
    }
  });

export type SocialMediaJob = z.infer<typeof socialMediaJobSchema>;
