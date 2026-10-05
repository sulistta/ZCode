import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspect } from "node:util";
import { LoggingChannelServer, type IServerChannel } from "@social-harness/rpc";
import { createInstagramConvexIntegration } from "../src/social-publishing/adapters/instagramConvexIntegration.js";
import type { ISocialInstagramSetupService } from "../src/social-publishing/setupContract.js";
import { createSocialPublishingService } from "../src/social-publishing/app/socialPublishingService.js";
import { createInstagramConnectionProjector } from "../src/social-publishing/app/instagramConnectionProjection.js";
import { createSocialPublishingSetupService } from "../src/social-publishing/app/socialPublishingSetupService.js";
const projection = {
  stage: "project" as const,
  deploymentUrl: null,
  callbackUrl: null,
  dashboardUrl: "https://dashboard.convex.dev/",
  metaDashboardUrl: "https://developers.facebook.com/apps/" as const,
  backendVersion: null,
  metaConfigured: false,
};
const request = {
  mode: "existing" as const,
  deploymentUrl: "https://fixture-123.convex.cloud/",
  provisioningCredential: "prod:fixture-123|temporary-fixture-key",
};
function gate() {
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release!() };
}
test("invalid setup requests never expose entered secrets through actual RPC failure logging", async () => {
  let busy = false;
  let provisioned = false;
  const service = createSocialPublishingSetupService({
    isBusy: () => busy,
    setBusy: (value) => {
      busy = value;
    },
    listConnections: async () => [],
    setup: {
      get: async () => ({ ...projection, deploymentUrl: request.deploymentUrl }),
      provision: async () => {
        provisioned = true;
        return projection;
      },
      configureMeta: async () => {
        provisioned = true;
        return projection;
      },
      validate: async () => projection,
    },
  });
  let channel: IServerChannel<string>;
  const messages: string[] = [];
  const logger = new LoggingChannelServer<string>(
    {
      registerChannel: (_name, value) => {
        channel = value;
      },
    },
    (...values) => messages.push(inspect(values)),
  );
  logger.registerChannel("social-instagram-setup", {
    call: async (_ctx, command, input) =>
      (command === "provisionInstagramBridge"
        ? service.provisionInstagramBridge(input)
        : service.configureInstagramBridgeMeta(input)) as never,
    listen: () => {
      throw new Error("No setup events");
    },
  });
  const secret = "private-value-must-not-be-logged";
  for (const [command, input] of [
    [
      "provisionInstagramBridge",
      { ...request, deploymentUrl: secret, provisioningCredential: secret },
    ],
    ["provisionInstagramBridge", { ...request, [secret]: secret }],
    [
      "configureInstagramBridgeMeta",
      { appId: "invalid", appSecret: secret, provisioningCredential: secret, [secret]: secret },
    ],
  ] as const) {
    await assert.rejects(channel!.call("host", command, input), (error) => {
      assert.equal(error.name, "SocialPublishingError");
      assert.doesNotMatch(inspect(error), new RegExp(secret));
      return error.code === "bridge-deployment-failed";
    });
    assert.equal(busy, false);
  }
  assert.equal(provisioned, false);
  assert.doesNotMatch(messages.join("\n"), new RegExp(secret));
  assert.equal(messages.filter((message) => message.includes("FAIL")).length, 3);
});
test("Host guards setup throughout authorization admission and commit, then permits expired-flow retry", async () => {
  const accountGate = gate();
  const profileGate = gate();
  const metaGate = gate();
  let setup: ISocialInstagramSetupService;
  let now = 1_000;
  let nonce = 0;
  const service = createSocialPublishingService({
    now: () => now,
    createNonce: () => String(++nonce).padEnd(43, "x"),
    accountService: {
      get: async () => {
        await accountGate.promise;
        return { accountId: "account-one" } as never;
      },
      list: async () => [],
    },
    credentialStore: { load: async () => null, store: async () => {}, delete: async () => {} },
    connectionStore: { get: async () => null, put: async () => {}, delete: async () => {} },
    authBridge: {
      createAuthorization: async ({ state }) =>
        `https://www.instagram.com/oauth/authorize?state=${state}`,
      redeemHandoff: async () => ({
        accessToken: "fixture-token",
        mediaUploadCredential: "A".repeat(43),
      }),
    },
    verifyProfile: async () => {
      await profileGate.promise;
      return { instagramUserId: "123", username: "fixture", profilePictureUrl: null };
    },
    bridgeSetup: {
      get: async () => projection,
      provision: async () => projection,
      configureMeta: async () => {
        await metaGate.promise;
        return projection;
      },
      validate: async () => projection,
    },
    registerBridgeSetup: (value) => {
      setup = value;
    },
  });
  const starting = service.startInstagramConnection({ accountId: "account-one" });
  await assert.rejects(
    setup!.provisionInstagramBridge(request),
    (e) => e.code === "bridge-setup-busy",
  );
  accountGate.release();
  const flow = await starting;
  const completing = service.completeInstagramConnection({
    state: flow.state,
    handoffTicket: "B".repeat(43),
  });
  await assert.rejects(
    setup!.provisionInstagramBridge(request),
    (e) => e.code === "bridge-setup-busy",
  );
  profileGate.release();
  await completing;
  await service.startInstagramConnection({ accountId: "account-one" });
  now += 300_001;
  await setup!.provisionInstagramBridge(request);
  const configuring = setup!.configureInstagramBridgeMeta({
    appId: "123456789",
    appSecret: "meta-fixture-secret",
    provisioningCredential: request.provisioningCredential,
  });
  await assert.rejects(
    service.startInstagramConnection({ accountId: "account-one" }),
    (e) => e.code === "bridge-setup-busy",
  );
  await assert.rejects(
    service.approveAndPublishInstagramReel({} as never),
    (e) => e.code === "bridge-setup-busy",
  );
  metaGate.release();
  await configuring;
});
test("legacy credentials require reconnection without deletion or token refresh", async () => {
  let refreshed = false;
  const tokens = { accessToken: "legacy-fixture-token", expiresAt: 200_000_000 };
  const read = createInstagramConnectionProjector({
    now: () => 100_000_000,
    withAccountLock: async (_, operation) => operation(),
    credentialStore: {
      load: async () => tokens,
      store: async () => {
        assert.fail("no credential mutation");
      },
      delete: async () => {
        assert.fail("no deletion");
      },
    },
    connectionStore: {
      get: async () => ({
        profile: { instagramUserId: "123", username: "fixture", profilePictureUrl: null },
        connectedAt: 1,
      }),
      put: async () => {},
      delete: async () => {},
    },
    acceptsCredential: async (value) => value.bridgeOrigin === "https://fixture-123.convex.site",
    tokenRefresher: {
      refresh: async () => {
        refreshed = true;
        return tokens;
      },
    },
  });
  const connection = await read("account-one");
  assert.equal(connection.status, "reauth-required");
  assert.equal(connection.profile.username, "fixture");
  assert.equal(refreshed, false);
});
test("a replaced installation identity in the same project requires reconnecting old account keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "convex-binding-test-"));
  try {
    const configurationPath = join(directory, "bridge.json");
    await writeFile(
      configurationPath,
      JSON.stringify({ version: 1, deploymentUrl: request.deploymentUrl, configuredAt: 1 }),
    );
    let installationCredential = "A".repeat(43);
    const integration = createInstagramConvexIntegration({
      configurationPath,
      assetsDir: directory,
      credentials: {
        load: async () => ({ accessToken: installationCredential }),
        store: async () => {},
        delete: async () => {},
      },
    });
    const tokens = {
      accessToken: "meta-fixture-token",
      bridgeOrigin: "https://fixture-123.convex.site",
      bridgeInstallationHash: createHash("sha256")
        .update(installationCredential)
        .digest("base64url"),
    };
    assert.equal(await integration.bridge.acceptsCredential!(tokens), true);
    installationCredential = "B".repeat(43);
    assert.equal(await integration.bridge.acceptsCredential!(tokens), false);
    assert.equal(
      await integration.bridge.acceptsCredential!({
        accessToken: tokens.accessToken,
        bridgeOrigin: tokens.bridgeOrigin,
      }),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
