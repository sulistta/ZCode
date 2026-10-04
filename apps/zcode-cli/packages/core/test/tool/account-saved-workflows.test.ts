import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  findSavedWorkflowShadowing,
  listSavedWorkflows,
  moveSavedWorkflow,
  resolveSavedWorkflow,
  saveSavedWorkflow,
  savedWorkflowRoot,
  savedWorkflowRoots,
  updateSavedWorkflowMeta,
  deleteSavedWorkflow,
} from "../../src/tool/handlers/saved-workflows/store.js";

const identityA = "social-account:11111111-1111-4111-8111-111111111111";
const identityB = "social-account:22222222-2222-4222-8222-222222222222";

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "social-recipe-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwdA = join(root, "a");
  const cwdB = join(root, "b");
  await Promise.all([mkdir(cwdA), mkdir(cwdB)]);
  return {
    root,
    a: { cwd: cwdA, homeDir: root, dataBaseDir: root, workspaceIdentity: identityA },
    b: { cwd: cwdB, homeDir: root, dataBaseDir: root, workspaceIdentity: identityB },
  };
}

test("account definitions persist independently and never discover global recipes", async (t) => {
  const { root, a, b } = await fixture(t);
  await saveSavedWorkflow({
    cwd: root,
    homeDir: root,
    dataBaseDir: root,
    name: "global-only",
    scope: "global",
    meta: { description: "global" },
    script: "global source",
  });
  await saveSavedWorkflow({ ...a, name: "daily", meta: { description: "A" }, script: "A source" });
  await saveSavedWorkflow({ ...b, name: "daily", meta: { description: "B" }, script: "B source" });
  assert.deepEqual(
    (await listSavedWorkflows(a)).entries.map((entry) => entry.name),
    ["daily"],
  );
  const reopened = await resolveSavedWorkflow({ ...a, name: "daily" });
  assert.ok(reopened.ok);
  assert.equal(reopened.script, "A source");
  const other = await resolveSavedWorkflow({ ...b, name: "daily" });
  assert.ok(other.ok);
  assert.equal(other.script, "B source");
  assert.equal((await resolveSavedWorkflow({ ...a, name: "global-only" })).ok, false);
  assert.equal(
    await findSavedWorkflowShadowing({ ...a, name: "daily", scope: "project" }),
    undefined,
  );
  assert.deepEqual(
    savedWorkflowRoots(a.cwd, a).map((item) => item.scope),
    ["project"],
  );
});

test("explicit global operations and malformed account identities reject before creating files", async (t) => {
  const { a } = await fixture(t);
  await assert.rejects(
    async () => listSavedWorkflows({ ...a, scope: "global" }),
    /account.*scope/i,
  );
  await assert.rejects(
    async () => resolveSavedWorkflow({ ...a, name: "daily", scope: "global" }),
    /account.*scope/i,
  );
  await assert.rejects(
    async () =>
      saveSavedWorkflow({
        ...a,
        name: "daily",
        scope: "global",
        meta: { description: "bad" },
        script: "bad",
      }),
    /account.*scope/i,
  );
  await assert.rejects(async () => moveSavedWorkflow({ ...a, name: "daily" }), /account.*scope/i);
  await assert.rejects(
    async () => listSavedWorkflows({ ...a, workspaceIdentity: "social-account:../invalid" }),
    /identity/i,
  );
});

test("write-side name and metadata validation cannot overwrite an outside file", async (t) => {
  const { root, a } = await fixture(t);
  const outside = join(root, "outside.dwf.ts");
  await writeFile(outside, "unchanged");
  await assert.rejects(
    async () =>
      saveSavedWorkflow({
        ...a,
        name: "../../../outside",
        meta: { description: "bad" },
        script: "bad",
      }),
    /name/i,
  );
  await assert.rejects(async () =>
    saveSavedWorkflow({ ...a, name: "bad-meta", meta: { description: "" }, script: "bad" }),
  );
  assert.equal(await readFile(outside, "utf8"), "unchanged");
  assert.deepEqual((await listSavedWorkflows(a)).entries, []);
});

test("symlinked account recipe directories never read or overwrite another root", async (t) => {
  const { a, b } = await fixture(t);
  const written = await saveSavedWorkflow({
    ...b,
    name: "daily",
    meta: { description: "B" },
    script: "B source",
  });
  await mkdir(join(a.cwd, ".zcode"));
  await symlink(
    savedWorkflowRoot(b.cwd, "project", b).dir,
    savedWorkflowRoot(a.cwd, "project", a).dir,
    "dir",
  );
  const before = await readFile(written.path, "utf8");
  const found = await resolveSavedWorkflow({ ...a, name: "daily" });
  assert.equal(found.ok, false);
  assert.deepEqual((await listSavedWorkflows(a)).entries, []);
  await assert.rejects(
    async () =>
      saveSavedWorkflow({ ...a, name: "daily", meta: { description: "A" }, script: "A source" }),
    /symbolic|private/i,
  );
  assert.equal(await readFile(written.path, "utf8"), before);
});

test("symlinked definitions are listed as invalid and never followed", async (t) => {
  const { a, b } = await fixture(t);
  const written = await saveSavedWorkflow({
    ...b,
    name: "daily",
    meta: { description: "B" },
    script: "B source",
  });
  const target = savedWorkflowRoot(a.cwd, "project", a).dir;
  await mkdir(target, { recursive: true });
  await symlink(written.path, join(target, "daily.dwf.ts"));
  assert.equal((await resolveSavedWorkflow({ ...a, name: "daily" })).ok, false);
  const listed = await listSavedWorkflows(a);
  assert.deepEqual(listed.entries, []);
  assert.equal(listed.invalid.length, 1);
  await assert.rejects(
    async () =>
      saveSavedWorkflow({ ...a, name: "daily", meta: { description: "A" }, script: "A source" }),
    /symbolic|private/i,
  );
});

test("an oversized recipe explicitly rejects without replacing its previous source", async (t) => {
  const { a } = await fixture(t);
  const written = await saveSavedWorkflow({
    ...a,
    name: "daily",
    meta: { description: "A" },
    script: "approved source",
  });
  const before = await readFile(written.path, "utf8");
  await assert.rejects(
    async () =>
      saveSavedWorkflow({
        ...a,
        name: "daily",
        meta: { description: "huge" },
        script: "a".repeat(1024 * 1024),
      }),
    /1 MiB|too large/i,
  );
  assert.equal(await readFile(written.path, "utf8"), before);
});

test("concurrent writes leave one complete parseable definition with no partial source", async (t) => {
  const { a } = await fixture(t);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      saveSavedWorkflow({
        ...a,
        name: "daily",
        meta: { description: `version ${index}` },
        script: `source ${index}`,
      }),
    ),
  );
  const found = await resolveSavedWorkflow({ ...a, name: "daily" });
  assert.ok(found.ok);
  assert.equal(found.meta.description.replace("version", "source"), found.script);
  assert.equal((await listSavedWorkflows(a)).invalid.length, 0);
});

test("ordinary workspaces retain project-first lookup and global shadowing", async (t) => {
  const { root, a } = await fixture(t);
  const generic = { cwd: a.cwd, homeDir: root, dataBaseDir: root };
  await saveSavedWorkflow({
    ...generic,
    name: "daily",
    scope: "global",
    meta: { description: "global" },
    script: "global",
  });
  await saveSavedWorkflow({
    ...generic,
    name: "daily",
    scope: "project",
    meta: { description: "project" },
    script: "project",
  });
  const found = await resolveSavedWorkflow({ ...generic, name: "daily" });
  assert.ok(found.ok);
  assert.equal(found.script, "project");
  assert.equal(
    await findSavedWorkflowShadowing({ ...generic, name: "daily", scope: "project" }),
    "hides_global",
  );
});

test("metadata edits serialize through the same owner and deletion never follows a symlink", async (t) => {
  const { a, b } = await fixture(t);
  const initial = await saveSavedWorkflow({
    ...a,
    name: "daily",
    meta: { description: "A" },
    script: "immutable body",
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      updateSavedWorkflowMeta({ ...a, name: "daily", meta: { description: `edit ${index}` } }),
    ),
  );
  assert.ok(results.every((result) => result.ok));
  const reopened = await resolveSavedWorkflow({ ...a, name: "daily" });
  assert.ok(reopened.ok);
  assert.equal(reopened.script, "immutable body");
  const other = await saveSavedWorkflow({
    ...b,
    name: "other",
    meta: { description: "B" },
    script: "other body",
  });
  await rm(initial.path);
  await symlink(other.path, initial.path);
  const rejected = await deleteSavedWorkflow({ ...a, name: "daily" });
  assert.equal(rejected.ok, false);
  assert.ok((await resolveSavedWorkflow({ ...b, name: "other" })).ok);
  await rm(initial.path);
  await saveSavedWorkflow({ ...a, name: "daily", meta: { description: "A" }, script: "new body" });
  assert.ok((await deleteSavedWorkflow({ ...a, name: "daily" })).ok);
  assert.equal((await resolveSavedWorkflow({ ...a, name: "daily" })).ok, false);
});
