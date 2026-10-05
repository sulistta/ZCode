import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  getSavedWorkflowOp,
  listSavedWorkflowsOp,
  saveSavedWorkflowOp,
  validateSavedWorkflowOp,
} from "../src/zcode-protocol/saved-workflows.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";
import { interactionBackgroundHandlers } from "../src/zcode-protocol-v4/commands/handlers/interaction-background.js";

// These definition operations must not depend on a live conversation or journal.
const context = {} as ZCodeProtocolAgentServerContext;

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "social-recipe-protocol-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = (accountId: string) => ({
    workspacePath: join(root, accountId),
    workspaceIdentity: `social-account:${accountId}`,
    workspaceKey: `social-account:${accountId}`,
  });
  const a = workspace("a");
  const b = workspace("b");
  await Promise.all([mkdir(a.workspacePath), mkdir(b.workspacePath)]);
  return { a, b };
}

test("the Desktop save RPC commits editable source only in the selected account", async (t) => {
  const { a, b } = await fixture(t);
  for (const [workspace, value] of [
    [a, "first"],
    [b, "second"],
  ] as const) {
    const saved = await saveSavedWorkflowOp(context, {
      workspace,
      name: "daily",
      scope: "project",
      meta: { description: `Recipe ${value}` },
      script: `return '${value}';`,
    });
    assert.equal(saved.ok, true);
  }
  const first = await getSavedWorkflowOp(context, { workspace: a, name: "daily" });
  const second = await getSavedWorkflowOp(context, { workspace: b, name: "daily" });
  assert.ok(first.ok && second.ok);
  assert.equal(first.script, "return 'first';");
  assert.equal(second.script, "return 'second';");
  const updated = await saveSavedWorkflowOp(context, {
    workspace: a,
    name: "daily",
    meta: { description: "Edited recipe" },
    script: "return 'edited';",
  });
  assert.ok(updated.ok);
  assert.equal(updated.overwritten, true);
  const reopened = await getSavedWorkflowOp(context, { workspace: a, name: "daily" });
  assert.ok(reopened.ok);
  assert.equal(reopened.script, "return 'edited';");
  assert.equal(reopened.meta.description, "Edited recipe");
});

test("invalid source and names cannot overwrite a reviewed account recipe", async (t) => {
  const { a } = await fixture(t);
  await saveSavedWorkflowOp(context, {
    workspace: a,
    name: "daily",
    meta: { description: "Original" },
    script: "return 1;",
  });
  const rejected = await saveSavedWorkflowOp(context, {
    workspace: a,
    name: "daily",
    meta: { description: "Invalid" },
    script: "return missingRecipeVariable;",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "compile_failed");
  const traversal = await saveSavedWorkflowOp(context, {
    workspace: a,
    name: "../escape",
    meta: { description: "Invalid" },
    script: "return 2;",
  });
  assert.equal(traversal.ok, false);
  if (!traversal.ok) assert.equal(traversal.reason, "invalid_name");
  const preserved = await getSavedWorkflowOp(context, { workspace: a, name: "daily" });
  assert.ok(preserved.ok);
  assert.equal(preserved.script, "return 1;");
});

test("account save rejects global scope and filesystem inputs before committing", async (t) => {
  const { a } = await fixture(t);
  await assert.rejects(
    saveSavedWorkflowOp(context, {
      workspace: a,
      name: "daily",
      scope: "global",
      meta: { description: "Invalid" },
      script: "return 1;",
    }),
    /Account recipes/,
  );
  await assert.rejects(
    saveSavedWorkflowOp(context, {
      workspace: a,
      name: "daily",
      meta: { description: "Invalid" },
      script: "return 1;",
      path: join(a.workspacePath, "other.ts"),
    }),
  );
  const listed = await listSavedWorkflowsOp(context, { workspace: a });
  assert.deepEqual(listed.workflows, []);
});

test("review validation compiles exact source and fills arguments without saving or launching", async (t) => {
  const { a } = await fixture(t);
  const snapshot = {
    schemaVersion: 1,
    name: "reviewed",
    meta: {
      description: "Reviewed version",
      args: { greeting: { type: "string", default: "hello" } },
    },
    script: "return args.greeting;",
    args: {},
  };
  const result = await validateSavedWorkflowOp(context, {
    workspace: a,
    approvedSnapshot: snapshot,
  });
  assert.ok(result.ok);
  assert.deepEqual(result.approvedSnapshot, { ...snapshot, args: { greeting: "hello" } });
  assert.deepEqual((await listSavedWorkflowsOp(context, { workspace: a })).workflows, []);
  const invalid = await validateSavedWorkflowOp(context, {
    workspace: a,
    approvedSnapshot: { ...snapshot, script: "return undefinedRecipeInput;" },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, "compile_failed");
  const wrongArgs = await validateSavedWorkflowOp(context, {
    workspace: a,
    approvedSnapshot: { ...snapshot, args: { greeting: 1 } },
  });
  assert.equal(wrongArgs.ok, false);
  if (!wrongArgs.ok) assert.equal(wrongArgs.reason, "invalid_args");
});

test("review validation rejects alternate identities and unknown source fields", async (t) => {
  const { a } = await fixture(t);
  const approvedSnapshot = {
    schemaVersion: 1,
    name: "daily",
    meta: { description: "Reviewed" },
    script: "return 1;",
    args: {},
  };
  const generic = await validateSavedWorkflowOp(context, {
    workspace: { ...a, workspaceIdentity: undefined, workspaceKey: a.workspacePath },
    approvedSnapshot,
  });
  assert.equal(generic.ok, false);
  const malformed = await validateSavedWorkflowOp(context, {
    workspace: { ...a, workspaceIdentity: "social-account:../escape" },
    approvedSnapshot,
  });
  assert.equal(malformed.ok, false);
  await assert.rejects(
    validateSavedWorkflowOp(context, { workspace: a, approvedSnapshot, script_path: "outside.ts" }),
  );
});

test("V4 recipe launch forwards the envelope command identity without adding script arguments", async () => {
  const approvedSnapshot = {
    schemaVersion: 1,
    name: "daily",
    meta: { description: "Reviewed" },
    script: "return 1;",
    args: {},
  };
  let admitted: unknown;
  const result = await interactionBackgroundHandlers.startSavedWorkflow(
    {
      getRecord: () => ({
        app: {
          startSavedWorkflow: async (input: unknown) => {
            admitted = input;
            return { ok: true, runId: "owned-engine", toolCallId: "owned-launch" };
          },
        },
      }),
    } as never,
    {
      commandId: "fixed-occurrence",
      sessionId: "owned-parent",
      payload: { name: "daily", scope: "project", approvedSnapshot },
    } as never,
  );
  assert.deepEqual(admitted, {
    name: "daily",
    scope: "project",
    approvedSnapshot,
    launchInputId: "fixed-occurrence",
  });
  assert.deepEqual(result, {
    type: "startSavedWorkflow",
    runId: "owned-engine",
    toolCallId: "owned-launch",
  });
});
