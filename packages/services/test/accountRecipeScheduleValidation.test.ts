import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZCodeAutomation } from "@social-harness/shared";
import { validateAccountRecipeScheduleWrite } from "../src/zcode-agent/accountRecipeScheduleValidation.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";

const snapshot = {
  schemaVersion: 1 as const,
  name: "daily",
  meta: {
    description: "Reviewed",
    args: { label: { type: "string" as const, default: "filled" } },
  },
  script: "return args.label;",
  args: {},
};
const target = { workspacePath: "/account/a", workspaceIdentity: "social-account:a" };
const filled = { ...snapshot, args: { label: "filled" } };

test("the core validator's filled snapshot is the schedule value, with no definition lookup", async () => {
  const calls: unknown[] = [];
  const result = await validateAccountRecipeScheduleWrite({
    ...target,
    prompt: "",
    recipeSnapshot: snapshot,
    validate: async (input) => {
      calls.push(input);
      return { ok: true, approvedSnapshot: filled };
    },
  });
  assert.deepEqual(result, filled);
  assert.deepEqual(calls, [{ ...target, approvedSnapshot: snapshot }]);
});

test("canonical account, empty prompt and bounded schema reject before core validation", async () => {
  for (const override of [
    { workspaceIdentity: "generic" },
    { workspaceIdentity: "social-account:" },
    { prompt: "Run another prompt" },
    { recipeSnapshot: { ...snapshot, extra: true } },
    { recipeSnapshot: { ...snapshot, script: "a".repeat(1_048_577) } },
  ]) {
    await assert.rejects(
      validateAccountRecipeScheduleWrite({
        ...target,
        prompt: "",
        recipeSnapshot: snapshot,
        ...override,
        validate: async () => {
          throw new Error("validator must not run");
        },
      }),
    );
  }
});

test("compile or argument rejection propagates before schedule commit", async () => {
  await assert.rejects(
    validateAccountRecipeScheduleWrite({
      ...target,
      prompt: "",
      recipeSnapshot: snapshot,
      validate: async () => ({
        ok: false,
        reason: "compile_failed",
        message: "Invalid reviewed source",
      }),
    }),
    /Invalid reviewed source/,
  );
});

test("omission preserves a version without runtime IO; legacy conversion is rejected", async () => {
  const validate = async () => {
    throw new Error("validator must not run");
  };
  assert.equal(await validateAccountRecipeScheduleWrite({ ...target, validate }), undefined);
  await assert.rejects(
    validateAccountRecipeScheduleWrite({
      ...target,
      recipeSnapshot: snapshot,
      prompt: "",
      existing: {} as ZCodeAutomation,
      validate,
    }),
    /prompt schedule/i,
  );
});

test("explicit replacement revalidates even malformed old versions and never mutates old inputs", async () => {
  for (const existing of [
    { recipeSnapshot: snapshot, prompt: "" },
    { recipeSnapshotError: "invalid_recipe_snapshot", prompt: "" },
  ]) {
    const result = await validateAccountRecipeScheduleWrite({
      ...target,
      recipeSnapshot: snapshot,
      existing: existing as ZCodeAutomation,
      validate: async () => ({ ok: true, approvedSnapshot: filled }),
    });
    assert.deepEqual(result, filled);
    assert.deepEqual(snapshot.args, {});
  }
});

test("public schedule writes reject forged paths and foreign schedules before any runtime spawn", async () => {
  const previous = getDataBaseDir();
  const directory = await mkdtemp(join(tmpdir(), "social-recipe-authoring-"));
  setDataBaseDir(directory);
  let spawned = 0;
  const other = { workspacePath: "/account/b", workspaceIdentity: "social-account:b" };
  const agent = createZCodeAgentService({
    validateSocialAccountWorkspace: async (request) =>
      [target, other].some(
        (owner) =>
          owner.workspacePath === request.workspacePath &&
          owner.workspaceIdentity === request.workspaceIdentity,
      ),
    commandResolver: async () => {
      spawned++;
      throw new Error("runtime must not start");
    },
  });
  try {
    const input = {
      ...target,
      title: "Owned legacy",
      cronExpr: "0 9 * * *",
      recurring: true,
      prompt: "Read account context",
    };
    await assert.rejects(
      agent.createAutomation({
        ...input,
        workspacePath: "/forged",
        prompt: "",
        recipeSnapshot: snapshot,
      }),
      /scope is invalid/i,
    );
    assert.equal((await agent.listAllAutomations()).length, 0);
    const created = await agent.createAutomation(input);
    assert.equal(
      await agent.updateAutomation({
        ...other,
        automationId: created.automationId,
        recipeSnapshot: snapshot,
      }),
      null,
    );
    await assert.rejects(
      agent.updateAutomation({
        ...target,
        automationId: created.automationId,
        workspacePath: "/forged",
        recipeSnapshot: snapshot,
      }),
      /scope is invalid/i,
    );
    await assert.rejects(
      agent.updateAutomation({
        ...target,
        automationId: created.automationId,
        prompt: "",
        recipeSnapshot: snapshot,
      }),
      /prompt schedule/i,
    );
    const edited = await agent.updateAutomation({
      ...target,
      automationId: created.automationId,
      title: "Title only",
    });
    assert.equal(edited?.prompt, input.prompt);
    assert.equal(edited?.recipeSnapshot, undefined);
    assert.equal(spawned, 0);
  } finally {
    await agent.disposeAllAndWait();
    setDataBaseDir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
