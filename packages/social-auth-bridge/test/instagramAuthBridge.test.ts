import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { createSocialAuthBridgeApp } from "../src/app.js";
import type { InstagramGraphTokenSet } from "../src/contract.js";
import { OAuthFlowStore } from "../src/adapters/oauthFlowStore.js";
import type { TemporaryMediaStore } from "../src/app/ports/temporaryMediaStore.js";

const state = "state-123".padEnd(43, "s");
const verifier = "verifier-123".padEnd(43, "v");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const handoffTicket = "handoff-ticket".padEnd(43, "h");
const accountId = "social-account-one";
const mediaCredential = "media-upload-token".padEnd(43, "m");
const accountHash = createHash("sha256").update(accountId).digest("hex");

function createHarness(options?: {
  now?: () => number;
  exchange?: () => Promise<InstagramGraphTokenSet>;
  additionalCredential?: string;
}) {
  let currentTime = 1_000;
  const activeCredentials = new Set([
    mediaCredential,
    ...(options?.additionalCredential ? [options.additionalCredential] : []),
  ]);
  let issuedCredentialCount = 0;
  let accountMediaDeleted = false;
  const calls: { url: string; init?: RequestInit }[] = [];
  const oauthClient = {
    async exchangeAuthorizationCode(code: string, redirectUri: string) {
      calls.push({ url: `exchange:${code}:${redirectUri}` });
      return (
        options?.exchange?.() ??
        Promise.resolve({ accessToken: "long-lived-token", expiresAt: currentTime + 60_000 })
      );
    },
  };
  const mediaCredentialStore = {
    async initialize() {},
    async issue() {
      issuedCredentialCount += 1;
      activeCredentials.add(mediaCredential);
      return mediaCredential;
    },
    async authenticate(value: string) {
      return activeCredentials.has(value) ? accountHash : null;
    },
    async revoke(value: string) {
      if (!activeCredentials.delete(value)) return null;
      return { accountHash, remainingCredentials: activeCredentials.size };
    },
    async revokeAll(value: string) {
      if (!activeCredentials.has(value)) return null;
      activeCredentials.clear();
      return accountHash;
    },
  };
  const uploads: { accountHash: string; bytes: Uint8Array; sha256: string }[] = [];
  const temporaryMediaStore: TemporaryMediaStore = {
    async initialize() {},
    async upload(input) {
      const bytes = new Uint8Array(await new Response(input.body).arrayBuffer());
      uploads.push({ accountHash: input.accountHash, bytes, sha256: input.expectedSha256 });
      return {
        leaseId: "lease-id".padEnd(22, "l"),
        capability: "public-capability".padEnd(43, "c"),
        expiresAt: 9_999_999,
      };
    },
    async read() {
      if (accountMediaDeleted) return null;
      return {
        body: Readable.from([Buffer.from("video")]),
        contentLength: 5,
        expiresAt: 9_999_999,
      };
    },
    async delete() {
      return true;
    },
    async deleteAccount() {
      accountMediaDeleted = true;
    },
  };
  const app = createSocialAuthBridgeApp({
    publicBaseUrl: "https://auth.example.test",
    instagramAppId: "instagram-app-id",
    oauthClient,
    mediaCredentialStore,
    temporaryMediaStore,
    flowStore: new OAuthFlowStore(options?.now ?? (() => currentTime), () => handoffTicket),
  });
  return {
    app,
    calls,
    uploads,
    get issuedCredentialCount() {
      return issuedCredentialCount;
    },
    setNow(value: number) {
      currentTime = value;
    },
  };
}

async function startAuthorization(app: ReturnType<typeof createHarness>["app"]) {
  const response = await app.request("/v1/instagram/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, codeChallenge: challenge, accountId }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { authorizeUrl: string };
}

test("authorize requests only current Instagram Login scopes and uses the configured callback", async () => {
  const harness = createHarness();
  const { authorizeUrl } = await startAuthorization(harness.app);
  const authorization = new URL(authorizeUrl);

  assert.equal(authorization.origin, "https://www.instagram.com");
  assert.equal(authorization.pathname, "/oauth/authorize");
  assert.equal(authorization.searchParams.get("state"), state);
  assert.equal(
    authorization.searchParams.get("scope"),
    "instagram_business_basic,instagram_business_content_publish",
  );
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    "https://auth.example.test/v1/instagram/callback",
  );
});

test("Meta callback exchanges code, redirects only an opaque ticket, then redeems once with PKCE", async () => {
  const harness = createHarness();
  await startAuthorization(harness.app);
  const callback = await harness.app.request(
    `/v1/instagram/callback?state=${state}&code=meta-authorization-code`,
  );
  assert.equal(harness.issuedCredentialCount, 0);
  assert.equal(callback.status, 302);
  const desktopCallback = new URL(callback.headers.get("location")!);
  assert.equal(desktopCallback.protocol, "social-harness:");
  assert.equal(desktopCallback.searchParams.get("state"), state);
  assert.equal(desktopCallback.searchParams.get("code"), handoffTicket);
  assert.equal(desktopCallback.searchParams.has("access_token"), false);

  const redeemed = await harness.app.request("/v1/instagram/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffTicket, codeVerifier: verifier }),
  });
  assert.equal(redeemed.status, 200);
  assert.equal(harness.issuedCredentialCount, 1);
  assert.deepEqual(await redeemed.json(), {
    accessToken: "long-lived-token",
    expiresAt: 61_000,
    mediaUploadCredential: mediaCredential,
  });
  assert.equal(harness.calls.length, 1);

  const replay = await harness.app.request("/v1/instagram/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffTicket, codeVerifier: verifier }),
  });
  assert.equal(replay.status, 410);
});

test("wrong PKCE verifier cannot redeem or consume a handoff ticket", async () => {
  const harness = createHarness();
  await startAuthorization(harness.app);
  await harness.app.request(`/v1/instagram/callback?state=${state}&code=meta-code`);
  const wrongVerifier = "wrong-verifier".padEnd(43, "w");

  const rejected = await harness.app.request("/v1/instagram/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffTicket, codeVerifier: wrongVerifier }),
  });
  assert.equal(rejected.status, 410);

  const accepted = await harness.app.request("/v1/instagram/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffTicket, codeVerifier: verifier }),
  });
  assert.equal(accepted.status, 200);
});

test("an unredeemed OAuth handoff expires without allocating a media credential", async () => {
  const harness = createHarness();
  await startAuthorization(harness.app);
  const callback = await harness.app.request(
    `/v1/instagram/callback?state=${state}&code=meta-code`,
  );
  const ticket = new URL(callback.headers.get("location")!).searchParams.get("code")!;
  assert.equal(harness.issuedCredentialCount, 0);

  harness.setNow(1_000 + 5 * 60 * 1_000);
  const expired = await harness.app.request("/v1/instagram/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffTicket: ticket, codeVerifier: verifier }),
  });

  assert.equal(expired.status, 410);
  assert.equal(harness.issuedCredentialCount, 0);
});

test("denied and expired browser flows fail closed without returning credentials", async () => {
  const harness = createHarness();
  await startAuthorization(harness.app);
  const denied = await harness.app.request(
    `/v1/instagram/callback?state=${state}&error=access_denied`,
  );
  const deniedTicket = new URL(denied.headers.get("location")!).searchParams.get("code")!;
  const denial = await harness.app.request("/v1/instagram/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffTicket: deniedTicket, codeVerifier: verifier }),
  });
  assert.equal(denial.status, 403);

  const expiredState = "expired-state".padEnd(43, "e");
  await harness.app.request("/v1/instagram/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: expiredState, codeChallenge: challenge, accountId }),
  });
  harness.setNow(1_000 + 5 * 60 * 1_000);
  const expired = await harness.app.request(
    `/v1/instagram/callback?state=${expiredState}&code=meta-code`,
  );
  assert.equal(expired.status, 400);
});

test("bridge rejects non-HTTPS public origins and malformed state", async () => {
  assert.throws(() =>
    createSocialAuthBridgeApp({
      publicBaseUrl: "http://auth.example.test",
      instagramAppId: "app-id",
      oauthClient: { exchangeAuthorizationCode: async () => ({ accessToken: "x", expiresAt: 1 }) },
      mediaCredentialStore: {
        initialize: async () => {},
        issue: async () => mediaCredential,
        authenticate: async () => accountHash,
        revoke: async () => ({ accountHash, remainingCredentials: 0 }),
        revokeAll: async () => accountHash,
      },
      temporaryMediaStore: {
        initialize: async () => {},
        upload: async () => ({
          leaseId: "lease-id".padEnd(22, "l"),
          capability: "c".repeat(43),
          expiresAt: 1,
        }),
        read: async () => null,
        delete: async () => false,
        deleteAccount: async () => {},
      },
    }),
  );
  const harness = createHarness();
  const invalid = await harness.app.request("/v1/instagram/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "short", codeChallenge: challenge, accountId }),
  });
  assert.equal(invalid.status, 400);
});

test("media ingress verifies the account credential and returns only a temporary capability URL", async () => {
  const harness = createHarness();
  const bytes = Buffer.from("approved-video");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const response = await harness.app.request("/v1/media/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${mediaCredential}`,
      "x-social-account-id": accountId,
      "idempotency-key": "publication-request-id",
      "x-content-sha256": sha256,
      "content-type": "video/mp4",
      "content-length": String(bytes.length),
    },
    body: bytes,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    leaseId: "lease-id".padEnd(22, "l"),
    mediaUrl: `https://auth.example.test/v1/media/${"public-capability".padEnd(43, "c")}`,
    expiresAt: 9_999_999,
  });
  assert.equal(harness.uploads[0]?.accountHash, accountHash);
  assert.deepEqual(Buffer.from(harness.uploads[0]?.bytes ?? []), bytes);

  const wrongAccount = await harness.app.request("/v1/media/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${mediaCredential}`,
      "x-social-account-id": "another-account",
      "idempotency-key": "publication-request-id",
      "x-content-sha256": sha256,
      "content-type": "video/mp4",
      "content-length": String(bytes.length),
    },
    body: bytes,
  });
  assert.equal(wrongAccount.status, 401);
  assert.equal(harness.uploads.length, 1);
});

test("public media capability serves only MP4 with no-store headers", async () => {
  const harness = createHarness();
  const response = await harness.app.request(`/v1/media/${"public-capability".padEnd(43, "c")}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "video");
});

test("credential revocation deletes its media and blocks later uploads", async () => {
  const harness = createHarness();
  const revoked = await harness.app.request("/v1/media/credential", {
    method: "DELETE",
    headers: { authorization: `Bearer ${mediaCredential}` },
  });
  assert.equal(revoked.status, 204);

  const media = await harness.app.request(`/v1/media/${"public-capability".padEnd(43, "c")}`);
  assert.equal(media.status, 404);
  const upload = await harness.app.request("/v1/media/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${mediaCredential}`,
      "x-social-account-id": accountId,
      "idempotency-key": "publication-request-id",
      "x-content-sha256": createHash("sha256").update("video").digest("hex"),
      "content-type": "video/mp4",
      "content-length": "5",
    },
    body: "video",
  });
  assert.equal(upload.status, 401);
});

test("reconnect-key cleanup preserves media until authenticated revoke-all", async () => {
  const oldCredential = "previous-media-upload-token".padEnd(43, "o");
  const harness = createHarness({ additionalCredential: oldCredential });
  const oldKeyRevoked = await harness.app.request("/v1/media/credential", {
    method: "DELETE",
    headers: { authorization: `Bearer ${mediaCredential}` },
  });
  assert.equal(oldKeyRevoked.status, 204);
  const mediaBeforeDisconnect = await harness.app.request(
    `/v1/media/${"public-capability".padEnd(43, "c")}`,
  );
  assert.equal(mediaBeforeDisconnect.status, 200);

  const disconnected = await harness.app.request("/v1/media/credentials", {
    method: "DELETE",
    headers: { authorization: `Bearer ${oldCredential}` },
  });
  assert.equal(disconnected.status, 204);
  const mediaAfterDisconnect = await harness.app.request(
    `/v1/media/${"public-capability".padEnd(43, "c")}`,
  );
  assert.equal(mediaAfterDisconnect.status, 404);
  const revokedUpload = await harness.app.request("/v1/media/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${oldCredential}`,
      "x-social-account-id": accountId,
      "idempotency-key": "publication-request-id",
      "x-content-sha256": createHash("sha256").update("video").digest("hex"),
      "content-type": "video/mp4",
      "content-length": "5",
    },
    body: "video",
  });
  assert.equal(revokedUpload.status, 401);
});
