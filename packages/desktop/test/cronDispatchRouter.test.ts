import assert from "node:assert/strict";
import test from "node:test";
import { HostMessageTypes } from "@social-harness/shared";
import type { UtilityProcess } from "electron";
import {
  routeCronDispatchRequest,
  type CronDispatchRequest,
} from "../src/main/cronDispatchRouter.js";
import type { MainToSchedulerMessage } from "../src/scheduler/schedulerProtocol.js";

const request: CronDispatchRequest = {
  type: "cron-dispatch-request",
  automationId: "automation-a",
  runId: "run-a",
  prompt: "Prepare this account's weekly research.",
  targetTaskId: "task-a",
  modelSelection: { providerId: "provider-a", modelId: "model-a" },
  mode: "plan",
  workspacePath: "/accounts/account-a",
  workspaceIdentity: "social-account:account-a",
};

function createDeps(host: Pick<UtilityProcess, "postMessage"> | null) {
  const schedulerMessages: MainToSchedulerMessage[] = [];
  const warnings: unknown[][] = [];

  return {
    schedulerMessages,
    warnings,
    deps: {
      isDisposing: false,
      postToScheduler(message: MainToSchedulerMessage) {
        schedulerMessages.push(message);
      },
      resolveDispatchHost: () => host,
      logger: {
        warn(...args: unknown[]) {
          warnings.push(args);
        },
      },
    },
  };
}

test("forwards the complete scheduled run context to the resolved Host", () => {
  const hostMessages: unknown[] = [];
  const host = {
    postMessage(message: unknown) {
      hostMessages.push(message);
    },
  } as Pick<UtilityProcess, "postMessage">;
  const fixture = createDeps(host);

  routeCronDispatchRequest(request, fixture.deps);

  assert.deepEqual(hostMessages, [
    {
      type: HostMessageTypes.CronRun,
      automationId: request.automationId,
      runId: request.runId,
      prompt: request.prompt,
      targetTaskId: request.targetTaskId,
      modelSelection: request.modelSelection,
      mode: request.mode,
      workspacePath: request.workspacePath,
      workspaceIdentity: request.workspaceIdentity,
    },
  ]);
  assert.deepEqual(fixture.schedulerMessages, []);
});

test("returns a transient result when no local Host can accept the run", () => {
  const fixture = createDeps(null);

  routeCronDispatchRequest(request, fixture.deps);

  assert.deepEqual(fixture.schedulerMessages, [
    {
      type: "cron-dispatch-result",
      runId: request.runId,
      ok: false,
      failureKind: "transient",
      error: "no local host available",
    },
  ]);
});

test("returns a transient result when forwarding to Host throws", () => {
  const fixture = createDeps({
    postMessage() {
      throw new Error("Host process is gone");
    },
  } as Pick<UtilityProcess, "postMessage">);

  routeCronDispatchRequest(request, fixture.deps);

  assert.deepEqual(fixture.schedulerMessages, [
    {
      type: "cron-dispatch-result",
      runId: request.runId,
      ok: false,
      failureKind: "transient",
      error: "Host process is gone",
    },
  ]);
  assert.equal(fixture.warnings.length, 1);
});

test("rejects new scheduled dispatch while Main is disposing", () => {
  let hostResolutionCount = 0;
  const fixture = createDeps(null);
  fixture.deps.isDisposing = true;
  fixture.deps.resolveDispatchHost = () => {
    hostResolutionCount += 1;
    return null;
  };

  routeCronDispatchRequest(request, fixture.deps);

  assert.equal(hostResolutionCount, 0);
  assert.deepEqual(fixture.schedulerMessages, [
    {
      type: "cron-dispatch-result",
      runId: request.runId,
      ok: false,
      failureKind: "transient",
      error: "app is shutting down",
    },
  ]);
});
