import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AutomationRepo, CLAIM_STALE_MS } from "../src/session/automationRepo.js";
import {
  runTasksDatabaseMigrations,
  areTasksDatabaseMigrationsApplied,
} from "../src/session/tasksDatabase/migrations.js";

const scope = { workspacePath: "/account-recipes/a", workspaceIdentity: "social-account:a" };
const first = {
  schemaVersion: 1 as const,
  name: "daily",
  meta: { description: "Approved first" },
  script: "return 'first';",
  args: {},
};
const second = {
  ...first,
  meta: { description: "Approved replacement" },
  script: "return 'second';",
};
const oldChecksums = [
  "3e8337b015d94b05dd31a6003f3acc649e821794cfa288bc0af3022698bd4d17",
  "7244ef7c351f8d02750ab1953fff09f493a71befbf1b6e2d4bab726b0c6b48fc",
  "8987adb50ae412a46c294141c1af89ccfc252f22d41351bdf4c7528f56edc8b4",
];

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "social-schedule-recipe-"));
  const path = join(directory, "tasks-index.sqlite");
  const repo = new AutomationRepo(path);
  const databases: DatabaseSync[] = [];
  await repo.ensureReady();
  t.after(async () => {
    for (const database of databases) database.close();
    repo.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    path,
    repo,
    openDatabase() {
      const database = new DatabaseSync(path);
      databases.push(database);
      return database;
    },
    databases,
  };
}

function createParams(snapshot = first) {
  return {
    ...scope,
    title: "Daily reviewed recipe",
    cronExpr: "0 9 * * *",
    prompt: "",
    recurring: true,
    recipeSnapshot: snapshot,
  };
}

test("an engine failure before the dispatch ACK keeps its error and first parent", async (t) => {
  const { repo } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100 });
  await repo.claimDue(100);
  const runId = `${automation.automationId}:100`;
  await repo.fixRunSession({
    runId,
    automationId: automation.automationId,
    workspaceKey: scope.workspaceIdentity,
    sessionId: "first-parent",
  });
  await repo.markRunOutcome(runId, "failed", "Actual engine failure");
  await repo.markRunDispatch({ runId, dispatchStatus: "dispatched", sessionId: "late-parent" });
  assert.equal((await repo.getRun(runId))?.error, "Actual engine failure");
  assert.equal((await repo.getRun(runId))?.outcome, "failed");
  assert.equal((await repo.getRun(runId))?.sessionId, "first-parent");
});

test("a manual engine failure before its ACK preserves error, parent and dispatch counting", async (t) => {
  const { repo } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100 });
  const manual = await repo.runNow(automation.automationId, { now: 100 }, scope.workspaceIdentity);
  assert.ok(manual);
  const { run } = manual;
  await repo.fixRunSession({
    runId: run.runId,
    automationId: automation.automationId,
    workspaceKey: scope.workspaceIdentity,
    sessionId: "manual-parent",
  });
  await repo.markRunOutcome(run.runId, "stopped", "interrupted");
  assert.equal(
    await repo.markManualRunDispatched({
      runId: run.runId,
      sessionId: "late-parent",
      dispatchedAt: 200,
    }),
    true,
  );
  assert.equal(
    await repo.markManualRunDispatched({
      runId: run.runId,
      sessionId: "another-parent",
      dispatchedAt: 300,
    }),
    false,
  );
  assert.equal((await repo.getRun(run.runId))?.error, "interrupted");
  assert.equal((await repo.getRun(run.runId))?.outcome, "stopped");
  assert.equal((await repo.getRun(run.runId))?.sessionId, "manual-parent");
  assert.equal((await repo.get(automation.automationId))?.runCount, 1);
});

test("confirmed recipe success clears an earlier uncertain confirmation without changing prompt behavior", async (t) => {
  const { repo } = await fixture(t);
  for (const recipe of [true, false]) {
    const automation = await repo.create(
      {
        ...createParams(),
        ...(recipe ? {} : { recipeSnapshot: undefined, prompt: "Legacy prompt" }),
      },
      { nextRunAt: 100 },
    );
    await repo.claimDue(100);
    const runId = `${automation.automationId}:100`;
    await repo.markRunDispatch({ runId, dispatchStatus: "claimed", error: "ACK unavailable" });
    await repo.markRunOutcome(runId, "running");
    assert.equal((await repo.getRun(runId))?.error, "ACK unavailable");
    await repo.markRunOutcome(runId, "succeeded");
    assert.equal((await repo.getRun(runId))?.error, recipe ? undefined : "ACK unavailable");
  }
});

test("occurrence parent binding is scoped and first wins even when a later dispatch ACK arrives", async (t) => {
  const { repo } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100 });
  await repo.claimDue(100);
  const runId = `${automation.automationId}:100`;
  const owner = {
    runId,
    automationId: automation.automationId,
    workspaceKey: scope.workspaceIdentity,
  };
  for (const altered of [
    { ...owner, workspaceKey: "social-account:b" },
    { ...owner, automationId: "another-automation" },
    { ...owner, runId: "unknown-occurrence" },
  ])
    await assert.rejects(
      repo.fixRunSession({ ...altered, sessionId: "wrong-parent" }),
      /unavailable/i,
    );
  assert.equal((await repo.getRun(runId))?.sessionId, undefined);
  assert.deepEqual(
    await Promise.all([
      repo.fixRunSession({ ...owner, sessionId: "approved-parent" }),
      repo.fixRunSession({ ...owner, sessionId: "racing-parent" }),
    ]),
    ["approved-parent", "approved-parent"],
  );
  await repo.markRunDispatch({
    runId,
    dispatchStatus: "dispatched",
    sessionId: "late-ack-parent",
  });
  assert.equal((await repo.getRun(runId))?.sessionId, "approved-parent");
});

async function makeV3(path: string) {
  const db = new DatabaseSync(path);
  for (const table of ["automations", "automation_runs"]) {
    if (
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === "recipe_snapshot")
    )
      db.exec(`ALTER TABLE ${table} DROP COLUMN recipe_snapshot`);
  }
  db.prepare("DELETE FROM tasks_schema_migration WHERE id='0004_account_recipe_snapshot'").run();
  return db;
}

test("recipe migration upgrades a populated v3 database and preserves frozen checksums and prompt rows", async (t) => {
  const { path, repo, databases } = await fixture(t);
  const prompt = await repo.create(
    {
      ...scope,
      title: "Legacy prompt",
      cronExpr: "0 9 * * *",
      prompt: "Keep this prompt",
      recurring: true,
    },
    { nextRunAt: 100 },
  );
  repo.close();
  const db = await makeV3(path);
  databases.push(db);
  assert.deepEqual(
    db
      .prepare("SELECT checksum FROM tasks_schema_migration ORDER BY id")
      .all()
      .map((row) => row.checksum),
    oldChecksums,
  );
  assert.equal(areTasksDatabaseMigrationsApplied(db), false);
  runTasksDatabaseMigrations(db);
  for (const table of ["automations", "automation_runs"])
    assert.ok(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === "recipe_snapshot"),
    );
  const row = db
    .prepare("SELECT prompt,recipe_snapshot FROM automations WHERE automation_id=?")
    .get(prompt.automationId)!;
  assert.equal(row.prompt, "Keep this prompt");
  assert.equal(row.recipe_snapshot, null);
  assert.equal(areTasksDatabaseMigrationsApplied(db), true);
  runTasksDatabaseMigrations(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks_schema_migration").get()!.count, 4);
});

test("recipe migration failure rolls back columns and the ledger together", async (t) => {
  const { path, repo, databases } = await fixture(t);
  repo.close();
  const db = await makeV3(path);
  databases.push(db);
  assert.throws(
    () =>
      runTasksDatabaseMigrations(db, {
        onProgress: (phase) => {
          if (phase === "committing") throw new Error("fixture commit failure");
        },
      }),
    /fixture commit failure/,
  );
  for (const table of ["automations", "automation_runs"])
    assert.equal(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === "recipe_snapshot"),
      false,
    );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks_schema_migration").get()!.count, 3);
});

test("scheduled claim atomically pins the reviewed source and retries preserve it after edits", async (t) => {
  const { repo } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100 });
  assert.deepEqual(automation.recipeSnapshot, first);
  const claims = await Promise.all([repo.claimDue(100), repo.claimDue(100)]);
  assert.equal(claims.flat().length, 1);
  const runId = `${automation.automationId}:100`;
  assert.deepEqual((await repo.getRun(runId))?.recipeSnapshot, first);
  await repo.update(
    automation.automationId,
    { recipeSnapshot: second },
    undefined,
    scope.workspaceIdentity,
  );
  await repo.upsertRunClaimed({
    runId,
    automationId: automation.automationId,
    workspaceKey: scope.workspaceIdentity,
    scheduledAt: 100,
    trigger: "schedule",
  });
  assert.deepEqual((await repo.getRun(runId))?.recipeSnapshot, first);
  await repo.claimDue(100 + CLAIM_STALE_MS + 1);
  assert.deepEqual((await repo.getRun(runId))?.recipeSnapshot, first);
});

test("manual recovery retains its source and account isolation across schedule replacement", async (t) => {
  const { repo } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100_000_000 });
  assert.equal(await repo.runNow(automation.automationId, { now: 100 }, "social-account:b"), null);
  const manual = await repo.runNow(automation.automationId, { now: 100 }, scope.workspaceIdentity);
  assert.ok(manual);
  assert.deepEqual(manual.run.recipeSnapshot, first);
  await repo.update(
    automation.automationId,
    { recipeSnapshot: second },
    undefined,
    scope.workspaceIdentity,
  );
  const recovered = await repo.claimManualRuns(100 + CLAIM_STALE_MS + 1);
  assert.equal(recovered[0]?.run.runId, manual.run.runId);
  assert.deepEqual(recovered[0]?.run.recipeSnapshot, first);
  assert.deepEqual(await repo.listRuns(automation.automationId, "social-account:b"), []);
});

test("recipe storage rejects non-account, oversized, mixed prompt and invalid snapshots", async (t) => {
  const { repo } = await fixture(t);
  for (const params of [
    { ...createParams(), workspaceIdentity: undefined },
    { ...createParams(), workspaceIdentity: "social-account:../escape" },
    { ...createParams(), prompt: "Do not interpret this as a prompt" },
    { ...createParams(), recipeSnapshot: { ...first, args: { text: "x".repeat(1_048_576) } } },
    { ...createParams(), recipeSnapshot: { ...first, schemaVersion: 2 } },
  ])
    await assert.rejects(repo.create(params, { nextRunAt: 100 }));
  assert.deepEqual(await repo.list(), []);
});

test("explicit replacement changes future occurrences only and survives repository reopen", async (t) => {
  const { repo, path } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100 });
  await repo.claimDue(100);
  await repo.update(
    automation.automationId,
    { recipeSnapshot: second },
    undefined,
    scope.workspaceIdentity,
  );
  await repo.markDispatched(automation.automationId, { dispatchedAt: 110, nextRunAt: 200 });
  await repo.claimDue(200);
  assert.deepEqual((await repo.getRun(`${automation.automationId}:100`))?.recipeSnapshot, first);
  assert.deepEqual((await repo.getRun(`${automation.automationId}:200`))?.recipeSnapshot, second);
  repo.close();
  const reopened = new AutomationRepo(path);
  try {
    assert.deepEqual(
      (await reopened.get(automation.automationId, scope.workspaceIdentity))?.recipeSnapshot,
      second,
    );
    assert.deepEqual(
      (await reopened.getRun(`${automation.automationId}:100`))?.recipeSnapshot,
      first,
    );
    assert.deepEqual(
      (await reopened.getRun(`${automation.automationId}:200`))?.recipeSnapshot,
      second,
    );
  } finally {
    reopened.close();
  }
});

test("first copied NULL remains a prompt occurrence even when its schedule becomes a recipe", async (t) => {
  const { repo } = await fixture(t);
  const automation = await repo.create(
    { ...createParams(), prompt: "Original prompt", recipeSnapshot: undefined },
    { nextRunAt: 100 },
  );
  await repo.claimDue(100);
  await repo.update(
    automation.automationId,
    { prompt: "", recipeSnapshot: first },
    undefined,
    scope.workspaceIdentity,
  );
  await repo.upsertRunClaimed({
    runId: `${automation.automationId}:100`,
    automationId: automation.automationId,
    workspaceKey: scope.workspaceIdentity,
    scheduledAt: 100,
    trigger: "schedule",
  });
  assert.equal((await repo.getRun(`${automation.automationId}:100`))?.recipeSnapshot, undefined);
  await repo.markDispatched(automation.automationId, { dispatchedAt: 110, nextRunAt: 200 });
  await repo.claimDue(200);
  assert.deepEqual((await repo.getRun(`${automation.automationId}:200`))?.recipeSnapshot, first);
});

test("malformed stored snapshots remain explicit errors in lists and copied occurrences", async (t) => {
  const { repo, openDatabase } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: 100 });
  openDatabase()
    .prepare("UPDATE automations SET recipe_snapshot=? WHERE automation_id=?")
    .run("{invalid", automation.automationId);
  assert.equal((await repo.list(scope))[0]?.recipeSnapshotError, "invalid_recipe_snapshot");
  await repo.claimDue(100);
  const run = await repo.getRun(`${automation.automationId}:100`);
  assert.equal(run?.recipeSnapshotError, "invalid_recipe_snapshot");
  assert.equal(run?.recipeSnapshot, undefined);
  await assert.rejects(
    repo.update(
      automation.automationId,
      { prompt: "Silent fallback" },
      undefined,
      scope.workspaceIdentity,
    ),
  );
  await repo.update(
    automation.automationId,
    { title: "Still visible" },
    undefined,
    scope.workspaceIdentity,
  );
  assert.equal(
    (await repo.get(automation.automationId, scope.workspaceIdentity))?.recipeSnapshotError,
    "invalid_recipe_snapshot",
  );
});

test("retry-only claims copy to the scheduler's stable retry timestamp", async (t) => {
  const { repo, openDatabase } = await fixture(t);
  const automation = await repo.create(createParams(), { nextRunAt: null });
  openDatabase()
    .prepare("UPDATE automations SET retry_at=100 WHERE automation_id=?")
    .run(automation.automationId);
  await repo.claimDue(150);
  assert.deepEqual((await repo.getRun(`${automation.automationId}:100`))?.recipeSnapshot, first);
  assert.equal(await repo.getRun(`${automation.automationId}:150`), null);
});
