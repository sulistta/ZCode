import { z } from "zod";
import { MAX_TEMPORARY_MEDIA_BYTES } from "../app/ports/temporaryMediaStore.js";

export const manifestSchema = z
  .object({
    version: z.literal(1),
    leaseId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
    accountHash: z.string().regex(/^[a-f0-9]{64}$/u),
    capabilityHash: z.string().regex(/^[a-f0-9]{64}$/u),
    capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    idempotencyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    contentLength: z.number().int().positive().max(MAX_TEMPORARY_MEDIA_BYTES),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type MediaManifest = z.infer<typeof manifestSchema>;
