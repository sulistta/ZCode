import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dispatchAccountRecipeOccurrence,
  AccountRecipeAdmissionUncertainError,
} from "../src/host/accountRecipeCronDispatch.js";
import type { ZCodeAutomationRun } from "@social-harness/shared";
import type {
  CommandAck,
  ConversationTelemetryFact,
  V4ConversationWorkflowRunSummary,
} from "@social-harness/shared/zcode-protocol-v4";

const snapshot = {
  schemaVersion: 1 as const,
  name: "daily",
  meta: { description: "Reviewed" },
  script: "return 'approved';",
  args: { choice: "approved" },
};
const owner = {
  runId: "recipe:100",
  automationId: "recipe",
  workspacePath: "/accounts/a",
  workspaceIdentity: "social-account:a",
};
const initial: ZCodeAutomationRun = {
  runId: owner.runId,
  automationId: owner.automationId,
  workspaceKey: owner.workspaceIdentity,
  recipeSnapshot: snapshot,
  trigger: "schedule",
  scheduledAt: 100,
  dispatchStatus: "claimed",
  attempts: 1,
  createdAt: 1,
  updatedAt: 1,
};
type Params = Parameters<typeof dispatchAccountRecipeOccurrence>[0];

function fixture(t: { after(fn: () => void): void }, run = { ...initial }) {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const listeners = new Set<(fact: ConversationTelemetryFact) => void>();
  let rows: V4ConversationWorkflowRunSummary[] = [];
  let sendFailure: Error | undefined;
  let ack: CommandAck = {
    commandId: owner.runId,
    status: "accepted",
    revisionAtDecision: 1,
    result: { type: "startSavedWorkflow", runId: "engine", toolCallId: `launch-${owner.runId}` },
  };
  let binding = run.sessionId;
  const trackers: Array<{ dispose(): void }> = [];
  const params: Params = {
    ...owner,
    run,
    repo: {
      async fixRunSession(input) {
        calls.push({ name: "bind", value: input });
        binding ??= input.sessionId;
        return binding;
      },
      async ensureRunClaimed() {},
      async markRunOutcome(id, outcome, error) {
        calls.push({ name: "outcome", value: { id, outcome, error } });
      },
      async markRunDispatch(input) {
        calls.push({ name: "dispatch", value: input });
      },
      async touchManualClaim() {},
      async releaseManualClaim() {
        calls.push({ name: "release" });
      },
    },
    agent: {
      async validateSavedWorkflow(input) {
        calls.push({ name: "validate", value: input });
        return { ok: true, approvedSnapshot: input.approvedSnapshot };
      },
      onDynamicConversationTelemetryFact() {
        return (listener) => {
          calls.push({ name: "subscribe" });
          listeners.add(listener);
          return {
            dispose() {
              listeners.delete(listener);
            },
          };
        };
      },
      async conversationWorkflowRunsV4(input) {
        calls.push({ name: "query", value: input });
        return { runs: rows };
      },
      async sendConversationCommandV4(input) {
        calls.push({ name: "send", value: input });
        if (sendFailure) throw sendFailure;
        return ack;
      },
    },
    async createParent() {
      calls.push({ name: "create" });
      return "new-parent";
    },
    async resumeParent(id) {
      calls.push({ name: "resume", value: id });
    },
    async discardEmptyParent(id) {
      calls.push({ name: "discard", value: id });
    },
    registerTracker(tracker) {
      trackers.push(tracker);
      t.after(() => tracker.dispose());
    },
    async setUnread() {
      calls.push({ name: "unread" });
    },
    logWarn() {},
  };
  return {
    params,
    calls,
    setRows(value: typeof rows) {
      rows = value;
    },
    failSend(error: Error) {
      sendFailure = error;
    },
    rejectAck() {
      ack = {
        commandId: owner.runId,
        status: "rejected",
        revisionAtDecision: 1,
        message: "Invalid recipe",
      };
    },
    bindExisting(id: string) {
      binding = id;
    },
    listeners,
  };
}

test("dispatch admits only the reviewed occurrence source with its fixed parent and stable command ID", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await dispatchAccountRecipeOccurrence(f.params), {
    taskId: "new-parent",
    sessionId: "new-parent",
  });
  const send = f.calls.find((call) => call.name === "send")?.value as Parameters<
    Params["agent"]["sendConversationCommandV4"]
  >[0];
  assert.equal(send.envelope.commandId, owner.runId);
  assert.equal(send.envelope.sessionId, "new-parent");
  assert.equal(send.envelope.type, "startSavedWorkflow");
  assert.deepEqual(send.envelope.payload, {
    name: snapshot.name,
    scope: "project",
    approvedSnapshot: snapshot,
  });
  assert.equal(send.clientMode, "desktop-continuous");
  const names = f.calls.map((call) => call.name);
  assert.ok(names.indexOf("bind") < names.indexOf("subscribe"));
  assert.ok(names.indexOf("subscribe") < names.indexOf("send"));
});

test("foreign, missing or malformed snapshots reject before parent or agent IO", async (t) => {
  for (const run of [
    { ...initial, workspaceKey: "social-account:b" },
    { ...initial, automationId: "other" },
    { ...initial, runId: "other:100" },
    { ...initial, recipeSnapshot: undefined },
    { ...initial, recipeSnapshotError: "invalid_recipe_snapshot" as const },
  ]) {
    const f = fixture(t, run);
    await assert.rejects(dispatchAccountRecipeOccurrence(f.params), /unavailable|invalid/i);
    assert.deepEqual(f.calls, []);
  }
});

test("retry resumes the exact bound parent and discovers an interrupted journal without relaunch", async (t) => {
  const f = fixture(t, { ...initial, sessionId: "first-parent" });
  f.setRows([
    {
      runId: "engine",
      toolCallId: `launch-${owner.runId}`,
      status: "stopped",
      stopReason: "interrupted",
      failureMessage: "Interrupted",
      resumable: true,
    },
  ]);
  assert.equal((await dispatchAccountRecipeOccurrence(f.params)).sessionId, "first-parent");
  assert.equal(f.calls.filter((call) => call.name === "create" || call.name === "send").length, 0);
  assert.deepEqual(f.calls.find((call) => call.name === "resume")?.value, "first-parent");
  assert.ok(
    f.calls.some(
      (call) =>
        call.name === "outcome" && (call.value as { outcome: string }).outcome === "stopped",
    ),
  );
});

test("a racing new parent loses the binding and only its empty session is reclaimed", async (t) => {
  const f = fixture(t);
  f.bindExisting("winning-parent");
  assert.equal((await dispatchAccountRecipeOccurrence(f.params)).sessionId, "winning-parent");
  assert.equal(f.calls.find((call) => call.name === "discard")?.value, "new-parent");
  assert.equal(f.calls.find((call) => call.name === "resume")?.value, "winning-parent");
  assert.equal(f.calls.filter((call) => call.name === "send").length, 1);
});

test("a missing bound parent is an explicit failure and does not create a replacement", async (t) => {
  const f = fixture(t, { ...initial, sessionId: "missing-parent" });
  f.params.resumeParent = async () => {
    throw new Error("Parent is unavailable");
  };
  await assert.rejects(dispatchAccountRecipeOccurrence(f.params), /unavailable/);
  assert.equal(f.calls.filter((call) => call.name === "create" || call.name === "send").length, 0);
});

test("a lost ACK reconciles accepted journal work under the same occurrence and parent", async (t) => {
  const f = fixture(t);
  f.failSend(new Error("ACK lost"));
  const send = f.params.agent.sendConversationCommandV4;
  f.params.agent.sendConversationCommandV4 = async (input) => {
    f.setRows([
      { runId: "engine", toolCallId: `launch-${owner.runId}`, status: "running", resumable: false },
    ]);
    return send(input);
  };
  assert.equal((await dispatchAccountRecipeOccurrence(f.params)).sessionId, "new-parent");
  assert.equal(f.calls.filter((call) => call.name === "send").length, 1);
  assert.equal(
    f.calls.some((call) => call.name === "release"),
    false,
  );
});

test("an uncertain transport exception retains the tracker and bound parent; it is not confirmed failure", async (t) => {
  const f = fixture(t);
  f.failSend(new Error("Transport disconnected"));
  await assert.rejects(
    dispatchAccountRecipeOccurrence(f.params),
    AccountRecipeAdmissionUncertainError,
  );
  assert.equal(f.listeners.size, 1);
  assert.equal(
    f.calls.some((call) => call.name === "discard" || call.name === "release"),
    false,
  );
  assert.equal(
    f.calls.some(
      (call) => call.name === "outcome" && (call.value as { outcome: string }).outcome === "failed",
    ),
    false,
  );
});

test("a confirmed rejection without an engine run disposes tracking", async (t) => {
  const f = fixture(t);
  f.rejectAck();
  await assert.rejects(dispatchAccountRecipeOccurrence(f.params), /Invalid recipe/);
  assert.equal(f.listeners.size, 0);
});

test("another command's accepted or rejected ACK cannot settle this occurrence", async (t) => {
  for (const status of ["accepted", "rejected"] as const) {
    const f = fixture(t);
    f.params.agent.sendConversationCommandV4 = async () => ({
      commandId: "another-occurrence",
      status,
      revisionAtDecision: 1,
      ...(status === "accepted"
        ? {
            result: {
              type: "startSavedWorkflow" as const,
              runId: "other-engine",
              toolCallId: "launch-other",
            },
          }
        : { message: "Another command rejected" }),
    });
    await assert.rejects(
      dispatchAccountRecipeOccurrence(f.params),
      AccountRecipeAdmissionUncertainError,
    );
    assert.equal(f.listeners.size, 1);
    assert.equal(
      f.calls.some((call) => call.name === "release" || call.name === "discard"),
      false,
    );
  }
});

test("owned journal evidence overrides another command's rejected ACK", async (t) => {
  const f = fixture(t);
  f.params.agent.sendConversationCommandV4 = async () => {
    f.setRows([
      {
        runId: "engine",
        toolCallId: `launch-${owner.runId}`,
        status: "completed",
        resumable: false,
      },
    ]);
    return { commandId: "another-occurrence", status: "rejected", revisionAtDecision: 1 };
  };
  assert.equal((await dispatchAccountRecipeOccurrence(f.params)).sessionId, "new-parent");
  assert.ok(
    f.calls.some(
      (call) =>
        call.name === "outcome" && (call.value as { outcome: string }).outcome === "succeeded",
    ),
  );
  assert.equal(f.listeners.size, 0);
});
