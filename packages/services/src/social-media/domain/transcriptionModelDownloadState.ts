import { z } from "zod";
import {
  socialMediaTranscriptionModelErrorSchema,
  socialMediaTranscriptionModelIdSchema,
} from "@social-harness/shared";

export const transcriptionModelDownloadStateSchema = z.object({
  modelId: socialMediaTranscriptionModelIdSchema,
  downloadId: z.string().uuid(),
  state: z.enum(["downloading", "complete", "failed", "cancelled"]),
  downloadedBytes: z.number().int().nonnegative().safe(),
  errorCode: socialMediaTranscriptionModelErrorSchema.nullable(),
  updatedAt: z.number().int().nonnegative().safe(),
});

export type TranscriptionModelDownloadState = z.infer<typeof transcriptionModelDownloadStateSchema>;
