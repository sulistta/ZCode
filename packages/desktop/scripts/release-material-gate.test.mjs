import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { enforceProductionReleaseMaterialGate } from "./release-material-gate.mjs";

test("preview packaging skips release-only source material review", async () => {
  await assert.doesNotReject(
    enforceProductionReleaseMaterialGate("preview", "/path/that/does/not/exist"),
  );
});

test("unknown product flavors fail closed", async () => {
  await assert.rejects(
    enforceProductionReleaseMaterialGate("unknown", "/path/that/does/not/exist"),
    /Unsupported desktop product flavor for release materials gate: unknown/u,
  );
});

test("production packaging rejects unresolved third-party source materials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "social-harness-release-material-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const notices = Buffer.from("# Fixture third-party notices\n");
  await writeFile(join(root, "THIRD-PARTY-NOTICES.md"), notices);
  await mkdir(join(root, "third-party"));
  await writeFile(
    join(root, "third-party", "inventory.json"),
    JSON.stringify({
      schemaVersion: 1,
      noticesSha256: createHash("sha256").update(notices).digest("hex"),
      inputs: {},
      reviewRequired: [{ id: "fixture-GPL-source", reason: "source offer is missing" }],
    }),
  );

  await assert.rejects(
    enforceProductionReleaseMaterialGate("production", root),
    /Unresolved third-party material obligations:[\s\S]*fixture-GPL-source: source offer is missing/u,
  );
});

test("production packaging proceeds when the verified inventory is complete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "social-harness-release-material-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const notices = Buffer.from("# Fixture third-party notices\n");
  await writeFile(join(root, "THIRD-PARTY-NOTICES.md"), notices);
  await mkdir(join(root, "third-party"));
  await writeFile(
    join(root, "third-party", "inventory.json"),
    JSON.stringify({
      schemaVersion: 1,
      noticesSha256: createHash("sha256").update(notices).digest("hex"),
      inputs: {},
      reviewRequired: [],
    }),
  );

  await assert.doesNotReject(enforceProductionReleaseMaterialGate("production", root));
});
