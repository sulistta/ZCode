import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationRepo, CLAIM_STALE_MS } from "../src/session/automationRepo.js";
import { AutomationService } from "../src/session/automationService.js";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";

function scope(accountId: string) {
  return {
    workspacePath: `/social-accounts/${accountId}`,
    workspaceIdentity: `social-account:${accountId}`,
  };
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "social-harness-automation-run-"));
  const repo = new AutomationRepo(join(directory, "tasks-index.sqlite"));
  await repo.ensureReady();
  const service = new AutomationService(repo);

  return {
    directory,
    repo,
    service,
    async dispose() {
      repo.close({ throwOnError: true });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function createWeeklyAutomation(
  service: AutomationService,
  workspace: ReturnType<typeof scope>,
) {
  return service.create({
    title: "Weekly source research",
    cronExpr: "0 9 * * 1",
    prompt: "Prepare a source research brief for this account.",
    workspacePath: workspace.workspacePath,
    workspaceIdentity: workspace.workspaceIdentity,
    recurring: true,
  });
}

test("manual run admission is scoped, single-flight, and leaves its schedule unchanged", async () => {
  const fixture = await createFixture();
  try {
    const accountWorkspace = scope("account-a");
    const otherWorkspace = scope("account-b");
    const automation = await createWeeklyAutomation(fixture.service, accountWorkspace);
    const originalNextRunAt = automation.nextRunAt;

    assert.equal(await fixture.service.runNow(automation.automationId, otherWorkspace), null);
    assert.deepEqual(
      await fixture.service.listRuns(automation.automationId, otherWorkspace),
      [],
      "a different account workspace cannot read this run history",
    );

    const concurrentClaims = await Promise.all([
      fixture.service.runNow(automation.automationId, accountWorkspace),
      fixture.service.runNow(automation.automationId, accountWorkspace),
    ]);
    assert.equal(concurrentClaims.filter(Boolean).length, 1);
    const claimed = concurrentClaims.find((result) => result !== null);
    assert.ok(claimed);
    assert.equal(claimed.run.trigger, "manual");
    assert.equal(claimed.run.dispatchStatus, "claimed");
    assert.equal(claimed.run.attempts, 1);
    assert.equal(claimed.run.workspaceKey, accountWorkspace.workspaceIdentity);
    assert.equal(claimed.automation.workspaceIdentity, accountWorkspace.workspaceIdentity);
    assert.equal(claimed.automation.nextRunAt, originalNextRunAt);
    assert.equal(await fixture.service.runNow(automation.automationId, accountWorkspace), null);

    const initialHistory = await fixture.service.listRuns(
      automation.automationId,
      accountWorkspace,
    );
    assert.equal(initialHistory.length, 1);
    assert.equal(initialHistory[0]?.runId, claimed.run.runId);

    assert.equal(
      await fixture.repo.markManualRunDispatched({
        runId: claimed.run.runId,
        sessionId: "account-a-session",
        dispatchedAt: Date.now(),
      }),
      true,
    );
    assert.equal(
      await fixture.repo.markManualRunDispatched({
        runId: claimed.run.runId,
        sessionId: "duplicate-session-must-not-win",
        dispatchedAt: Date.now() + 1,
      }),
      false,
      "a late or repeated dispatch acknowledgement must not increment the run count twice",
    );

    const dispatched = await fixture.service.get(automation.automationId, accountWorkspace);
    assert.ok(dispatched);
    assert.equal(dispatched.runCount, automation.runCount + 1);
    assert.equal(dispatched.nextRunAt, originalNextRunAt);
    assert.equal(dispatched.lifecycleStatus, "active");
    assert.equal(
      await fixture.service.runNow(automation.automationId, accountWorkspace),
      null,
      "the claim stays held until the task is terminal",
    );
    const dispatchedHistory = await fixture.service.listRuns(
      automation.automationId,
      accountWorkspace,
    );
    assert.equal(dispatchedHistory[0]?.dispatchStatus, "dispatched");
    assert.equal(dispatchedHistory[0]?.sessionId, "account-a-session");

    await fixture.repo.markRunOutcome(claimed.run.runId, "succeeded");
    await fixture.repo.releaseManualClaim(automation.automationId, claimed.run.workspaceKey);
    const finished = await fixture.service.get(automation.automationId, accountWorkspace);
    assert.equal(finished?.runCount, automation.runCount + 1);
    assert.equal(finished?.nextRunAt, originalNextRunAt);
    assert.ok(await fixture.service.runNow(automation.automationId, accountWorkspace));
  } finally {
    await fixture.dispose();
  }
});

test("the scheduler can recover a manual claim left stale by a Host interruption", async () => {
  const fixture = await createFixture();
  try {
    const accountWorkspace = scope("account-recovery");
    const automation = await createWeeklyAutomation(fixture.service, accountWorkspace);
    const originalNextRunAt = automation.nextRunAt;
    const claimed = await fixture.service.runNow(automation.automationId, accountWorkspace);
    assert.ok(claimed);

    const recoveryTime = claimed.run.createdAt + CLAIM_STALE_MS + 1;
    const recovered = await fixture.repo.claimManualRuns(recoveryTime);

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.run.runId, claimed.run.runId);
    assert.equal(recovered[0]?.run.attempts, 2);
    assert.equal(recovered[0]?.automation.workspaceIdentity, accountWorkspace.workspaceIdentity);
    assert.equal(recovered[0]?.automation.workspacePath, accountWorkspace.workspacePath);
    assert.equal(recovered[0]?.automation.nextRunAt, originalNextRunAt);
    assert.equal(await fixture.service.runNow(automation.automationId, accountWorkspace), null);
  } finally {
    await fixture.dispose();
  }
});

test("a scheduled occurrence becomes claimable at nextRunAt exactly once", async () => {
  const fixture = await createFixture();
  try {
    const accountWorkspace = scope("account-scheduled");
    const automation = await createWeeklyAutomation(fixture.service, accountWorkspace);
    assert.ok(automation.nextRunAt);

    assert.deepEqual(await fixture.repo.claimDue(automation.nextRunAt - 1), []);
    const due = await fixture.repo.claimDue(automation.nextRunAt);
    assert.equal(due.length, 1);
    assert.equal(due[0]?.automationId, automation.automationId);
    assert.equal(due[0]?.workspaceIdentity, accountWorkspace.workspaceIdentity);
    assert.equal(due[0]?.workspacePath, accountWorkspace.workspacePath);
    assert.equal(due[0]?.nextRunAt, automation.nextRunAt);
    assert.deepEqual(await fixture.repo.claimDue(automation.nextRunAt), []);
    assert.equal(
      await fixture.service.runNow(automation.automationId, accountWorkspace),
      null,
      "a scheduled claim and a manual run cannot dispatch the same automation concurrently",
    );
  } finally {
    await fixture.dispose();
  }
});

test("the agent run-now API fails before claim without a dispatcher and dispatches once in scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-harness-agent-automation-run-"));
  const previousDataBaseDir = getDataBaseDir();
  const services: Array<ReturnType<typeof createZCodeAgentService>> = [];
  setDataBaseDir(directory);

  try {
    const accountWorkspace = scope("account-agent");
    const automationHost = createZCodeAgentService();
    services.push(automationHost);
    const automation = await automationHost.createAutomation({
      title: "Account source research",
      cronExpr: "0 9 * * 1",
      prompt: "Prepare a source research brief for this account.",
      workspacePath: accountWorkspace.workspacePath,
      workspaceIdentity: accountWorkspace.workspaceIdentity,
      recurring: true,
    });
    const params = { automationId: automation.automationId, ...accountWorkspace };

    await assert.rejects(
      automationHost.runAutomationNow(params),
      /Automation immediate dispatcher is unavailable/u,
    );
    assert.deepEqual(
      await automationHost.listAutomationRuns(params),
      [],
      "missing dispatch wiring must fail before writing a claim or history row",
    );

    const dispatches: Array<{
      automation: { workspaceIdentity?: string; workspacePath: string };
      run: { trigger: string; dispatchStatus: string };
    }> = [];
    const dispatchingHost = createZCodeAgentService({
      onAutomationManualRunRequested: async ({ automation: claimedAutomation, run }) => {
        dispatches.push({
          automation: claimedAutomation,
          run,
        });
      },
    });
    services.push(dispatchingHost);

    assert.deepEqual(await dispatchingHost.runAutomationNow(params), { status: "queued" });
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0]?.automation.workspacePath, accountWorkspace.workspacePath);
    assert.equal(dispatches[0]?.automation.workspaceIdentity, accountWorkspace.workspaceIdentity);
    assert.equal(dispatches[0]?.run.trigger, "manual");
    assert.equal(dispatches[0]?.run.dispatchStatus, "claimed");
    assert.deepEqual(await dispatchingHost.runAutomationNow(params), { status: "duplicate" });
    assert.equal(dispatches.length, 1, "a duplicate click must not dispatch a second prompt");

    const history = await dispatchingHost.listAutomationRuns(params);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.trigger, "manual");
    assert.equal(history[0]?.workspaceKey, accountWorkspace.workspaceIdentity);
  } finally {
    await Promise.all(services.map((service) => service.disposeAllAndWait()));
    setDataBaseDir(previousDataBaseDir);
    await rm(directory, { recursive: true, force: true });
  }
});
