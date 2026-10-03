import { test } from "node:test";
import assert from "node:assert/strict";
import { createInstagramConvexSetup } from "../src/social-publishing/app/instagramConvexSetup.js";
import { createSocialPublishingSetupService } from "../src/social-publishing/app/socialPublishingSetupService.js";
const deploymentUrl = "https://user-bridge-123.convex.cloud/";
function fixture() {
  let config = null;
  let secure = null;
  let deploys = 0;
  let rejectDeploy = false;
  let rejectVault = false;
  const setup = createInstagramConvexSetup({
    store: {
      read: async () => config,
      write: async (v) => {
        config = v;
      },
      exclusive: async (fn) => fn(),
    },
    credentials: {
      load: async () => secure,
      store: async (_, v) => {
        if (rejectVault) throw new Error("vault");
        secure = v;
      },
      delete: async () => {
        secure = null;
      },
    },
    provisioner: {
      configureMeta: async () => {},
      createProject: async () => ({
        deploymentUrl,
        deployKey: "prod:user-bridge-123|secret-for-test",
      }),
      deploy: async () => {
        deploys++;
        if (rejectDeploy) throw new Error("deploy");
      },
    },
    status: async () => ({ version: 1, metaConfigured: true }),
  });
  return {
    setup,
    config: () => config,
    secure: () => secure,
    deploys: () => deploys,
    rejectDeploy: () => {
      rejectDeploy = true;
    },
    rejectVault: () => {
      rejectVault = true;
    },
  };
}
test("provisions, validates and reconnects without administrative credentials in saved config", async () => {
  const f = fixture();
  assert.equal((await f.setup.get()).stage, "project");
  const request = {
    mode: "existing" as const,
    deploymentUrl,
    provisioningCredential: "prod:user-bridge-123|secret-for-test",
  };
  const result = await f.setup.provision(request);
  assert.equal(result.stage, "meta");
  assert.equal(result.callbackUrl, "https://user-bridge-123.convex.site/v1/instagram/callback");
  assert.equal((await f.setup.validate()).stage, "ready");
  const credential = f.secure().accessToken;
  await f.setup.provision(request);
  assert.equal(f.secure().accessToken, credential);
  assert.equal(f.deploys(), 2);
  assert.equal(JSON.stringify(f.config()).includes("secret-for-test"), false);
  assert.equal(JSON.stringify(result).includes(credential), false);
});
test("failed deployment or secure storage does not commit configuration", async () => {
  for (const fail of ["rejectDeploy", "rejectVault"] as const) {
    const f = fixture();
    f[fail]();
    await assert.rejects(
      f.setup.provision({
        mode: "existing",
        deploymentUrl,
        provisioningCredential: "prod:user-bridge-123|secret-for-test",
      }),
    );
    assert.equal(f.config(), null);
  }
});
test("invalid provisioning key is rejected before side effects", async () => {
  const f = fixture();
  await assert.rejects(
    f.setup.provision({
      mode: "existing",
      deploymentUrl,
      provisioningCredential: "dev:foreign-123|wrong-secret",
    }),
  );
  assert.equal(f.deploys(), 0);
});

test("Meta credential setup validates the selected key and does not save the app secret", async () => {
  const f = fixture();
  await f.setup.provision({
    mode: "existing",
    deploymentUrl,
    provisioningCredential: "prod:user-bridge-123|secret-for-test",
  });
  await assert.rejects(
    f.setup.configureMeta({
      provisioningCredential: "prod:foreign-123|secret-for-test",
      appId: "12345678",
      appSecret: "meta-secret-for-test",
    }),
  );
  await f.setup.configureMeta({
    provisioningCredential: "prod:user-bridge-123|secret-for-test",
    appId: "12345678",
    appSecret: "meta-secret-for-test",
  });
  assert.equal(JSON.stringify(f.config()).includes("meta-secret-for-test"), false);
  assert.equal(JSON.stringify(f.secure()).includes("meta-secret-for-test"), false);
});
test("setup admission prevents concurrent operations and switching connected accounts", async () => {
  const f = fixture();
  const request = {
    mode: "existing" as const,
    deploymentUrl,
    provisioningCredential: "prod:user-bridge-123|secret-for-test",
  };
  await f.setup.provision(request);
  let busy = false;
  let connected = true;
  let release: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = createSocialPublishingSetupService({
    setup: {
      ...f.setup,
      configureMeta: async () => {
        await pending;
        return f.setup.get();
      },
    },
    isBusy: () => busy,
    setBusy: (v) => {
      busy = v;
    },
    listConnections: async () => (connected ? [{ connectedAt: 1 } as never] : []),
  });
  await assert.rejects(
    service.provisionInstagramBridge({
      ...request,
      deploymentUrl: "https://foreign-123.convex.cloud/",
    }),
    (e) => e.code === "bridge-switch-requires-disconnect",
  );
  assert.equal(busy, false);
  await service.provisionInstagramBridge(request);
  const configuring = service.configureInstagramBridgeMeta({
    provisioningCredential: request.provisioningCredential,
    appId: "12345678",
    appSecret: "meta-secret-for-test",
  });
  await assert.rejects(
    service.provisionInstagramBridge(request),
    (e) => e.code === "bridge-setup-busy",
  );
  release!();
  await configuring;
  connected = false;
  await service.provisionInstagramBridge(request);
  assert.equal(busy, false);
});
