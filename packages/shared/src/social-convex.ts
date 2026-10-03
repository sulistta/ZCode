import { z } from "zod";
export const convexDeploymentUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.cloud$/u.test(url.hostname) &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Use the production deployment URL from the Convex dashboard");
export const instagramBridgeConfigurationSchema = z
  .object({
    version: z.literal(1),
    deploymentUrl: convexDeploymentUrlSchema,
    configuredAt: z.number().int().nonnegative(),
  })
  .strict();
export const instagramBridgeSetupSchema = z
  .object({
    stage: z.enum(["project", "meta", "ready"]),
    deploymentUrl: convexDeploymentUrlSchema.nullable(),
    callbackUrl: z.string().url().nullable(),
    dashboardUrl: z.string().url(),
    metaDashboardUrl: z.literal("https://developers.facebook.com/apps/"),
    backendVersion: z.number().int().nullable(),
    metaConfigured: z.boolean(),
  })
  .strict();
export const provisionInstagramBridgeRequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("existing"),
      deploymentUrl: convexDeploymentUrlSchema,
      provisioningCredential: z.string().min(20).max(8192),
    })
    .strict(),
  z
    .object({
      mode: z.literal("create"),
      projectName: z.string().trim().min(1).max(64),
      provisioningCredential: z.string().min(20).max(8192),
    })
    .strict(),
]);
export type InstagramBridgeConfiguration = z.infer<typeof instagramBridgeConfigurationSchema>;
export type InstagramBridgeSetup = z.infer<typeof instagramBridgeSetupSchema>;
export type ProvisionInstagramBridgeRequest = z.infer<typeof provisionInstagramBridgeRequestSchema>;

/** Host/Main payload only; no RPC projection may return this record. */
export const instagramSecureCredentialSchema = z
  .object({
    accessToken: z.string().trim().min(1).max(8192),
    expiresAt: z.number().int().nonnegative().optional(),
    refreshedAt: z.number().int().nonnegative().optional(),
    mediaUploadCredential: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43,128}$/u)
      .optional(),
    bridgeOrigin: z
      .string()
      .url()
      .refine((value) => /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.site$/u.test(value))
      .optional(),
    bridgeInstallationHash: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/u)
      .optional(),
  })
  .strict();
export const configureInstagramBridgeMetaRequestSchema = z
  .object({
    provisioningCredential: z.string().min(20).max(8192),
    appId: z.string().regex(/^\d{5,30}$/u),
    appSecret: z.string().trim().min(16).max(1024),
  })
  .strict();
export type ConfigureInstagramBridgeMetaRequest = z.infer<
  typeof configureInstagramBridgeMetaRequestSchema
>;
