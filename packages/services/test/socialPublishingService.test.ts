import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SocialAccount } from "@social-harness/shared";
import {
  createSocialPublishingService,
  SocialPublishingError,
} from "../src/social-publishing/app/socialPublishingService.js";
import type { InstagramAuthTokenSet } from "../src/social-publishing/app/ports/instagramAuthBridge.js";
import type { InstagramConnectionRecord } from "../src/social-publishing/app/ports/instagramConnectionStore.js";
import type { InstagramTokenRefresher } from "../src/social-publishing/app/ports/instagramTokenRefresher.js";
import type { InstagramConnectionProfile } from "@social-harness/shared";
import type { InstagramPublicationStore } from "../src/social-publishing/app/ports/instagramPublicationStore.js";
import type { InstagramPublication } from "@social-harness/shared";
import { createInstagramMediaReader } from "../src/social-publishing/adapters/instagramMediaReader.js";

const profile: InstagramConnectionProfile = {
  instagramUserId: "ig-user-42",
  username: "podcast_channel",
  profilePictureUrl: null,
};
const redeemedMediaUploadCredential = "private-media-upload-credential".padEnd(43, "m");

function makeHarness(options?: {
  authorizationConfigured?: boolean;
  failCredentialPersistence?: boolean;
  failProfilePersistence?: boolean;
  onRevokeAllMediaUploadCredentials?: (credential: string) => Promise<void>;
  redeemedMediaCredentials?: string[];
  tokenRefresher?: InstagramTokenRefresher;
  mediaReader?: {
    list(input: { instagramUserId: string; accessToken: string; limit: number }): Promise<
      {
        mediaId: string;
        mediaType: string;
        caption: string | null;
        permalink: string | null;
        timestamp: string | null;
      }[]
    >;
  };
}) {
  const accounts = new Map<string, SocialAccount>([
    ["account-one", { accountId: "account-one" } as SocialAccount],
  ]);
  const credentials = new Map<string, InstagramAuthTokenSet>();
  const profiles = new Map<string, InstagramConnectionRecord>();
  const authorizationRequests: { accountId: string; state: string; codeChallenge: string }[] = [];
  const redemptionRequests: { handoffTicket: string; codeVerifier: string }[] = [];
  const revokedMediaCredentials: string[] = [];
  const revokedAllMediaCredentials: string[] = [];
  let now = 1_000;
  let nonceCount = 0;
  let redemptionCount = 0;
  let verificationFailure = false;
  const service = createSocialPublishingService({
    accountService: {
      get: async (accountId) => accounts.get(accountId) ?? null,
      list: async () => [...accounts.values()],
    },
    authBridge:
      options?.authorizationConfigured === false
        ? undefined
        : {
            createAuthorization: async ({ accountId, state, codeChallenge }) => {
              authorizationRequests.push({ accountId, state, codeChallenge });
              return `https://www.instagram.com/oauth/authorize?state=${state}`;
            },
            redeemHandoff: async (input) => {
              redemptionRequests.push(input);
              return {
                accessToken: "private-access-token",
                expiresAt: now + 60_000,
                mediaUploadCredential:
                  options?.redeemedMediaCredentials?.[redemptionCount++] ??
                  redeemedMediaUploadCredential,
              };
            },
            revokeMediaUploadCredential: async (credential) => {
              revokedMediaCredentials.push(credential);
            },
            revokeAllMediaUploadCredentials: async (credential) => {
              revokedMediaCredentials.push(credential);
              revokedAllMediaCredentials.push(credential);
              await options?.onRevokeAllMediaUploadCredentials?.(credential);
            },
          },
    credentialStore: {
      load: async (accountId) => credentials.get(accountId) ?? null,
      store: async (accountId, tokens) => {
        if (options?.failCredentialPersistence)
          throw new Error("private credential persistence failure");
        credentials.set(accountId, tokens);
      },
      delete: async (accountId) => {
        credentials.delete(accountId);
      },
    },
    tokenRefresher: options?.tokenRefresher,
    mediaReader: options?.mediaReader,
    connectionStore: {
      get: async (accountId) => profiles.get(accountId) ?? null,
      put: async (accountId, value) => {
        if (options?.failProfilePersistence) throw new Error("private profile persistence failure");
        profiles.set(accountId, value);
      },
      delete: async (accountId) => {
        profiles.delete(accountId);
      },
    },
    verifyProfile: async (accessToken) => {
      assert.equal(accessToken, "private-access-token");
      if (verificationFailure) throw new Error("private API response");
      return profile;
    },
    now: () => now,
    createNonce: () => `nonce-${++nonceCount}`.padEnd(43, "x"),
  });
  return {
    service,
    credentials,
    profiles,
    authorizationRequests,
    redemptionRequests,
    revokedMediaCredentials,
    revokedAllMediaCredentials,
    setNow(value: number) {
      now = value;
    },
    failProfileVerification() {
      verificationFailure = true;
    },
  };
}

test("Instagram connection uses a per-account PKCE challenge and expires after five minutes", async () => {
  const harness = makeHarness();
  const pending = await harness.service.startInstagramConnection({ accountId: "account-one" });
  const request = harness.authorizationRequests[0]!;
  const expectedChallenge = createHash("sha256")
    .update(`nonce-${2}`.padEnd(43, "x"))
    .digest("base64url");

  assert.equal(request.state, pending.state);
  assert.equal(request.accountId, "account-one");
  assert.equal(request.codeChallenge, expectedChallenge);
  assert.equal(pending.expiresAt, 1_000 + 5 * 60 * 1_000);
  assert.equal((await harness.service.getConnection("account-one"))?.status, "connecting");
});

test("Instagram authorization availability exposes only whether the Host adapter is configured", async () => {
  const configured = makeHarness();
  const unconfigured = makeHarness({ authorizationConfigured: false });

  assert.equal(await configured.service.isInstagramAuthorizationAvailable(), true);
  assert.equal(await unconfigured.service.isInstagramAuthorizationAvailable(), false);
});

test("one-time handoff verifies the profile before saving credentials and returns no token", async () => {
  const harness = makeHarness();
  const changes: string[] = [];
  const subscription = harness.service.onConnectionChanged((change) => changes.push(change.status));
  try {
    const pending = await harness.service.startInstagramConnection({ accountId: "account-one" });
    const connected = await harness.service.completeInstagramConnection({
      state: pending.state,
      handoffTicket: "opaque-one-time-ticket-123",
    });

    assert.equal(connected.status, "connected");
    assert.deepEqual(connected.profile, profile);
    assert.equal(JSON.stringify(connected).includes("private-access-token"), false);
    assert.equal(harness.credentials.get("account-one")?.accessToken, "private-access-token");
    assert.equal(harness.redemptionRequests[0]?.codeVerifier, `nonce-${2}`.padEnd(43, "x"));
    assert.deepEqual(changes, ["connecting", "connected"]);
    await assert.rejects(
      harness.service.completeInstagramConnection({
        state: pending.state,
        handoffTicket: "opaque-one-time-ticket-123",
      }),
      (error: unknown) =>
        error instanceof SocialPublishingError && error.code === "authorization-invalid",
    );
    assert.equal(harness.redemptionRequests.length, 1);
  } finally {
    subscription.dispose();
  }
});

test("concurrent Instagram callbacks consume state once before redeeming the handoff", async () => {
  const harness = makeHarness();
  const pending = await harness.service.startInstagramConnection({ accountId: "account-one" });

  const results = await Promise.allSettled([
    harness.service.completeInstagramConnection({
      state: pending.state,
      handoffTicket: "opaque-one-time-ticket-123",
    }),
    harness.service.completeInstagramConnection({
      state: pending.state,
      handoffTicket: "opaque-one-time-ticket-123",
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(harness.redemptionRequests.length, 1);
  assert.equal((await harness.service.getConnection("account-one"))?.status, "connected");
});

test("unknown-state and expired callbacks never redeem a handoff ticket", async () => {
  const harness = makeHarness();
  const pending = await harness.service.startInstagramConnection({ accountId: "account-one" });
  await assert.rejects(
    harness.service.completeInstagramConnection({
      state: "unknown-state".padEnd(43, "u"),
      handoffTicket: "opaque-one-time-ticket-123",
    }),
    (error: unknown) =>
      error instanceof SocialPublishingError && error.code === "authorization-invalid",
  );
  harness.setNow(pending.expiresAt);
  await assert.rejects(
    harness.service.completeInstagramConnection({
      state: pending.state,
      handoffTicket: "opaque-one-time-ticket-123",
    }),
    (error: unknown) =>
      error instanceof SocialPublishingError && error.code === "authorization-expired",
  );
  assert.equal(harness.redemptionRequests.length, 0);
  assert.equal((await harness.service.getConnection("account-one"))?.status, "disconnected");
});

test("profile verification failure consumes the flow without persisting tokens", async () => {
  const harness = makeHarness();
  const pending = await harness.service.startInstagramConnection({ accountId: "account-one" });
  harness.failProfileVerification();

  await assert.rejects(
    harness.service.completeInstagramConnection({
      state: pending.state,
      handoffTicket: "opaque-one-time-ticket-123",
    }),
    (error: unknown) =>
      error instanceof SocialPublishingError && error.code === "connection-failed",
  );
  assert.equal(harness.credentials.has("account-one"), false);
  assert.equal(harness.profiles.has("account-one"), false);
  assert.equal((await harness.service.getConnection("account-one"))?.status, "disconnected");
  assert.deepEqual(harness.revokedMediaCredentials, [redeemedMediaUploadCredential]);
});

test("failed reconnect revokes only the new media key and preserves the old connection", async () => {
  const previousCredential = redeemedMediaUploadCredential;
  const newCredential = "private-reconnect-media-credential".padEnd(43, "n");
  const harness = makeHarness({ redeemedMediaCredentials: [previousCredential, newCredential] });
  const first = await harness.service.startInstagramConnection({ accountId: "account-one" });
  await harness.service.completeInstagramConnection({
    state: first.state,
    handoffTicket: "opaque-first-ticket-123456789",
  });

  harness.failProfileVerification();
  const reconnect = await harness.service.startInstagramConnection({ accountId: "account-one" });
  await assert.rejects(
    harness.service.completeInstagramConnection({
      state: reconnect.state,
      handoffTicket: "opaque-second-ticket-123456789",
    }),
    (error: unknown) =>
      error instanceof SocialPublishingError && error.code === "connection-failed",
  );

  assert.equal(harness.credentials.get("account-one")?.mediaUploadCredential, previousCredential);
  assert.equal((await harness.service.getConnection("account-one"))?.status, "connected");
  assert.deepEqual(harness.revokedMediaCredentials, [newCredential]);
});

test("successful reconnect stores the new media key and starts old-key cleanup", async () => {
  const previousCredential = redeemedMediaUploadCredential;
  const newCredential = "private-reconnect-media-credential".padEnd(43, "n");
  const harness = makeHarness({ redeemedMediaCredentials: [previousCredential, newCredential] });
  const first = await harness.service.startInstagramConnection({ accountId: "account-one" });
  await harness.service.completeInstagramConnection({
    state: first.state,
    handoffTicket: "opaque-first-ticket-123456789",
  });
  const reconnect = await harness.service.startInstagramConnection({ accountId: "account-one" });

  const connection = await harness.service.completeInstagramConnection({
    state: reconnect.state,
    handoffTicket: "opaque-second-ticket-123456789",
  });

  assert.equal(connection.status, "connected");
  assert.equal(harness.credentials.get("account-one")?.mediaUploadCredential, newCredential);
  assert.deepEqual(harness.revokedMediaCredentials, [previousCredential]);
});

for (const failure of [
  { name: "secure credential", option: "failCredentialPersistence" as const },
  { name: "verified profile metadata", option: "failProfilePersistence" as const },
]) {
  test(`redemption media credential is revoked when ${failure.name} persistence fails`, async () => {
    const harness = makeHarness({ [failure.option]: true });
    const pending = await harness.service.startInstagramConnection({ accountId: "account-one" });

    await assert.rejects(
      harness.service.completeInstagramConnection({
        state: pending.state,
        handoffTicket: "opaque-one-time-ticket-123",
      }),
      (error: unknown) =>
        error instanceof SocialPublishingError && error.code === "connection-failed",
    );

    assert.equal(harness.credentials.has("account-one"), false);
    assert.equal(harness.profiles.has("account-one"), false);
    assert.deepEqual(harness.revokedMediaCredentials, [redeemedMediaUploadCredential]);
  });
}

test("connection status requires both a verified profile and an OS credential", async () => {
  const harness = makeHarness();
  harness.profiles.set("account-one", { profile, connectedAt: 500 });

  const connection = await harness.service.getConnection("account-one");

  assert.equal(connection?.status, "reauth-required");
  assert.deepEqual(connection?.profile, profile);
});

test("disconnect clears the secure credential and profile projection", async () => {
  const harness = makeHarness();
  const mediaUploadCredential = "private-media-credential".padEnd(43, "m");
  harness.credentials.set("account-one", {
    accessToken: "private-access-token",
    mediaUploadCredential,
  });
  harness.profiles.set("account-one", { profile, connectedAt: 500 });

  const disconnected = await harness.service.disconnectInstagram({ accountId: "account-one" });

  assert.equal(disconnected.status, "disconnected");
  assert.equal(harness.credentials.has("account-one"), false);
  assert.equal(harness.profiles.has("account-one"), false);
  assert.deepEqual(harness.revokedMediaCredentials, [mediaUploadCredential]);
  assert.deepEqual(harness.revokedAllMediaCredentials, [mediaUploadCredential]);
});

test("new Instagram authorization waits until disconnect revokes account media credentials", async () => {
  let signalRevocationStarted!: () => void;
  let finishRevocation!: () => void;
  const revocationStarted = new Promise<void>((resolve) => {
    signalRevocationStarted = resolve;
  });
  const revocationCompletion = new Promise<void>((resolve) => {
    finishRevocation = resolve;
  });
  const harness = makeHarness({
    onRevokeAllMediaUploadCredentials: async () => {
      signalRevocationStarted();
      await revocationCompletion;
    },
  });
  const first = await harness.service.startInstagramConnection({ accountId: "account-one" });
  await harness.service.completeInstagramConnection({
    state: first.state,
    handoffTicket: "opaque-first-ticket-123456789",
  });

  const disconnect = harness.service.disconnectInstagram({ accountId: "account-one" });
  await revocationStarted;
  const nextAuthorization = harness.service.startInstagramConnection({ accountId: "account-one" });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(harness.authorizationRequests.length, 1);
  finishRevocation();
  await disconnect;
  await nextAuthorization;

  assert.equal(harness.authorizationRequests.length, 2);
});

test("Instagram media queries use the connected account token and never return credentials", async () => {
  let request: { instagramUserId: string; accessToken: string; limit: number } | undefined;
  const harness = makeHarness({
    mediaReader: {
      async list(input) {
        request = input;
        return [
          {
            mediaId: "media-1",
            mediaType: "VIDEO",
            caption: "Recent Reel",
            permalink: "https://www.instagram.com/reel/example/",
            timestamp: "2026-09-28T12:00:00Z",
          },
        ];
      },
    },
  });
  harness.credentials.set("account-one", { accessToken: "private-access-token" });
  harness.profiles.set("account-one", { profile, connectedAt: 500 });

  const media = await harness.service.listInstagramMedia({ accountId: "account-one" });

  assert.deepEqual(request, {
    instagramUserId: profile.instagramUserId,
    accessToken: "private-access-token",
    limit: 12,
  });
  assert.equal(media[0]?.mediaId, "media-1");
  assert.equal(JSON.stringify(media).includes("private-access-token"), false);
});

test("Host media lookup projects normalized provider dates and preserves the existing sanitized retry error", async () => {
  let timestamp = "2026-10-03T12:00:00+0000";
  const harness = makeHarness({
    mediaReader: createInstagramMediaReader({
      fetcher: async () =>
        Response.json({ data: [{ id: "fixture-post", media_type: "VIDEO", timestamp }] }),
    }),
  });
  harness.credentials.set("account-one", { accessToken: "private-access-token" });
  harness.profiles.set("account-one", { profile, connectedAt: 500 });
  const media = await harness.service.listInstagramMedia({ accountId: "account-one" });
  assert.equal(media[0]?.timestamp, "2026-10-03T12:00:00+00:00");
  timestamp = "invalid-private-provider-value";
  await assert.rejects(
    harness.service.listInstagramMedia({ accountId: "account-one" }),
    (error: unknown) =>
      error instanceof SocialPublishingError &&
      error.code === "instagram-media-unavailable" &&
      !error.message.includes(timestamp),
  );
});

test("Instagram media queries are rejected for disconnected accounts", async () => {
  let readCalls = 0;
  const harness = makeHarness({
    mediaReader: {
      async list() {
        readCalls += 1;
        return [];
      },
    },
  });

  await assert.rejects(
    harness.service.listInstagramMedia({ accountId: "account-one" }),
    (error: unknown) =>
      error instanceof SocialPublishingError && error.code === "instagram-not-connected",
  );
  assert.equal(readCalls, 0);
});

test("near-expiry Instagram tokens refresh once and persist only through the credential store", async () => {
  const day = 24 * 60 * 60 * 1_000;
  let refreshCalls = 0;
  const harness = makeHarness({
    tokenRefresher: {
      async refresh(accessToken) {
        refreshCalls += 1;
        assert.equal(accessToken, "old-private-token");
        return { accessToken: "new-private-token", expiresAt: 90 * day };
      },
    },
  });
  harness.setNow(20 * day);
  harness.credentials.set("account-one", {
    accessToken: "old-private-token",
    expiresAt: 30 * day,
    refreshedAt: 1_000,
  });
  harness.profiles.set("account-one", { profile, connectedAt: 1_000 });

  const [first, second] = await Promise.all([
    harness.service.getConnection("account-one"),
    harness.service.getConnection("account-one"),
  ]);

  assert.equal(refreshCalls, 1);
  assert.equal(first?.status, "connected");
  assert.equal(second?.status, "connected");
  assert.deepEqual(harness.credentials.get("account-one"), {
    accessToken: "new-private-token",
    expiresAt: 90 * day,
    refreshedAt: 20 * day,
  });
  assert.equal(JSON.stringify(first).includes("new-private-token"), false);
});

test("Instagram tokens younger than 24 hours are not refreshed", async () => {
  const day = 24 * 60 * 60 * 1_000;
  let refreshCalls = 0;
  const harness = makeHarness({
    tokenRefresher: {
      async refresh() {
        refreshCalls += 1;
        return { accessToken: "unexpected-token", expiresAt: 90 * day };
      },
    },
  });
  const now = 20 * day;
  harness.setNow(now);
  harness.credentials.set("account-one", {
    accessToken: "young-private-token",
    expiresAt: now + 5 * day,
    refreshedAt: now - day + 1,
  });
  harness.profiles.set("account-one", { profile, connectedAt: 0 });

  const connection = await harness.service.getConnection("account-one");

  assert.equal(connection?.status, "connected");
  assert.equal(refreshCalls, 0);
  assert.equal(harness.credentials.get("account-one")?.accessToken, "young-private-token");
});

test("expired Instagram tokens require reauthorization instead of refresh", async () => {
  let refreshCalls = 0;
  const harness = makeHarness({
    tokenRefresher: {
      async refresh() {
        refreshCalls += 1;
        return { accessToken: "unexpected-token", expiresAt: 100_000 };
      },
    },
  });
  harness.setNow(10_000);
  harness.credentials.set("account-one", {
    accessToken: "expired-private-token",
    expiresAt: 9_999,
    refreshedAt: 1,
  });
  harness.profiles.set("account-one", { profile, connectedAt: 1 });

  const connection = await harness.service.getConnection("account-one");

  assert.equal(connection?.status, "reauth-required");
  assert.equal(refreshCalls, 0);
});

test("disconnect waits for an in-flight token refresh before deleting the credential", async () => {
  const day = 24 * 60 * 60 * 1_000;
  let startRefresh!: () => void;
  let finishRefresh!: (tokens: InstagramAuthTokenSet) => void;
  const refreshStarted = new Promise<void>((resolve) => {
    startRefresh = resolve;
  });
  const refreshResult = new Promise<InstagramAuthTokenSet>((resolve) => {
    finishRefresh = resolve;
  });
  const harness = makeHarness({
    tokenRefresher: {
      async refresh() {
        startRefresh();
        return refreshResult;
      },
    },
  });
  harness.setNow(20 * day);
  harness.credentials.set("account-one", {
    accessToken: "old-private-token",
    expiresAt: 30 * day,
    refreshedAt: 1_000,
  });
  harness.profiles.set("account-one", { profile, connectedAt: 1_000 });

  const readConnection = harness.service.getConnection("account-one");
  await refreshStarted;
  const disconnect = harness.service.disconnectInstagram({ accountId: "account-one" });
  finishRefresh({ accessToken: "new-private-token", expiresAt: 90 * day });
  await Promise.all([readConnection, disconnect]);

  assert.equal(harness.credentials.has("account-one"), false);
  assert.equal(harness.profiles.has("account-one"), false);
});

test("publishing service exposes only the approved publication projection", async () => {
  const publicationRecords = new Map<string, InstagramPublication>();
  const publicationStore: InstagramPublicationStore = {
    get: async (accountId, id) =>
      publicationRecords.get(id)?.accountId === accountId ? publicationRecords.get(id)! : null,
    list: async (accountId) =>
      [...publicationRecords.values()].filter((item) => item.accountId === accountId),
    listAll: async () => [...publicationRecords.values()],
    createIfAbsent: async (publication) => {
      publicationRecords.set(publication.publicationId, publication);
      return { publication, created: true };
    },
    update: async (accountId, id, transform) => {
      const current = publicationRecords.get(id);
      if (!current || current.accountId !== accountId) return null;
      const updated = transform(current);
      publicationRecords.set(id, updated);
      return updated;
    },
    withRunnerLock: async (_accountId, operation) => {
      await operation();
      return true;
    },
  };
  const tokens = {
    accessToken: "private-access-token",
    mediaUploadCredential: "private-bridge-credential",
  };
  const service = createSocialPublishingService({
    accountService: {
      get: async (accountId) =>
        accountId === "account-one" ? ({ accountId } as SocialAccount) : null,
      list: async () => [{ accountId: "account-one" } as SocialAccount],
    },
    credentialStore: {
      load: async () => tokens,
      store: async () => undefined,
      delete: async () => undefined,
    },
    connectionStore: {
      get: async () => ({ profile, connectedAt: 1 }),
      put: async () => undefined,
      delete: async () => undefined,
    },
    authBridge: {
      createAuthorization: async () => "",
      redeemHandoff: async () => tokens,
      uploadTemporaryMedia: async () => ({
        leaseId: "abcdefghijklmnopqrstuv",
        mediaUrl: "https://bridge.example/m/capability",
        expiresAt: Date.now() + 60_000,
      }),
      deleteTemporaryMedia: async () => undefined,
    },
    mediaReader: {
      list: async () => [
        {
          mediaId: "published-42",
          mediaType: "REELS",
          caption: "approved caption",
          permalink: "https://www.instagram.com/reel/Published42/",
          timestamp: null,
        },
      ],
    },
    publication: {
      store: publicationStore,
      projectService: {
        getExport: async () => ({
          exportId: "export-one",
          requestId: "export-request-one",
          accountId: "account-one",
          projectId: "project-one",
          projectRevision: 5,
          status: "completed",
          progressPercent: 100,
          createdAt: 1,
          updatedAt: 1,
          durationMs: 5_000,
          fileSizeBytes: 5,
          sha256: "a".repeat(64),
        }),
        get: async () => ({
          project: {
            revision: 5,
            settings: {
              width: 1080,
              height: 1920,
              frameRate: { numerator: 30, denominator: 1 },
              backgroundColor: "#000000",
            },
          },
        }),
      } as never,
      artifactReader: { open: async () => new Blob(["video"], { type: "video/mp4" }) },
      publisher: {
        createReelContainer: async () => ({ containerId: "container-42" }),
        getContainerStatus: async () => ({ statusCode: "FINISHED" }),
        publishReel: async () => ({ mediaId: "published-42" }),
      },
    },
    verifyProfile: async () => profile,
  });
  const changes: string[] = [];
  const subscription = service.onPublicationChanged((change) => changes.push(change.status));
  try {
    const accepted = await service.approveAndPublishInstagramReel({
      accountId: "account-one",
      exportId: "export-one",
      caption: "approved caption",
      requestId: "request-key-000042",
    });
    assert.equal(accepted.status, "preparing-media");
    assert.equal(JSON.stringify(accepted).includes("private-access-token"), false);
    assert.equal(JSON.stringify(accepted).includes("private-bridge-credential"), false);

    let publications = await service.listInstagramPublications("account-one");
    for (let attempt = 0; attempt < 50 && publications[0]?.status !== "published"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      publications = await service.listInstagramPublications("account-one");
    }
    assert.equal(publications[0]?.status, "published");
    assert.equal(publications[0]?.mediaId, "published-42");
    assert.equal(publications[0]?.permalink, "https://www.instagram.com/reel/Published42/");
    assert.ok(changes.includes("published"));
  } finally {
    subscription.dispose();
  }
});
