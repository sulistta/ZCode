import { z } from "zod";
import { socialAccountIdSchema } from "./social-account.js";

export const instagramConnectionProfileSchema = z.object({
  instagramUserId: z.string().trim().min(1).max(128),
  username: z.string().trim().min(1).max(64),
  profilePictureUrl: z.string().url().nullable(),
});

export const instagramConnectionSchema = z.object({
  accountId: socialAccountIdSchema,
  status: z.enum(["disconnected", "connecting", "connected", "reauth-required"]),
  profile: instagramConnectionProfileSchema.nullable(),
  connectedAt: z.number().int().nonnegative().nullable(),
});

export const startInstagramConnectionRequestSchema = z.object({
  accountId: socialAccountIdSchema,
});

export const startInstagramConnectionResultSchema = z.object({
  state: z.string().min(32).max(128),
  authorizeUrl: z.string().url(),
  expiresAt: z.number().int().nonnegative(),
});

export const completeInstagramConnectionRequestSchema = z.object({
  state: z.string().min(32).max(128),
  handoffTicket: z.string().min(16).max(2048),
});

export const disconnectInstagramRequestSchema = z.object({
  accountId: socialAccountIdSchema,
});

export const instagramMediaSchema = z.object({
  mediaId: z.string().trim().min(1).max(128),
  mediaType: z.string().trim().min(1).max(32),
  caption: z.string().max(2_200).nullable(),
  permalink: z.string().url().nullable(),
  timestamp: z.string().datetime({ offset: true }).nullable(),
});

export const listInstagramMediaRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  limit: z.number().int().min(1).max(25).default(12),
});

export const instagramPublicationStatusSchema = z.enum([
  "approval-required",
  "preparing-media",
  "creating-container",
  "processing-container",
  "publishing",
  "published",
  "failed",
  "reconciliation-required",
  "not-published",
]);

export const instagramPublicationSchema = z
  .object({
    publicationId: z.string().uuid(),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
    accountId: socialAccountIdSchema,
    projectId: z.string().trim().min(1).max(120),
    projectRevision: z.number().int().nonnegative(),
    exportId: z.string().trim().min(1).max(120),
    exportSha256: z.string().regex(/^[\da-f]{64}$/u),
    fileSizeBytes: z.number().int().positive().max(1_073_741_824),
    durationMs: z.number().int().positive().max(900_000),
    caption: z.string().trim().min(1).max(2_200),
    status: instagramPublicationStatusSchema,
    mediaLeaseId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}$/u)
      .optional(),
    containerId: z.string().trim().min(1).max(128).optional(),
    containerStatus: z.string().trim().min(1).max(64).optional(),
    mediaId: z.string().trim().min(1).max(128).optional(),
    permalink: z.string().url().max(1024).optional(),
    errorCode: z
      .enum([
        "account-not-connected",
        "export-unavailable",
        "project-changed",
        "unsupported-video",
        "media-upload-failed",
        "container-rejected",
        "media-processing-failed",
        "publish-rejected",
        "remote-outcome-unknown",
        "media-not-found",
      ])
      .optional(),
    reconciliationReason: z
      .enum(["container-create-outcome-unknown", "publish-outcome-unknown", "host-restarted"])
      .optional(),
    reconciliationOutcome: z.enum(["published", "not-published"]).optional(),
    trigger: z.enum(["manual", "automation"]).optional(),
    approvedAt: z.number().int().nonnegative().optional(),
    automationAuthorizedAt: z.number().int().nonnegative().optional(),
    reconciledAt: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((publication, context) => {
    if (publication.status === "approval-required") {
      if (
        publication.approvedAt !== undefined ||
        publication.automationAuthorizedAt !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["approvedAt"],
          message: "A supervised proposal must wait for explicit user approval",
        });
      }
      return;
    }
    if (publication.approvedAt === undefined && publication.automationAuthorizedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["approvedAt"],
        message: "A publication attempt requires user approval or saved-policy authorization",
      });
    }
  });

export const approveInstagramPublicationRequestSchema = z
  .object({
    accountId: socialAccountIdSchema,
    exportId: z.string().trim().min(1).max(120),
    caption: z.string().trim().min(1).max(2_200),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
  })
  .strict();

export const approveInstagramPublicationProposalRequestSchema = z
  .object({
    accountId: socialAccountIdSchema,
    publicationId: z.string().uuid(),
  })
  .strict();

export const requestAutomatedInstagramPublicationRequestSchema = z
  .object({
    accountId: socialAccountIdSchema,
    exportId: z.string().trim().min(1).max(120),
    caption: z.string().trim().min(1).max(2_200),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
  })
  .strict();

const resolveInstagramPublicationRequestBase = {
  accountId: socialAccountIdSchema,
  publicationId: z.string().uuid(),
};

export const resolveInstagramPublicationRequestSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      ...resolveInstagramPublicationRequestBase,
      outcome: z.literal("published"),
      permalink: z.string().url().max(1024),
    })
    .strict(),
  z
    .object({
      ...resolveInstagramPublicationRequestBase,
      outcome: z.literal("not-published"),
    })
    .strict(),
]);

export type InstagramConnectionProfile = z.infer<typeof instagramConnectionProfileSchema>;
export type InstagramConnection = z.infer<typeof instagramConnectionSchema>;
export type InstagramMedia = z.infer<typeof instagramMediaSchema>;
export type InstagramPublication = z.infer<typeof instagramPublicationSchema>;
export type ApproveInstagramPublicationRequest = z.infer<
  typeof approveInstagramPublicationRequestSchema
>;
export type ApproveInstagramPublicationProposalRequest = z.infer<
  typeof approveInstagramPublicationProposalRequestSchema
>;
export type RequestAutomatedInstagramPublicationRequest = z.infer<
  typeof requestAutomatedInstagramPublicationRequestSchema
>;
export type ResolveInstagramPublicationRequest = z.infer<
  typeof resolveInstagramPublicationRequestSchema
>;
export type StartInstagramConnectionRequest = z.infer<typeof startInstagramConnectionRequestSchema>;
export type StartInstagramConnectionResult = z.infer<typeof startInstagramConnectionResultSchema>;
export type CompleteInstagramConnectionRequest = z.infer<
  typeof completeInstagramConnectionRequestSchema
>;
export type DisconnectInstagramRequest = z.infer<typeof disconnectInstagramRequestSchema>;
export type ListInstagramMediaRequest = z.input<typeof listInstagramMediaRequestSchema>;
