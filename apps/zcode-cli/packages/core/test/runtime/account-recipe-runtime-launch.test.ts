import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRootTraceContext, SessionEventType } from "@social-harness/contracts";
import { startSavedWorkflowRun } from "../../src/runtime/methods/dynamic-workflow-run-start.js";
import type { AgentRuntimeInternal } from "../../src/runtime/internal.js";

const snapshot = {
  schemaVersion: 1 as const,
  name: "daily",
  meta: { description: "Reviewed", args: { amount: { type: "number" as const, default: 4 } } },
  script: "return args.amount;",
  args: {},
};

async function runtime(t: { after: (cleanup: () => Promise<void>) => void }) {
  const cwd = await mkdtemp(join(tmpdir(), "account-runtime-launch-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const submissions: Record<string, unknown>[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const tracked: unknown[] = [];
  let persisted = 0;
  const subject = {
    workingDirectory: cwd,
    sessionId: "review-parent",
    config: { workspaceIdentity: "social-account:runtime-review" },
    rootTraceContext: createRootTraceContext(),
    hasActiveOrQueuedTurnWork: () => false,
    ensureContextInitialized: async () => {},
    ensureSessionPersisted: async () => {
      persisted++;
    },
    dynamicWorkflowRunPort: {
      submit: async (input: Record<string, unknown>) => {
        submissions.push(input);
        return { runId: "engine-reviewed" };
      },
    },
    messageHistory: { addUser: () => {}, setCacheMiss: () => {} },
    turnNumber: 0,
    createEvent: (type: string, payload: Record<string, unknown>) => ({ type, payload }),
    appendEvent: async (event: (typeof events)[number]) => {
      events.push(event);
    },
    executor: {
      trackExternalBackgroundTask: async (...input: unknown[]) => {
        tracked.push(input);
      },
    },
    logger: {
      error: (...input: unknown[]) => assert.fail(`Unexpected bookkeeping failure: ${input[0]}`),
    },
  } as unknown as AgentRuntimeInternal;
  return { subject, submissions, events, tracked, cwd, persisted: () => persisted };
}

test("the runtime submits reviewed bytes and the same launch source to continuous/replay events", async (t) => {
  const fixture = await runtime(t);
  const result = await startSavedWorkflowRun.call(fixture.subject, {
    name: snapshot.name,
    scope: "project",
    approvedSnapshot: snapshot,
  });
  assert.ok(result.ok);
  assert.equal(result.runId, "engine-reviewed");
  assert.equal(fixture.submissions.length, 1);
  const submission = fixture.submissions[0]!;
  assert.equal(submission.scriptText, snapshot.script);
  assert.deepEqual(submission.args, { amount: 4 });
  assert.equal(submission.parentSessionId, "review-parent");
  assert.equal(submission.scriptPath, undefined);
  assert.deepEqual(await readdir(fixture.cwd), []);
  assert.equal(fixture.tracked.length, 1);
  const started = fixture.events.find((event) => event.type === SessionEventType.TurnStarted)!;
  assert.equal(started.payload.executionKind, "controlOnly");
  assert.equal(started.payload.inputId, submission.launchInputId);
  const launch = started.payload.workflowLaunch as { script: string; args: unknown };
  assert.equal(launch.script, snapshot.script);
  assert.deepEqual(launch.args, { amount: 4 });
  assert.ok(fixture.events.some((event) => event.type === SessionEventType.TurnComplete));
});

test("missing approval and compile/argument failures have no runtime persistence or submission", async (t) => {
  const fixture = await runtime(t);
  for (const approvedSnapshot of [
    undefined,
    { ...snapshot, script: "return missingReviewValue;" },
    { ...snapshot, args: { amount: "wrong" } },
  ]) {
    const result = await startSavedWorkflowRun.call(fixture.subject, {
      name: "daily",
      approvedSnapshot,
    });
    assert.equal(result.ok, false);
  }
  assert.equal(fixture.persisted(), 0);
  assert.deepEqual(fixture.submissions, []);
  assert.deepEqual(fixture.events, []);
});

test("account command identity reaches engine admission and replay does not duplicate the launch turn", async (t) => {
  const fixture = await runtime(t);
  fixture.subject.dynamicWorkflowRunPort!.submit = async (input) => {
    fixture.submissions.push(input as unknown as Record<string, unknown>);
    return {
      ok: true,
      runId: "engine-reviewed",
      ...(fixture.submissions.length > 1 ? { replayed: true as const } : {}),
    };
  };
  const input = {
    name: snapshot.name,
    scope: "project" as const,
    approvedSnapshot: snapshot,
    launchInputId: "occurrence-approved-1",
  };
  const first = await startSavedWorkflowRun.call(fixture.subject, input);
  const replay = await startSavedWorkflowRun.call(fixture.subject, input);
  assert.deepEqual(replay, first);
  assert.equal(fixture.submissions[0]!.admissionKey, input.launchInputId);
  assert.equal(fixture.submissions[0]!.launchInputId, input.launchInputId);
  assert.equal(fixture.submissions[1]!.admissionKey, input.launchInputId);
  assert.equal(fixture.tracked.length, 1);
  assert.equal(
    fixture.events.filter((event) => event.type === SessionEventType.TurnStarted).length,
    1,
  );
});
