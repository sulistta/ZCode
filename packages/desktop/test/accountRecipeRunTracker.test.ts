import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountRecipeRunTracker } from "../src/host/accountRecipeRunTracker.js";
import type {
  ConversationTelemetryFact,
  V4ConversationWorkflowRunSummary,
} from "@social-harness/shared/zcode-protocol-v4";
import type { ZCodeAutomationRun } from "@social-harness/shared";

const run: ZCodeAutomationRun = {
  runId: "recipe:manual:one",
  automationId: "recipe",
  workspaceKey: "social-account:a",
  trigger: "manual",
  sessionId: "parent",
  dispatchStatus: "claimed",
  attempts: 1,
  createdAt: 1,
  updatedAt: 1,
};

function fixture(t: { after(fn: () => void): void }, ownedRun = run) {
  const writes: Array<{ outcome: string; error?: string }> = [];
  const listeners = new Set<(fact: ConversationTelemetryFact) => void>();
  let summaries: V4ConversationWorkflowRunSummary[] = [];
  let releases = 0;
  let unread = 0;
  let reads = 0;
  const tracker = createAccountRecipeRunTracker({
    run: ownedRun,
    target: { workspacePath: "/accounts/a", workspaceIdentity: ownedRun.workspaceKey },
    agent: {
      onDynamicConversationTelemetryFact(target) {
        assert.equal(target.workspaceIdentity, ownedRun.workspaceKey);
        return (listener) => {
          listeners.add(listener);
          return {
            dispose: () => {
              listeners.delete(listener);
            },
          };
        };
      },
      async conversationWorkflowRunsV4(target) {
        reads++;
        assert.equal(target.workspaceIdentity, ownedRun.workspaceKey);
        assert.equal(target.sessionId, "parent");
        return { runs: summaries };
      },
    },
    repo: {
      async ensureRunClaimed(identity) {
        assert.equal(identity.workspaceKey, ownedRun.workspaceKey);
      },
      async markRunOutcome(id, outcome, error) {
        assert.equal(id, ownedRun.runId);
        writes.push({ outcome, ...(error ? { error } : {}) });
      },
      async touchManualClaim() {},
      async markRunDispatch() {
        assert.fail("The outcome tracker must not declare dispatch");
      },
      async releaseManualClaim(id, workspaceKey) {
        assert.equal(id, ownedRun.automationId);
        assert.equal(workspaceKey, ownedRun.workspaceKey);
        releases++;
      },
    },
    async setUnread() {
      unread++;
    },
    logWarn() {
      assert.fail("No unexpected settlement error");
    },
  });
  t.after(() => tracker.dispose());
  return {
    tracker,
    writes,
    listeners,
    emit(fact: ConversationTelemetryFact) {
      for (const listener of listeners) listener(fact);
    },
    setSummaries(value: V4ConversationWorkflowRunSummary[]) {
      summaries = value;
    },
    counts: () => ({ releases, unread, reads }),
  };
}

function terminal(overrides: Partial<ConversationTelemetryFact> = {}): ConversationTelemetryFact {
  return {
    version: 1,
    eventId: "event",
    eventSeq: 1,
    occurredAt: 1,
    sessionId: "parent",
    sourceCommandId: run.runId,
    kind: "workflow.lifecycle",
    phase: "run-settled",
    runId: "engine-one",
    toolCallId: `launch-${run.runId}`,
    status: "completed",
    ...overrides,
  } as ConversationTelemetryFact;
}

test("only the owned engine terminal settles a recipe, never its control turn or another admission", async (t) => {
  const f = fixture(t);
  await f.tracker.markRunning();
  for (const fact of [
    {
      version: 1,
      eventId: "control",
      eventSeq: 1,
      occurredAt: 1,
      sessionId: "parent",
      sourceCommandId: run.runId,
      kind: "turn.terminal",
      status: "success",
    } as ConversationTelemetryFact,
    terminal({ sessionId: "other-parent" }),
    terminal({ sourceCommandId: "other-occurrence" }),
    terminal({ toolCallId: "launch-other-occurrence" }),
    terminal({ phase: "actor-spawned" }),
  ])
    f.emit(fact);
  await f.tracker.flush();
  assert.deepEqual(f.writes, [{ outcome: "running" }]);
  assert.equal(f.counts().releases, 0);
  f.emit(terminal());
  await f.tracker.flush();
  assert.deepEqual(f.writes, [{ outcome: "running" }, { outcome: "succeeded" }]);
  assert.deepEqual(f.counts(), { releases: 1, unread: 1, reads: 0 });
  assert.equal(f.listeners.size, 0);
});

test("an engine error before the ACK is first-wins and a late running record cannot replace it", async (t) => {
  const f = fixture(t);
  f.emit(terminal({ status: "errored", errorMessage: "Actor permission denied" }));
  f.emit(terminal());
  await f.tracker.markRunning();
  await f.tracker.flush();
  assert.deepEqual(f.writes, [{ outcome: "failed", error: "Actor permission denied" }]);
  assert.equal(f.counts().releases, 1);
});

test("reconnection reads the owned terminal journal without another command or engine launch", async (t) => {
  const f = fixture(t);
  f.setSummaries([
    { runId: "unrelated", toolCallId: "launch-another", status: "completed", resumable: false },
    {
      runId: "accepted",
      toolCallId: `launch-${run.runId}`,
      status: "stopped",
      stopReason: "interrupted",
      failureMessage: "Host stopped",
      resumable: true,
    },
  ]);
  assert.equal(await f.tracker.reconcile(), true);
  assert.deepEqual(f.writes, [{ outcome: "stopped", error: "Host stopped" }]);
  assert.deepEqual(f.counts(), { releases: 1, unread: 1, reads: 1 });
});

test("running journal is admission evidence but cannot release a claim or report success", async (t) => {
  const f = fixture(t);
  f.setSummaries([
    { runId: "accepted", toolCallId: `launch-${run.runId}`, status: "running", resumable: false },
  ]);
  assert.equal(await f.tracker.reconcile(), true);
  assert.deepEqual(f.writes, [{ outcome: "running" }]);
  assert.equal(f.counts().releases, 0);
  f.emit(terminal({ status: "stopped", stopReason: "user" }));
  await f.tracker.flush();
  assert.deepEqual(f.writes.at(-1), { outcome: "stopped", error: "user" });
});

test("absence in the journal is not a terminal outcome or proof of a failed admission", async (t) => {
  const f = fixture(t);
  f.setSummaries([
    { runId: "other", toolCallId: "launch-other", status: "errored", resumable: false },
  ]);
  assert.equal(await f.tracker.reconcile(), false);
  assert.deepEqual(f.writes, []);
  assert.equal(f.counts().releases, 0);
  assert.equal(f.listeners.size, 1);
});

test("scheduled engine settlement leaves manual claim ownership untouched", async (t) => {
  const scheduled = { ...run, runId: "recipe:100", trigger: "schedule" as const, scheduledAt: 100 };
  const f = fixture(t, scheduled);
  f.emit(terminal({ sourceCommandId: scheduled.runId, toolCallId: `launch-${scheduled.runId}` }));
  await f.tracker.flush();
  assert.deepEqual(f.writes, [{ outcome: "succeeded" }]);
  assert.equal(f.counts().releases, 0);
});
