import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryJournalStore } from "@social-harness/dynamic-workflow";
import {
  createDynamicWorkflowRunService,
  type DynamicWorkflowRunServiceDeps,
} from "../src/app/dynamic-workflow-run-service.js";

const accountPath = "/isolated/account-a";

function fixture(account = true) {
  const journal = new InMemoryJournalStore();
  for (const [runId, cwd, parentSessionId] of [
    ["owned", accountPath, "parent-a"],
    ["sibling", accountPath, "parent-sibling"],
    ["foreign", "/isolated/account-b", "parent-b"],
    ["legacy", undefined, "parent-legacy"],
  ])
    journal.createRun({
      runId: runId!,
      cwd,
      parentSessionId,
      scriptText: `source ${runId}`,
      status: "stopped",
      caps: { maxConcurrency: 1 },
      spentTokens: 0,
    });
  let detailReads = 0;
  Object.assign(journal, {
    getRunRow() {
      detailReads++;
      throw new Error("Detail must be rejected before query");
    },
    countNodesByStatus() {
      throw new Error("Node query forbidden");
    },
    listRecentLogEvents() {
      throw new Error("Log query forbidden");
    },
    listRuns() {
      detailReads++;
      throw new Error("Foreign listing must reject before query");
    },
  });
  const service = createDynamicWorkflowRunService({
    journal,
    parentSessionId: "parent-a",
    ...(account ? { capabilityScope: "social-account", accountWorkspacePath: accountPath } : {}),
    fileSystemPort: {},
    executionPort: {},
    createActorRuntime() {
      throw new Error("Must not launch an actor");
    },
  } as DynamicWorkflowRunServiceDeps);
  return { service, journal, detailReads: () => detailReads };
}

test("account run IDs cannot disclose another account's script or snapshot", async () => {
  const { service } = fixture();
  for (const id of ["foreign", "legacy", "unknown"]) {
    assert.equal(await service.getScript?.(id), undefined);
    assert.equal(await service.getTask(id), undefined);
    assert.equal(await service.waitForTask(id), undefined);
  }
  assert.equal(await service.getScript?.("owned"), "source owned");
  assert.equal(await service.getScript?.("sibling"), "source sibling");
  await service.close();
});

test("detail and list scope reject before querying journal detail", async () => {
  const { service, detailReads } = fixture();
  assert.equal(await service.getRunDetail?.("foreign"), undefined);
  assert.deepEqual(await service.listRuns?.({ cwd: "/isolated/account-b", limit: 10 }), {
    runs: [],
  });
  assert.equal(detailReads(), 0);
  await service.close();
});

test("foreign event and artifact requests have the same absence result as unknown IDs", async () => {
  const { service, journal } = fixture();
  let eventReads = 0;
  const listEvents = journal.listEvents.bind(journal);
  journal.listEvents = (id, options) => {
    if (id === "foreign") {
      eventReads++;
      throw new Error("Foreign event read");
    }
    return listEvents(id, options);
  };
  assert.deepEqual(await service.listEvents?.("foreign", { limit: 10 }), []);
  assert.equal(await service.listArtifacts?.("foreign"), undefined);
  assert.deepEqual(await service.listArtifactItems?.("foreign", "report", { limit: 10 }), []);
  assert.equal(eventReads, 0);
  await service.close();
});

test("submit cannot replace account cwd, parent identity or filesystem source", async () => {
  const { service } = fixture();
  const request = {
    scriptText: "return 'fixture';",
    cwd: accountPath,
    parentSessionId: "parent-a",
    trace: {},
  };
  for (const altered of [
    { ...request, cwd: "/isolated/account-b" },
    { ...request, parentSessionId: "parent-b" },
    { ...request, scriptPath: "/outside/script.dwf.ts" },
  ])
    await assert.rejects(async () => service.submit(altered as never), /Account workflow scope/);
  assert.equal(service.countLiveRuns(), 0);
  await service.close();
});

test("resume cannot transfer foreign or sibling runs to a different parent", async () => {
  const { service } = fixture();
  for (const id of ["foreign", "sibling", "legacy", "unknown"]) {
    assert.deepEqual(await service.resume?.(id), { ok: false, reason: "not_found" });
  }
  await service.close();
});

test("generic run services retain their existing script lookup", async () => {
  const { service } = fixture(false);
  assert.equal(await service.getScript?.("foreign"), "source foreign");
  await service.close();
});
