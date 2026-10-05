import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveCreateWorkflowInput } from "../../src/tool/handlers/create-workflow-source.js";
import { createWorkflowToolEntry } from "../../src/tool/handlers/create-workflow.js";
import { saveWorkflowToolEntry } from "../../src/tool/handlers/save-workflow.js";
import { saveSavedWorkflow } from "../../src/tool/handlers/saved-workflows/store.js";
import type { ToolExecutionContext } from "../../src/tool/types.js";

const identity = "social-account:recipe-source-fixture";

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "social-recipe-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "account");
  await mkdir(cwd);
  return { cwd, root };
}

test("account CreateWorkflow rejects path and global sources before reading them", async (t) => {
  const { cwd } = await fixture(t);
  for (const input of [
    { path: "outside-nonexistent.dwf.ts" },
    { saved: { name: "global-only", scope: "global" } },
  ]) {
    const result = await resolveCreateWorkflowInput(input, cwd, undefined, undefined, identity);
    assert.equal(result.result, false);
    if (!result.result)
      assert.match(result.message, /Account recipes only use account project scope/);
  }
  assert.deepEqual(await readdir(cwd), []);
});

test("account SaveWorkflow rejects filesystem sources and global destinations before approval", async (t) => {
  const { cwd } = await fixture(t);
  assert.ok(saveWorkflowToolEntry.resolveInput);
  for (const input of [
    {
      name: "daily",
      description: "fixture",
      scope: "project",
      script_path: "outside-nonexistent.dwf.ts",
    },
    { name: "daily", description: "fixture", scope: "global", script: "return 'fixture';" },
  ]) {
    const result = await saveWorkflowToolEntry.resolveInput(input, {
      workingDirectory: cwd,
      workspaceIdentity: identity,
    });
    assert.equal(result.result, false);
    if (!result.result)
      assert.match(result.message, /Account recipes only use account project scope/);
  }
  assert.deepEqual(await readdir(cwd), []);
});

test("final handlers reject altered source scope even after source normalization", async (t) => {
  const { cwd } = await fixture(t);
  const context = { workingDirectory: cwd, workspaceIdentity: identity } as ToolExecutionContext;
  await assert.rejects(
    async () =>
      createWorkflowToolEntry.handler(
        { script: "return 'fixture';", saved: { name: "daily", scope: "global" } },
        context,
      ),
    /Account recipes/,
  );
  await assert.rejects(
    async () =>
      createWorkflowToolEntry.handler(
        { script: "return 'fixture';", path: "outside.dwf.ts" },
        context,
      ),
    /Account recipes/,
  );
  await assert.rejects(
    async () =>
      saveWorkflowToolEntry.handler(
        { name: "daily", description: "fixture", scope: "global", script: "return 'fixture';" },
        context,
      ),
    /Account recipes/,
  );
  assert.deepEqual(await readdir(cwd), []);
});

test("owned source and declared arguments normalize without creating filesystem draft copies", async (t) => {
  const { cwd } = await fixture(t);
  await saveSavedWorkflow({
    cwd,
    workspaceIdentity: identity,
    name: "daily",
    meta: { description: "fixture", args: { greeting: { type: "string", default: "hello" } } },
    script: "return args.greeting;",
  });
  const result = await resolveCreateWorkflowInput(
    { saved: { name: "daily" } },
    cwd,
    undefined,
    undefined,
    identity,
  );
  assert.equal(result.result, true);
  if (result.result) {
    const normalized = result.input as {
      script: string;
      saved: { scope: string; args: Record<string, unknown>; draft?: string };
    };
    assert.equal(normalized.script, "return args.greeting;");
    assert.equal(normalized.saved.scope, "project");
    assert.deepEqual(normalized.saved.args, { greeting: "hello" });
    assert.equal(normalized.saved.draft, undefined);
  }
  assert.deepEqual(await readdir(join(cwd, ".zcode")), ["workflows"]);
});

test("unknown account recipe reports only that account's available definitions", async (t) => {
  const { cwd, root } = await fixture(t);
  await saveSavedWorkflow({
    cwd,
    workspaceIdentity: identity,
    name: "account-only",
    meta: { description: "fixture" },
    script: "return 'account';",
  });
  // An explicit test-only home prevents reading any user's global archive.
  // The account resolver must never enumerate a global root, regardless of its contents.
  await saveSavedWorkflow({
    cwd: root,
    dataBaseDir: root,
    name: "private-global",
    scope: "global",
    meta: { description: "global" },
    script: "return 'global';",
  });
  const result = await resolveCreateWorkflowInput(
    { saved: { name: "missing" } },
    cwd,
    undefined,
    undefined,
    identity,
  );
  assert.equal(result.result, false);
  if (!result.result) {
    assert.match(result.message, /account-only/);
    assert.doesNotMatch(result.message, /private-global/);
    assert.match(result.message, /in this account/);
    assert.doesNotMatch(result.message, /globally/);
  }
});
