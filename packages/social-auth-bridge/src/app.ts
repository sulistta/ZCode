import { Hono } from "hono";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { MetaInstagramOAuthClient } from "./adapters/metaInstagramOAuthClient.js";
import { OAuthFlowStore } from "./adapters/oauthFlowStore.js";
import type { MediaCredentialStore } from "./app/ports/mediaCredentialStore.js";
import {
  MAX_TEMPORARY_MEDIA_BYTES,
  TemporaryMediaStoreError,
  type TemporaryMediaStore,
} from "./app/ports/temporaryMediaStore.js";
import type { InstagramAuthAuthorizeRequest, InstagramAuthRedeemRequest } from "./contract.js";

export type {
  InstagramAuthAuthorizeRequest,
  InstagramAuthAuthorizeResponse,
  InstagramAuthRedeemRequest,
  InstagramAuthTokenSet,
} from "./contract.js";

const authorizeRequestSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    accountId: z.string().trim().min(1).max(128),
  })
  .strict();

const redeemRequestSchema = z
  .object({
    handoffTicket: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  })
  .strict();

export interface SocialAuthBridgeOptions {
  publicBaseUrl: string;
  instagramAppId: string;
  oauthClient: MetaInstagramOAuthClient;
  mediaCredentialStore: MediaCredentialStore;
  temporaryMediaStore: TemporaryMediaStore;
  flowStore?: OAuthFlowStore;
}

const accountIdSchema = z.string().trim().min(1).max(128);
const leaseIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readBearerCredential(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/u.exec(header ?? "");
  return match?.[1] ?? null;
}

function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("SOCIAL_AUTH_BRIDGE_PUBLIC_BASE_URL must be an HTTPS origin");
  }
  return url.origin;
}

function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  url.searchParams.set("state", input.state);
  return url.toString();
}

function buildDesktopCallback(state: string, handoffTicket: string): string {
  const callback = new URL("social-harness://oauth/callback");
  callback.searchParams.set("state", state);
  // The existing deep-link router forwards `code`; this value is an opaque one-time ticket.
  callback.searchParams.set("code", handoffTicket);
  return callback.toString();
}

export function createSocialAuthBridgeApp(options: SocialAuthBridgeOptions) {
  if (!options.instagramAppId.trim()) throw new Error("Instagram app id is required");
  const baseUrl = normalizePublicBaseUrl(options.publicBaseUrl);
  const redirectUri = `${baseUrl}/v1/instagram/callback`;
  const flowStore = options.flowStore ?? new OAuthFlowStore();
  const app = new Hono();

  app.get("/healthz", (context) => context.json({ status: "ok" }));

  app.post("/v1/instagram/authorize", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "invalid_request" }, 400);
    }
    const input = authorizeRequestSchema.safeParse(body);
    if (!input.success) return context.json({ error: "invalid_request" }, 400);
    try {
      const request: InstagramAuthAuthorizeRequest = input.data;
      flowStore.begin(request.state, request.codeChallenge, request.accountId);
    } catch {
      return context.json({ error: "authorization_unavailable" }, 503);
    }
    return context.json({
      authorizeUrl: buildAuthorizeUrl({
        appId: options.instagramAppId,
        redirectUri,
        state: input.data.state,
      }),
    });
  });

  app.get("/v1/instagram/callback", async (context) => {
    const state = context.req.query("state") ?? "";
    const flow = flowStore.consumeState(state);
    if (!flow)
      return context.text(
        "This Instagram login expired. Return to Social Harness and try again.",
        400,
      );

    const code = context.req.query("code");
    const denied = context.req.query("error") != null || !code;
    let payload:
      | { kind: "denied" }
      | { kind: "tokens"; accountId: string; tokens: { accessToken: string; expiresAt: number } };
    if (denied) {
      payload = { kind: "denied" };
    } else {
      try {
        const tokens = await options.oauthClient.exchangeAuthorizationCode(code, redirectUri);
        payload = { kind: "tokens", accountId: flow.accountId, tokens };
      } catch {
        payload = { kind: "denied" };
      }
    }
    try {
      const handoffTicket = flowStore.issueTicket(flow.codeChallenge, payload);
      return context.redirect(buildDesktopCallback(state, handoffTicket), 302);
    } catch {
      return context.text(
        "Instagram login could not be completed. Return to Social Harness and try again.",
        503,
      );
    }
  });

  app.post("/v1/instagram/redeem", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "invalid_request" }, 400);
    }
    const input = redeemRequestSchema.safeParse(body);
    if (!input.success) return context.json({ error: "invalid_request" }, 400);
    const request: InstagramAuthRedeemRequest = input.data;
    const payload = flowStore.redeemTicket(request.handoffTicket, request.codeVerifier);
    if (!payload) return context.json({ error: "handoff_invalid" }, 410);
    if (payload.kind === "denied") return context.json({ error: "authorization_denied" }, 403);
    try {
      // 未兑换的 OAuth 票据可能过期或被放弃；在 Host 证明 PKCE 后才创建上传凭据，避免留下孤儿权限。
      const mediaUploadCredential = await options.mediaCredentialStore.issue(payload.accountId);
      return context.json({ ...payload.tokens, mediaUploadCredential });
    } catch {
      return context.json({ error: "media_store_unavailable" }, 503);
    }
  });

  app.post("/v1/media/upload", async (context) => {
    const rawLength = context.req.header("content-length");
    const contentLength =
      rawLength === undefined
        ? null
        : /^\d{1,10}$/u.test(rawLength)
          ? Number(rawLength)
          : Number.NaN;
    if (contentLength !== null && !Number.isSafeInteger(contentLength)) {
      return context.json({ error: "invalid_media" }, 400);
    }
    if (contentLength !== null && contentLength > MAX_TEMPORARY_MEDIA_BYTES) {
      return context.json({ error: "media_too_large" }, 413);
    }
    if (contentLength === 0) {
      return context.json({ error: "invalid_media" }, 400);
    }
    if (context.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "video/mp4") {
      return context.json({ error: "invalid_media" }, 400);
    }
    const accountId = accountIdSchema.safeParse(context.req.header("x-social-account-id"));
    const credential = readBearerCredential(context.req.header("authorization"));
    const idempotencyKey = context.req.header("idempotency-key") ?? "";
    const body = context.req.raw.body;
    const expectedSha256 = context.req.header("x-content-sha256") ?? "";
    if (
      !accountId.success ||
      !credential ||
      !body ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(idempotencyKey) ||
      !/^[a-f0-9]{64}$/u.test(expectedSha256)
    ) {
      return context.json({ error: "invalid_request" }, 400);
    }
    let accountHash: string | null;
    try {
      accountHash = await options.mediaCredentialStore.authenticate(credential);
    } catch {
      return context.json({ error: "media_store_unavailable" }, 503);
    }
    if (!accountHash || accountHash !== digest(accountId.data)) {
      return context.json({ error: "unauthorized" }, 401);
    }
    try {
      const upload = await options.temporaryMediaStore.upload({
        accountHash,
        body,
        contentLength,
        idempotencyKey,
        expectedSha256,
      });
      return context.json({
        leaseId: upload.leaseId,
        mediaUrl: new URL(`/v1/media/${upload.capability}`, baseUrl).toString(),
        expiresAt: upload.expiresAt,
      });
    } catch (error) {
      if (error instanceof TemporaryMediaStoreError) {
        const status =
          error.code === "invalid_media"
            ? 400
            : error.code === "media_too_large"
              ? 413
              : error.code === "media_conflict"
                ? 409
                : error.code === "media_capacity"
                  ? 507
                  : 503;
        return context.json({ error: error.code }, status);
      }
      return context.json({ error: "media_store_unavailable" }, 503);
    }
  });

  app.delete("/v1/media/credential", async (context) => {
    const credential = readBearerCredential(context.req.header("authorization"));
    if (!credential) return context.json({ error: "unauthorized" }, 401);
    try {
      const revoked = await options.mediaCredentialStore.revoke(credential);
      if (revoked && revoked.remainingCredentials === 0) {
        await options.temporaryMediaStore.deleteAccount(revoked.accountHash);
      }
      return context.body(null, 204);
    } catch {
      return context.json({ error: "media_store_unavailable" }, 503);
    }
  });

  app.delete("/v1/media/credentials", async (context) => {
    const credential = readBearerCredential(context.req.header("authorization"));
    if (!credential) return context.json({ error: "unauthorized" }, 401);
    try {
      const accountHash = await options.mediaCredentialStore.revokeAll(credential);
      if (accountHash) await options.temporaryMediaStore.deleteAccount(accountHash);
      return context.body(null, 204);
    } catch {
      return context.json({ error: "media_store_unavailable" }, 503);
    }
  });

  app.delete("/v1/media/:leaseId", async (context) => {
    const leaseId = leaseIdSchema.safeParse(context.req.param("leaseId"));
    const accountId = accountIdSchema.safeParse(context.req.header("x-social-account-id"));
    const credential = readBearerCredential(context.req.header("authorization"));
    if (!leaseId.success || !accountId.success || !credential) {
      return context.json({ error: "invalid_request" }, 400);
    }
    try {
      const accountHash = await options.mediaCredentialStore.authenticate(credential);
      if (!accountHash || accountHash !== digest(accountId.data)) {
        return context.json({ error: "unauthorized" }, 401);
      }
      const deleted = await options.temporaryMediaStore.delete(accountHash, leaseId.data);
      return deleted ? context.body(null, 204) : context.json({ error: "media_not_found" }, 404);
    } catch {
      return context.json({ error: "media_store_unavailable" }, 503);
    }
  });

  app.get("/v1/media/:capability", async (context) => {
    const capability = context.req.param("capability");
    try {
      const media = await options.temporaryMediaStore.read(capability);
      if (!media) return context.json({ error: "media_not_found" }, 404);
      const body = Readable.toWeb(media.body) as ReadableStream<Uint8Array>;
      return context.body(body, 200, {
        "content-length": String(media.contentLength),
        "content-type": "video/mp4",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
      });
    } catch {
      return context.json({ error: "media_store_unavailable" }, 503);
    }
  });

  return app;
}
