import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SocialAccount } from "@social-harness/shared";
import { createSocialPublishingService } from "../src/social-publishing/app/socialPublishingService.js";
import type { InstagramAuthTokenSet } from "../src/social-publishing/app/ports/instagramAuthBridge.js";
import { createSocialPublishingFileStore } from "../src/social-publishing/adapters/socialPublishingFileStore.js";

test("Host recreation restores committed Instagram connections and discards uncommitted flows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-connection-restart-"));
  const filePath = join(directory, "connections.json");
  const accounts = ["account-one", "account-two"].map(
    (accountId) => ({ accountId }) as SocialAccount,
  );
  // OS vault 的加密与重读由 Desktop vault 测试覆盖；此端口模拟独立于 Host 生命周期的安全所有者。
  const credentials = new Map<string, InstagramAuthTokenSet>();
  const profile = {
    instagramUserId: "fixture-instagram-user",
    username: "fixture_account",
    profilePictureUrl: null,
  };
  const createHost = () =>
    createSocialPublishingService({
      accountService: {
        get: async (accountId) =>
          accounts.find((account) => account.accountId === accountId) ?? null,
        list: async () => accounts,
      },
      authBridge: {
        createAuthorization: async ({ state }) =>
          `https://www.instagram.com/oauth/authorize?state=${state}`,
        redeemHandoff: async () => ({
          accessToken: "fixture-private-token",
          expiresAt: Date.now() + 86_400_000,
          mediaUploadCredential: "fixture-private-media-credential".padEnd(43, "m"),
        }),
      },
      credentialStore: {
        load: async (accountId) => credentials.get(accountId) ?? null,
        store: async (accountId, tokens) => {
          credentials.set(accountId, tokens);
        },
        delete: async (accountId) => {
          credentials.delete(accountId);
        },
      },
      connectionStore: createSocialPublishingFileStore({ filePath }),
      verifyProfile: async () => profile,
    });
  try {
    const firstHost = createHost();
    const committed = await firstHost.startInstagramConnection({
      accountId: "account-one",
    });
    await firstHost.completeInstagramConnection({
      state: committed.state,
      handoffTicket: "fixture-opaque-ticket",
    });
    const interrupted = await firstHost.startInstagramConnection({
      accountId: "account-two",
    });
    const restartedHost = createHost();
    const restored = await restartedHost.getConnection("account-one");
    assert.equal(restored?.status, "connected");
    assert.deepEqual(restored?.profile, profile);
    assert.equal((await restartedHost.getConnection("account-two"))?.status, "disconnected");
    await assert.rejects(
      restartedHost.completeInstagramConnection({
        state: interrupted.state,
        handoffTicket: "fixture-opaque-ticket",
      }),
      { code: "authorization-invalid" },
    );
    assert.equal(credentials.has("account-two"), false);
    assert.doesNotMatch(
      await readFile(filePath, "utf8"),
      /fixture-private-token|fixture-private-media-credential|fixture-opaque-ticket/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
