import { z } from "zod";
import type { JsonSchema } from "../model/index.js";

export const SOCIAL_MEDIA_IMPORT_TOOL_NAME = "SocialMediaImportUrl" as const;
export const SOCIAL_MEDIA_JOBS_TOOL_NAME = "SocialMediaJobs" as const;
export const SOCIAL_MEDIA_JOB_COMMAND_TOOL_NAME = "SocialMediaJobCommand" as const;
export const SOCIAL_PROJECT_CREATE_TOOL_NAME = "SocialProjectCreate" as const;
export const SOCIAL_PROJECT_EXPORT_TOOL_NAME = "SocialProjectExport" as const;
export const SOCIAL_PROJECT_EXPORTS_TOOL_NAME = "SocialProjectExports" as const;
export const SOCIAL_PRODUCTION_TOOL_NAMES = [
  SOCIAL_MEDIA_IMPORT_TOOL_NAME,
  SOCIAL_MEDIA_JOBS_TOOL_NAME,
  SOCIAL_MEDIA_JOB_COMMAND_TOOL_NAME,
  SOCIAL_PROJECT_CREATE_TOOL_NAME,
  SOCIAL_PROJECT_EXPORT_TOOL_NAME,
  SOCIAL_PROJECT_EXPORTS_TOOL_NAME,
] as const;

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const idJson: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
};
const jobIdJson: JsonSchema = { type: "string", format: "uuid" };
function object(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}
export const SocialMediaImportInputSchema = z
  .object({ url: z.string().trim().min(1).max(2048) })
  .strict();
export const SocialMediaJobsInputSchema = z
  .object({ jobId: z.string().uuid().optional() })
  .strict();
export const SocialMediaJobCommandInputSchema = z
  .object({ jobId: z.string().uuid(), action: z.enum(["cancel", "retry"]) })
  .strict();
export const SocialProjectCreateInputSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();
export const SocialProjectExportInputSchema = z
  .object({ projectId: idSchema, expectedRevision: z.number().int().nonnegative() })
  .strict();
export const SocialProjectExportsInputSchema = z
  .object({ projectId: idSchema.optional(), exportId: idSchema.optional() })
  .strict();

export const SocialMediaImportInputJsonSchema = object(
  { url: { type: "string", minLength: 1, maxLength: 2048 } },
  ["url"],
);
export const SocialMediaJobsInputJsonSchema = object({ jobId: jobIdJson });
export const SocialMediaJobCommandInputJsonSchema = object(
  { jobId: jobIdJson, action: { type: "string", enum: ["cancel", "retry"] } },
  ["jobId", "action"],
);
export const SocialProjectCreateInputJsonSchema = object(
  { displayName: { type: "string", minLength: 1, maxLength: 120 } },
  ["displayName"],
);
export const SocialProjectExportInputJsonSchema = object(
  { projectId: idJson, expectedRevision: { type: "integer", minimum: 0 } },
  ["projectId", "expectedRevision"],
);
export const SocialProjectExportsInputJsonSchema = object({ projectId: idJson, exportId: idJson });
