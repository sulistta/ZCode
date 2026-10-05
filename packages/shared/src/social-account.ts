import { z } from "zod";

export const SOCIAL_ACCOUNT_ID_MAX_LENGTH = 120;
export const EDITORIAL_PROFILE_LIST_LIMIT = 24;
export const EDITORIAL_TEXT_MAX_LENGTH = 1200;

export const socialAccountIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOCIAL_ACCOUNT_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const SOCIAL_ACCOUNT_WORKSPACE_IDENTITY_PREFIX = "social-account:";

export function createSocialAccountWorkspaceIdentity(accountId: string): string {
  return `${SOCIAL_ACCOUNT_WORKSPACE_IDENTITY_PREFIX}${socialAccountIdSchema.parse(accountId)}`;
}

export function parseSocialAccountWorkspaceIdentity(identity: string | undefined): string | null {
  if (!identity?.startsWith(SOCIAL_ACCOUNT_WORKSPACE_IDENTITY_PREFIX)) return null;
  const accountId = identity.slice(SOCIAL_ACCOUNT_WORKSPACE_IDENTITY_PREFIX.length);
  const parsed = socialAccountIdSchema.safeParse(accountId);
  return parsed.success && createSocialAccountWorkspaceIdentity(parsed.data) === identity
    ? parsed.data
    : null;
}

export const editorialTextSchema = z.string().trim().min(1).max(EDITORIAL_TEXT_MAX_LENGTH);

export const editorialMemoryEntrySchema = z.object({
  id: z.string().trim().min(1).max(120),
  text: editorialTextSchema,
  source: z.enum(["user", "learned"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const editorialProfileSchema = z.object({
  niche: editorialTextSchema,
  audience: editorialTextSchema,
  language: z.string().trim().min(2).max(48),
  tone: z.array(editorialTextSchema).max(EDITORIAL_PROFILE_LIST_LIMIT),
  references: z.array(editorialTextSchema).max(EDITORIAL_PROFILE_LIST_LIMIT),
  preferredSources: z
    .array(z.enum(["youtube-search", "video-url", "local-file"]))
    .max(3)
    .refine((values) => new Set(values).size === values.length),
  visualStyle: editorialTextSchema,
  memory: z.array(editorialMemoryEntrySchema).max(EDITORIAL_PROFILE_LIST_LIMIT),
});

export const socialAutomationPolicySchema = z.discriminatedUnion("autonomyEnabled", [
  z.object({
    autonomyEnabled: z.literal(false),
  }),
  z.object({
    autonomyEnabled: z.literal(true),
    allowedSources: z
      .array(z.enum(["youtube-search", "video-url", "local-file"]))
      .min(1)
      .max(3)
      .refine((values) => new Set(values).size === values.length),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    maxPublicationsPerDay: z.number().int().min(1).max(25),
  }),
]);

export const socialAccountSchema = z.object({
  accountId: socialAccountIdSchema,
  platform: z.literal("instagram"),
  displayName: editorialTextSchema,
  editorialProfile: editorialProfileSchema,
  automationPolicy: socialAutomationPolicySchema,
  workspaceIdentity: z.string().trim().min(1).max(512),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const socialAccountConversationWorkspaceSchema = z
  .object({
    workspaceIdentity: z.string().trim().min(1).max(512),
    workspacePath: z.string().trim().min(1).max(4096),
  })
  .strict();

export const socialAccountConversationWorkspaceRequestSchema = z
  .object({
    workspaceIdentity: z.string().trim().min(1).max(512).optional(),
    workspacePath: z.string().trim().min(1).max(4096),
  })
  .strict();

export const createSocialAccountRequestSchema = z.object({
  displayName: editorialTextSchema,
  editorialProfile: editorialProfileSchema,
});

export const updateSocialAccountEditorialRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  expectedUpdatedAt: z.number().int().nonnegative(),
  displayName: editorialTextSchema,
  editorialProfile: editorialProfileSchema,
});

export const updateSocialAccountPolicyRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  expectedUpdatedAt: z.number().int().nonnegative(),
  automationPolicy: socialAutomationPolicySchema,
});

export type SocialAccount = z.infer<typeof socialAccountSchema>;
export type CreateSocialAccountRequest = z.infer<typeof createSocialAccountRequestSchema>;
export type EditorialMemoryEntry = z.infer<typeof editorialMemoryEntrySchema>;
export type EditorialProfile = z.infer<typeof editorialProfileSchema>;
export type SocialAutomationPolicy = z.infer<typeof socialAutomationPolicySchema>;
export type SocialAccountConversationWorkspace = z.infer<
  typeof socialAccountConversationWorkspaceSchema
>;
export type SocialAccountConversationWorkspaceRequest = z.infer<
  typeof socialAccountConversationWorkspaceRequestSchema
>;
export type UpdateSocialAccountEditorialRequest = z.infer<
  typeof updateSocialAccountEditorialRequestSchema
>;
export type UpdateSocialAccountPolicyRequest = z.infer<
  typeof updateSocialAccountPolicyRequestSchema
>;
