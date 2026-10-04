import { z } from "zod";

export const socialMediaPreviewProxySchema = z.object({
  profileVersion: z.literal(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().safe(),
  durationSeconds: z.number().finite().positive(),
  createdAt: z.number().int().nonnegative().safe(),
});
export type SocialMediaPreviewProxy = z.infer<typeof socialMediaPreviewProxySchema>;
