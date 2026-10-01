import { z } from "zod";
import { socialProjectExportJobSchema, socialProjectSchema } from "@social-harness/shared";

export const socialProjectExportRecordSchema = z.object({
  job: socialProjectExportJobSchema,
  snapshot: socialProjectSchema,
});

export type SocialProjectExportRecord = z.infer<typeof socialProjectExportRecordSchema>;
