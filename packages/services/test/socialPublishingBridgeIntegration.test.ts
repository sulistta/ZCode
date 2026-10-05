import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import type { SocialAccount } from "@social-harness/shared";
import type { InstagramGraphTokenSet } from "../../social-auth-bridge/src/contract.js";
import type { InstagramAuthTokenSet } from "../src/social-publishing/app/ports/instagramAuthBridge.js";
import type { TemporaryMediaStore } from "../../social-auth-bridge/src/app/ports/temporaryMediaStore.js";
import { createSocialAuthBridgeApp } from "../../social-auth-bridge/src/app.js";
import { createInstagramAuthBridgeHttpClient } from "../src/social-publishing/adapters/instagramAuthBridgeHttpClient.js";
import { createSocialPublishingService } from "../src/social-publishing/app/socialPublishingService.js";
import type { InstagramConnectionProfile } from "@social-harness/shared";

test("Host and HTTPS bridge complete a single-use PKCE connection without exposing tokens", async () => {
  const account = { accountId: "account-one" } as SocialAccount;
  const storedTokens = new Map<string, InstagramAuthTokenSet>();
  const storedProfiles = new Map<
    string,
    { profile: InstagramConnectionProfile; connectedAt: number }
  >();
  const credentialsByAccount = new Map<string, Set<string>>();
  let mediaCredentialSequence = 0;
  let oldCredentialForReconnect: string | undefined;
  let verificationFailure = false;
  let signalOldCredentialRevocation!: () => void;
  const oldCredentialRevoked = new Promise<void>((resolve) => {
    signalOldCredentialRevocation = resolve;
  });
  const mediaCredentialStore = {
    async initialize() {},
    async issue(accountId: string) {
      const credential = `media-credential-${accountId}-${++mediaCredentialSequence}`.padEnd(
        43,
        "m",
      );
      const credentials = credentialsByAccount.get(accountId) ?? new Set<string>();
      credentials.add(credential);
      credentialsByAccount.set(accountId, credentials);
      return credential;
    },
    async authenticate(credential: string) {
      const entry = [...credentialsByAccount].find(([, values]) => values.has(credential));
      return entry ? createHash("sha256").update(entry[0]).digest("hex") : null;
    },
    async revoke(credential: string) {
      for (const [accountId, values] of credentialsByAccount) {
        if (!values.delete(credential)) continue;
        if (!values.size) credentialsByAccount.delete(accountId);
        if (credential === oldCredentialForReconnect) signalOldCredentialRevocation();
        return {
          accountHash: createHash("sha256").update(accountId).digest("hex"),
          remainingCredentials: values.size,
        };
      }
      return null;
    },
    async revokeAll(credential: string) {
      for (const [accountId, values] of credentialsByAccount) {
        if (!values.has(credential)) continue;
        credentialsByAccount.delete(accountId);
        return createHash("sha256").update(accountId).digest("hex");
      }
      return null;
    },
  };
  const mediaByLease = new Map<
    string,
    { accountHash: string; capability: string; bytes: Buffer; expiresAt: number }
  >();
  const temporaryMediaStore: TemporaryMediaStore = {
    async initialize() {},
    async upload(input) {
      const bytes = Buffer.from(await new Response(input.body).arrayBuffer());
      assert.equal(createHash("sha256").update(bytes).digest("hex"), input.expectedSha256);
      const leaseId = "integration-lease-id".padEnd(22, "l");
      const capability = "integration-media-capability".padEnd(43, "c");
      const expiresAt = 9_999_999;
      mediaByLease.set(leaseId, { accountHash: input.accountHash, capability, bytes, expiresAt });
      return { leaseId, capability, expiresAt };
    },
    async read(capability) {
      const media = [...mediaByLease.values()].find((item) => item.capability === capability);
      return media
        ? {
            body: Readable.from([media.bytes]),
            contentLength: media.bytes.byteLength,
            expiresAt: media.expiresAt,
          }
        : null;
    },
    async delete(accountHash, leaseId) {
      const media = mediaByLease.get(leaseId);
      if (!media || media.accountHash !== accountHash) return false;
      mediaByLease.delete(leaseId);
      return true;
    },
    async deleteAccount(accountHash) {
      for (const [leaseId, media] of mediaByLease) {
        if (media.accountHash === accountHash) mediaByLease.delete(leaseId);
      }
    },
  };
  let nonceCounter = 0;
  const bridge = createSocialAuthBridgeApp({
    publicBaseUrl: "https://auth.example.test",
    instagramAppId: "meta-app-id",
    mediaCredentialStore,
    temporaryMediaStore,
    oauthClient: {
      async exchangeAuthorizationCode(code, redirectUri): Promise<InstagramGraphTokenSet> {
        assert.equal(code, "temporary-meta-code");
        assert.equal(redirectUri, "https://auth.example.test/v1/instagram/callback");
        return { accessToken: "private-long-lived-token", expiresAt: 10_000_000 };
      },
    },
  });
  const authBridge = createInstagramAuthBridgeHttpClient({
    baseUrl: "https://auth.example.test",
    fetcher: async (input, init) => {
      const requestUrl = new URL(String(input));
      return bridge.request(`${requestUrl.pathname}${requestUrl.search}`, init);
    },
  });
  const service = createSocialPublishingService({
    accountService: {
      get: async (accountId) => (accountId === account.accountId ? account : null),
      list: async () => [account],
    },
    authBridge,
    credentialStore: {
      load: async (accountId) => storedTokens.get(accountId) ?? null,
      store: async (accountId, tokens) => {
        storedTokens.set(accountId, tokens);
      },
      delete: async (accountId) => {
        storedTokens.delete(accountId);
      },
    },
    connectionStore: {
      get: async (accountId) => storedProfiles.get(accountId) ?? null,
      put: async (accountId, record) => {
        storedProfiles.set(accountId, record);
      },
      delete: async (accountId) => {
        storedProfiles.delete(accountId);
      },
    },
    verifyProfile: async (accessToken) => {
      assert.equal(accessToken, "private-long-lived-token");
      if (verificationFailure) throw new Error("private profile verification failure");
      return {
        instagramUserId: "instagram-user-1",
        username: "social_harness_test",
        profilePictureUrl: null,
      };
    },
    now: () => 1_000,
    createNonce: () => `host-random-${++nonceCounter}`.padEnd(43, "x"),
  });

  const pending = await service.startInstagramConnection({ accountId: account.accountId });
  const authorizationUrl = new URL(pending.authorizeUrl);
  assert.equal(authorizationUrl.searchParams.get("state"), pending.state);
  assert.equal(
    authorizationUrl.searchParams.get("scope"),
    "instagram_business_basic,instagram_business_content_publish",
  );

  const callback = await bridge.request(
    `/v1/instagram/callback?state=${encodeURIComponent(pending.state)}&code=temporary-meta-code`,
  );
  assert.equal(callback.status, 302);
  const desktopCallback = new URL(callback.headers.get("location")!);
  assert.equal(desktopCallback.protocol, "social-harness:");
  assert.equal(desktopCallback.searchParams.get("state"), pending.state);
  assert.equal(desktopCallback.searchParams.has("access_token"), false);

  const connection = await service.completeInstagramConnection({
    state: pending.state,
    handoffTicket: desktopCallback.searchParams.get("code")!,
  });
  assert.deepEqual(connection, {
    accountId: account.accountId,
    status: "connected",
    profile: {
      instagramUserId: "instagram-user-1",
      username: "social_harness_test",
      profilePictureUrl: null,
    },
    connectedAt: 1_000,
  });
  assert.equal(storedTokens.get(account.accountId)?.accessToken, "private-long-lived-token");
  const previousMediaUploadCredential = storedTokens.get(account.accountId)?.mediaUploadCredential;
  assert.ok(previousMediaUploadCredential);
  oldCredentialForReconnect = previousMediaUploadCredential;
  const reconnect = await service.startInstagramConnection({ accountId: account.accountId });
  const reconnectCallback = await bridge.request(
    `/v1/instagram/callback?state=${encodeURIComponent(reconnect.state)}&code=temporary-meta-code`,
  );
  const reconnectTicket = new URL(reconnectCallback.headers.get("location")!).searchParams.get(
    "code",
  )!;
  await service.completeInstagramConnection({
    state: reconnect.state,
    handoffTicket: reconnectTicket,
  });
  await oldCredentialRevoked;
  verificationFailure = true;
  const failedReconnect = await service.startInstagramConnection({
    accountId: account.accountId,
  });
  const failedReconnectCallback = await bridge.request(
    `/v1/instagram/callback?state=${encodeURIComponent(failedReconnect.state)}&code=temporary-meta-code`,
  );
  await assert.rejects(
    service.completeInstagramConnection({
      state: failedReconnect.state,
      handoffTicket: new URL(failedReconnectCallback.headers.get("location")!).searchParams.get(
        "code",
      )!,
    }),
    { code: "connection-failed" },
  );
  const preservedCredential = storedTokens.get(account.accountId)?.mediaUploadCredential;
  assert.ok(preservedCredential);
  assert.notEqual(preservedCredential, previousMediaUploadCredential);
  assert.deepEqual([...credentialsByAccount.get(account.accountId)!], [preservedCredential]);
  assert.equal((await service.getConnection(account.accountId))?.status, "connected");
  const mediaUploadCredential = storedTokens.get(account.accountId)?.mediaUploadCredential;
  assert.ok(mediaUploadCredential);
  assert.notEqual(mediaUploadCredential, previousMediaUploadCredential);
  assert.equal(JSON.stringify(connection).includes("private-long-lived-token"), false);
  const approvedExport = Buffer.from("approved-export-bytes");
  const stagedMedia = await authBridge.uploadTemporaryMedia!({
    accountId: account.accountId,
    credential: mediaUploadCredential,
    file: new Blob([approvedExport], { type: "video/mp4" }),
    idempotencyKey: "integration-publication-request",
    sha256: createHash("sha256").update(approvedExport).digest("hex"),
  });
  assert.equal(new URL(stagedMedia.mediaUrl).origin, "https://auth.example.test");
  const fetchedMedia = await bridge.request(new URL(stagedMedia.mediaUrl).pathname);
  assert.equal(fetchedMedia.headers.get("content-type"), "video/mp4");
  assert.deepEqual(Buffer.from(await fetchedMedia.arrayBuffer()), approvedExport);
  await authBridge.deleteTemporaryMedia!({
    accountId: account.accountId,
    credential: mediaUploadCredential,
    leaseId: stagedMedia.leaseId,
  });
  assert.equal((await bridge.request(new URL(stagedMedia.mediaUrl).pathname)).status, 404);
  await assert.rejects(
    service.completeInstagramConnection({
      state: pending.state,
      handoffTicket: desktopCallback.searchParams.get("code")!,
    }),
    { code: "authorization-invalid" },
  );
  await service.disconnectInstagram({ accountId: account.accountId });
  assert.equal(credentialsByAccount.has(account.accountId), false);
  assert.equal(storedTokens.has(account.accountId), false);
});
