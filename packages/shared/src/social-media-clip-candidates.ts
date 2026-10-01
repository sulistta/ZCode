import { z } from "zod";
import { socialAccountIdSchema } from "./social-account.js";
import { socialMediaIdSchema } from "./social-media-primitives.js";

export const socialMediaClipCandidateModeSchema = z.enum(["podcast", "music"]);
export const socialMediaClipCandidateUnavailableReasonSchema = z.enum([
  "unsupported-media-kind",
  "transcript-unavailable",
  "transcript-too-short",
  "audio-unavailable",
  "duration-out-of-range",
]);

export const socialMediaClipCandidateRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  mediaId: socialMediaIdSchema,
  mode: socialMediaClipCandidateModeSchema,
});

export const socialMediaClipCandidateEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("speech"),
    excerpt: z.string().trim().min(1).max(2_000),
    completePhrase: z.boolean(),
  }),
  z.object({
    kind: z.literal("pause"),
    beforeSeconds: z.number().finite().nonnegative().max(30),
    afterSeconds: z.number().finite().nonnegative().max(30),
  }),
  z.object({
    kind: z.literal("heatmap"),
    meanIntensity: z.number().finite().min(0).max(1),
    peakIntensity: z.number().finite().min(0).max(1),
  }),
  z.object({
    kind: z.literal("audio"),
    meanEnergy: z.number().finite().min(0).max(1),
    energyVariation: z.number().finite().min(0).max(1),
    onsetRate: z.number().finite().min(0).max(1),
  }),
  z.object({
    kind: z.literal("rhythm"),
    bpm: z.number().finite().min(60).max(200),
    confidence: z.number().finite().min(0).max(1),
  }),
  z.object({
    kind: z.literal("visual-change"),
    sampleTimesSeconds: z.array(z.number().finite().nonnegative()).max(30),
    maxChangeScore: z.number().finite().min(0).max(1),
  }),
]);

export const socialMediaClipCandidateSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    score: z.number().int().min(0).max(100),
    evidence: z.array(socialMediaClipCandidateEvidenceSchema).min(1).max(5),
  })
  .refine((candidate) => candidate.endSeconds > candidate.startSeconds);

export const socialMediaClipCandidateResultSchema = z.object({
  accountId: socialAccountIdSchema,
  mediaId: socialMediaIdSchema,
  mode: socialMediaClipCandidateModeSchema,
  candidates: z.array(socialMediaClipCandidateSchema).max(5),
  unavailableReason: socialMediaClipCandidateUnavailableReasonSchema.nullable(),
});

export type SocialMediaClipCandidateMode = z.infer<typeof socialMediaClipCandidateModeSchema>;
export type SocialMediaClipCandidateUnavailableReason = z.infer<
  typeof socialMediaClipCandidateUnavailableReasonSchema
>;
export type SocialMediaClipCandidateRequest = z.infer<typeof socialMediaClipCandidateRequestSchema>;
export type SocialMediaClipCandidateEvidence = z.infer<
  typeof socialMediaClipCandidateEvidenceSchema
>;
export type SocialMediaClipCandidate = z.infer<typeof socialMediaClipCandidateSchema>;
export type SocialMediaClipCandidateResult = z.infer<typeof socialMediaClipCandidateResultSchema>;
