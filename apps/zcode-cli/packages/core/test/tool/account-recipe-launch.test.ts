import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveSavedWorkflowLaunch } from "../../src/tool/handlers/saved-workflows/launch-source.js";
import {
  deleteSavedWorkflow,
  saveSavedWorkflow,
} from "../../src/tool/handlers/saved-workflows/store.js";

const identity = "social-account:approved-launch";
const approvedSnapshot = {
  schemaVersion: 1 as const,
  name: "daily",
  meta: {
    description: "Reviewed recipe",
    args: { amount: { type: "number" as const, default: 3 } },
  },
  script: "return args.amount;",
  args: {},
};

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const cwd = await mkdtemp(join(tmpdir(), "social-approved-recipe-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { cwd, dataBaseDir: cwd, workspaceIdentity: identity };
}

test("account launch uses reviewed bytes after saved source changes or is deleted", async (t) => {
  const options = await fixture(t);
  await saveSavedWorkflow({
    ...options,
    name: "daily",
    meta: { description: "New source" },
    script: "return 'unreviewed';",
  });
  for (const deleted of [false, true]) {
    if (deleted) await deleteSavedWorkflow({ ...options, name: "daily" });
    const resolved = await resolveSavedWorkflowLaunch({
      ...options,
      name: "daily",
      approvedSnapshot,
    });
    assert.ok(resolved.ok);
    assert.equal(resolved.definition.script, approvedSnapshot.script);
    assert.equal(resolved.definition.meta.description, "Reviewed recipe");
    assert.deepEqual(resolved.args, { amount: 3 });
  }
});

test("account launch rejects missing review, competing args and mismatched source identity", async (t) => {
  const options = await fixture(t);
  for (const overrides of [
    { approvedSnapshot: undefined },
    { name: "another" },
    { scope: "global" as const },
    { args: { amount: 9 } },
    { workspaceIdentity: "social-account:../invalid" },
    { approvedSnapshot: { ...approvedSnapshot, name: "../escape" } },
  ]) {
    const result = await resolveSavedWorkflowLaunch({
      ...options,
      name: "daily",
      approvedSnapshot,
      ...overrides,
    });
    assert.equal(result.ok, false);
  }
});

test("reviewed recipes still compile and validate arguments before admission", async (t) => {
  const options = await fixture(t);
  const invalidScript = await resolveSavedWorkflowLaunch({
    ...options,
    name: "daily",
    approvedSnapshot: { ...approvedSnapshot, script: "return unknownRecipeVariable;" },
  });
  assert.equal(invalidScript.ok, false);
  if (!invalidScript.ok) assert.equal(invalidScript.reason, "compile_failed");
  const invalidArgs = await resolveSavedWorkflowLaunch({
    ...options,
    name: "daily",
    approvedSnapshot: { ...approvedSnapshot, args: { amount: "invalid" } },
  });
  assert.equal(invalidArgs.ok, false);
  if (!invalidArgs.ok) assert.equal(invalidArgs.reason, "invalid_args");
});

test("generic legacy launches retain saved-name lookup without account snapshots", async (t) => {
  const options = await fixture(t);
  await saveSavedWorkflow({
    ...options,
    workspaceIdentity: undefined,
    name: "daily",
    meta: { description: "Legacy" },
    script: "return 'legacy';",
  });
  const result = await resolveSavedWorkflowLaunch({
    ...options,
    workspaceIdentity: undefined,
    name: "daily",
  });
  assert.ok(result.ok);
  assert.equal(result.definition.script, "return 'legacy';");
});
