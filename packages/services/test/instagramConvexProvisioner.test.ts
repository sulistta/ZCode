import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInstagramConvexProvisioner } from "../src/social-publishing/adapters/instagramConvexProvisioner.js";
const assetsDir = await mkdtemp(join(tmpdir(), "convex-provisioner-test-"));
await mkdir(join(assetsDir, "template"));
await mkdir(join(assetsDir, "node_modules"));
after(() => rm(assetsDir, { recursive: true, force: true }));
test("official API reconciles existing project and mints a scoped expiring provisioning key", async () => {
  const calls = [];
  const provisioner = createInstagramConvexProvisioner({
    assetsDir,
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, init });
      if (path.endsWith("token_details")) return Response.json({ teamId: 42, type: "teamToken" });
      if (path.endsWith("projects"))
        return Response.json({
          items: [{ id: 7, name: "Dedicated Social Harness" }],
          pagination: { hasMore: false },
        });
      if (path.endsWith("deployment"))
        return Response.json({
          name: "dedicated-123",
          deploymentUrl: "https://dedicated-123.convex.cloud/",
        });
      return Response.json({ deployKey: "prod:dedicated-123|test-scoped-key" });
    },
  });
  const result = await provisioner.createProject({
    projectName: "Dedicated Social Harness",
    provisioningCredential: "team-key-temporary-for-test",
  });
  assert.equal(
    calls.some((c) => c.path.endsWith("create_project")),
    false,
  );
  assert.equal(result.deployKey, "prod:dedicated-123|test-scoped-key");
  const keyRequest = JSON.parse(calls.at(-1).init.body);
  assert.equal(keyRequest.allowedActions.includes("deployment:pause"), false);
  assert.ok(keyRequest.expiresAt > Date.now());
});
test("rejects unrelated backend before deployment and bootstraps using a hash", async () => {
  const calls = [];
  const provisioner = createInstagramConvexProvisioner({
    assetsDir,
    runCli: async (args) => {
      calls.push(args);
      if (args[0] === "function-spec")
        return JSON.stringify({
          url: "https://dedicated-123.convex.cloud/",
          functions: [{ identifier: "bridge:foreignWrite" }],
        });
      return "";
    },
  });
  await assert.rejects(
    provisioner.deploy({
      deploymentUrl: "https://dedicated-123.convex.cloud/",
      deployKey: "prod:dedicated-123|test-scoped-key",
      installationCredentialHash: "A".repeat(43),
    }),
    (e) => e.code === "bridge-not-dedicated",
  );
  assert.equal(calls.length, 1);
});
test("bundled deployment verifies selected origin, deploys then bootstraps without a daily administrative key", async () => {
  const calls = [];
  const provisioner = createInstagramConvexProvisioner({
    assetsDir,
    runCli: async (args, cwd, credential) => {
      calls.push({ args, cwd, credential });
      return args[0] === "function-spec"
        ? JSON.stringify({
            url: "https://dedicated-123.convex.cloud/",
            functions: [{ identifier: "bridge.js:status" }],
          })
        : "";
    },
  });
  await provisioner.deploy({
    deploymentUrl: "https://dedicated-123.convex.cloud/",
    deployKey: "prod:dedicated-123|test-scoped-key",
    installationCredentialHash: "A".repeat(43),
  });
  assert.deepEqual(
    calls.map((c) => c.args[0]),
    ["function-spec", "data", "deploy", "run"],
  );
  assert.deepEqual(JSON.parse(calls.at(-1).args[2]), { credentialHash: "A".repeat(43) });
  const wrong = createInstagramConvexProvisioner({
    assetsDir,
    runCli: async () => JSON.stringify({ url: "https://foreign-123.convex.cloud/", functions: [] }),
  });
  await assert.rejects(
    wrong.deploy({
      deploymentUrl: "https://dedicated-123.convex.cloud/",
      deployKey: "prod:dedicated-123|test-scoped-key",
      installationCredentialHash: "A".repeat(43),
    }),
    (e) => e.code === "invalid-provisioning-credential",
  );
});
test("a project creation retry reconciles an uncertain response without duplication", async () => {
  let created = false;
  let creates = 0;
  const provisioner = createInstagramConvexProvisioner({
    assetsDir,
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("token_details")) return Response.json({ teamId: 42, type: "teamToken" });
      if (path.endsWith("projects"))
        return Response.json({
          items: created ? [{ id: 7, name: "Dedicated" }] : [],
          pagination: { hasMore: false },
        });
      if (path.endsWith("create_project")) {
        created = true;
        creates++;
        throw new Error("connection lost after commit");
      }
      if (path.endsWith("deployment"))
        return Response.json({
          name: "dedicated-123",
          deploymentUrl: "https://dedicated-123.convex.cloud/",
        });
      return Response.json({ deployKey: "prod:dedicated-123|test-scoped-key" });
    },
  });
  const request = {
    projectName: "Dedicated",
    provisioningCredential: "team-key-temporary-for-test",
  };
  await assert.rejects(provisioner.createProject(request));
  await provisioner.createProject(request);
  assert.equal(creates, 1);
});
test("invalid credential and quota are sanitized; Meta secrets go only to user's deployment API", async () => {
  const invalid = createInstagramConvexProvisioner({
    assetsDir,
    fetcher: async () => new Response("secret-test-value", { status: 401 }),
  });
  await assert.rejects(
    invalid.createProject({
      projectName: "Dedicated",
      provisioningCredential: "temporary-team-token-test",
    }),
    (e) => e.code === "invalid-provisioning-credential" && !e.message.includes("secret-test-value"),
  );
  const malformed = createInstagramConvexProvisioner({
    assetsDir,
    fetcher: async () => new Response("secret-test-value", { status: 200 }),
  });
  await assert.rejects(
    malformed.createProject({
      projectName: "Dedicated",
      provisioningCredential: "temporary-team-token-test",
    }),
    (e) => e.code === "bridge-deployment-failed" && !e.message.includes("secret-test-value"),
  );
  const calls = [];
  const configured = createInstagramConvexProvisioner({
    assetsDir,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return Response.json(null);
    },
  });
  await configured.configureMeta({
    deploymentUrl: "https://dedicated-123.convex.cloud/",
    deployKey: "prod:dedicated-123|test-scoped-key",
    appId: "123456789",
    appSecret: "meta-secret-test-value",
  });
  assert.equal(calls.length, 1);
  assert.equal(
    String(calls[0].url),
    "https://dedicated-123.convex.cloud/api/update_environment_variables",
  );
  const quota = createInstagramConvexProvisioner({
    assetsDir,
    fetcher: async () => new Response("", { status: 429 }),
  });
  await assert.rejects(
    quota.createProject({
      projectName: "Dedicated",
      provisioningCredential: "temporary-team-token-test",
    }),
    (e) => e.code === "capacity-unavailable",
  );
});
