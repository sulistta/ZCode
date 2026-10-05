import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRootTraceContext } from "@social-harness/contracts";
import { InMemoryJournalStore } from "@social-harness/dynamic-workflow";
import {
  createDynamicWorkflowRunService,
  type DynamicWorkflowRunServiceDeps,
} from "../src/app/dynamic-workflow-run-service.js";

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }, account = true) {
  const cwd = await mkdtemp(join(tmpdir(), "account-recipe-admission-"));
  const journal = new InMemoryJournalStore();
  let created = 0;
  const createRun = journal.createRun.bind(journal);
  journal.createRun = (record) => {
    created++;
    createRun(record);
  };
  const deps = {
    journal,
    parentSessionId: "approved-parent",
    ...(account ? { capabilityScope: "social-account", accountWorkspacePath: cwd } : {}),
    fileSystemPort: {},
    executionPort: {},
    createActorRuntime() {
      throw new Error("The fixture script must not create an actor");
    },
  } as DynamicWorkflowRunServiceDeps;
  const services = [createDynamicWorkflowRunService(deps)];
  t.after(async () => {
    await Promise.all(services.map((service) => service.close()));
    await rm(cwd, { recursive: true, force: true });
  });
  const request = {
    scriptText: "log('isolated admission'); return args.amount;",
    cwd,
    name: "approved-recipe",
    args: { amount: 4 },
    parentSessionId: deps.parentSessionId,
    toolCallId: "launch-occurrence-1",
    launchInputId: "occurrence-1",
    admissionKey: "occurrence-1",
    trace: createRootTraceContext(),
  };
  return {
    journal,
    request,
    service: services[0]!,
    created: () => created,
    reopen() {
      const service = createDynamicWorkflowRunService(deps);
      services.push(service);
      return service;
    },
  };
}

test("simultaneous account admissions and a lost-ACK retry execute one real engine run", async (t) => {
  const f = await fixture(t);
  const pending = f.service.submit(f.request);
  const duplicate = await f.service.submit(f.request);
  const first = await pending;
  assert.equal(duplicate.runId, first.runId);
  assert.equal(duplicate.replayed, true);
  assert.match(first.runId, /^dwfrun-[a-f0-9]{64}$/);
  const settled = await f.service.waitForTask(first.runId);
  assert.equal(settled?.status, "completed");
  assert.equal(f.journal.getRun(first.runId)?.result, 4);
  assert.equal(f.created(), 1);
  assert.deepEqual(await f.service.submit(f.request), { ...first, replayed: true });
  assert.equal(f.created(), 1);
});

test("the existing registry admits a retry even before the journal read can see the row", async (t) => {
  const f = await fixture(t);
  const first = await f.service.submit(f.request);
  const getRun = f.journal.getRun.bind(f.journal);
  f.journal.getRun = () => undefined;
  try {
    assert.deepEqual(await f.service.submit(f.request), { ...first, replayed: true });
    await assert.rejects(
      f.service.submit({ ...f.request, args: { amount: 8 } }),
      /admission conflict/i,
    );
  } finally {
    f.journal.getRun = getRun;
  }
  await f.service.waitForTask(first.runId);
  assert.equal(f.created(), 1);
});

test("cold journal admissions return the owned engine run without automatically resuming it", async (t) => {
  const f = await fixture(t);
  const first = await f.service.submit(f.request);
  await f.service.waitForTask(first.runId);
  await f.service.close();
  const reopened = f.reopen();
  assert.deepEqual(await reopened.submit(f.request), { ...first, replayed: true });
  assert.equal(f.created(), 1);
  f.journal.updateRunStatus(first.runId, "stopped", {
    stopReason: "interrupted",
  });
  assert.deepEqual(await reopened.submit(f.request), { ...first, replayed: true });
  assert.equal(f.created(), 1);
  assert.equal(f.journal.getRun(first.runId)?.status, "stopped");
});

test("an admitted occurrence rejects conflicting reviewed inputs before another launch", async (t) => {
  const f = await fixture(t);
  const first = await f.service.submit(f.request);
  for (const change of [
    { scriptText: "return 8;" },
    { args: { amount: 8 } },
    { name: "another-recipe" },
  ])
    await assert.rejects(f.service.submit({ ...f.request, ...change }), /admission conflict/i);
  await f.service.waitForTask(first.runId);
  await f.service.close();
  const reopened = f.reopen();
  await assert.rejects(
    reopened.submit({ ...f.request, args: { amount: 9 } }),
    /admission conflict/i,
  );
  assert.equal(f.created(), 1);
});

test("distinct occurrence keys execute independently and malformed account keys are rejected", async (t) => {
  const f = await fixture(t);
  for (const admissionKey of ["", "a".repeat(513)])
    await assert.rejects(f.service.submit({ ...f.request, admissionKey }), /admission key/i);
  assert.equal(f.created(), 0);
  const first = await f.service.submit(f.request);
  const second = await f.service.submit({
    ...f.request,
    admissionKey: "occurrence-2",
    launchInputId: "occurrence-2",
    toolCallId: "launch-occurrence-2",
  });
  assert.notEqual(first.runId, second.runId);
  await Promise.all([f.service.waitForTask(first.runId), f.service.waitForTask(second.runId)]);
  assert.equal(f.created(), 2);
});

test("the same occurrence key in two account directories cannot reuse the other account's run", async (t) => {
  const firstAccount = await fixture(t);
  const secondAccount = await fixture(t);
  const first = await firstAccount.service.submit(firstAccount.request);
  const second = await secondAccount.service.submit(secondAccount.request);
  assert.notEqual(first.runId, second.runId);
  await Promise.all([
    firstAccount.service.waitForTask(first.runId),
    secondAccount.service.waitForTask(second.runId),
  ]);
  assert.equal(firstAccount.journal.getRun(second.runId), undefined);
  assert.equal(secondAccount.journal.getRun(first.runId), undefined);
});

test("generic submissions without an admission key preserve independent engine launches", async (t) => {
  const f = await fixture(t, false);
  const { admissionKey, ...request } = f.request;
  void admissionKey;
  const first = await f.service.submit(request);
  const second = await f.service.submit(request);
  assert.notEqual(first.runId, second.runId);
  assert.equal(first.replayed, undefined);
  assert.equal(second.replayed, undefined);
  await Promise.all([f.service.waitForTask(first.runId), f.service.waitForTask(second.runId)]);
  assert.equal(f.created(), 2);
});
