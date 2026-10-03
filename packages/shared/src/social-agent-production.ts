import { z } from "zod";
import {
  socialMediaIdSchema,
  socialMediaJobSchema,
  socialMediaJobIdSchema,
} from "./social-media.js";
import {
  socialProjectIdSchema,
  socialProjectSummarySchema,
  socialProjectExportJobSchema,
} from "./social-project.js";

export const socialAgentMediaJobSchema = z.object({
  jobId: socialMediaJobIdSchema,
  sourceKind: socialMediaJobSchema.shape.sourceKind,
  state: socialMediaJobSchema.shape.state,
  downloadedBytes: socialMediaJobSchema.shape.downloadedBytes,
  totalBytes: socialMediaJobSchema.shape.totalBytes,
  etaSeconds: socialMediaJobSchema.shape.etaSeconds,
  mediaId: socialMediaIdSchema.nullable(),
  errorCode: socialMediaJobSchema.shape.errorCode,
  createdAt: socialMediaJobSchema.shape.createdAt,
  updatedAt: socialMediaJobSchema.shape.updatedAt,
});
export const socialAgentProjectSummarySchema = socialProjectSummarySchema.omit({ accountId: true });
export const socialAgentExportJobSchema = socialProjectExportJobSchema.omit({
  accountId: true,
  requestId: true,
  sha256: true,
});

export const socialAgentProductionParamsSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("import-source"), url: z.string().trim().min(1).max(2048) })
    .strict(),
  z
    .object({ action: z.literal("list-media-jobs"), jobId: socialMediaJobIdSchema.optional() })
    .strict(),
  z
    .object({
      action: z.literal("media-job-command"),
      jobId: socialMediaJobIdSchema,
      command: z.enum(["cancel", "retry"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("create-project"),
      displayName: z.string().trim().min(1).max(120),
      requestId: socialProjectIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("start-export"),
      projectId: socialProjectIdSchema,
      expectedRevision: z.number().int().nonnegative(),
      requestId: socialProjectIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("list-exports"),
      projectId: socialProjectIdSchema.optional(),
      exportId: socialProjectIdSchema.optional(),
    })
    .strict(),
]);

export const socialAgentProductionResultSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import-source"), job: socialAgentMediaJobSchema }).strict(),
  z
    .object({
      action: z.literal("list-media-jobs"),
      jobs: z.array(socialAgentMediaJobSchema).max(100),
    })
    .strict(),
  z.object({ action: z.literal("media-job-command"), job: socialAgentMediaJobSchema }).strict(),
  z
    .object({ action: z.literal("create-project"), project: socialAgentProjectSummarySchema })
    .strict(),
  z.object({ action: z.literal("start-export"), job: socialAgentExportJobSchema }).strict(),
  z
    .object({
      action: z.literal("list-exports"),
      jobs: z.array(socialAgentExportJobSchema).max(100),
    })
    .strict(),
]);

export type SocialAgentMediaJob = z.infer<typeof socialAgentMediaJobSchema>;
export type SocialAgentExportJob = z.infer<typeof socialAgentExportJobSchema>;
export type SocialAgentProjectSummary = z.infer<typeof socialAgentProjectSummarySchema>;
