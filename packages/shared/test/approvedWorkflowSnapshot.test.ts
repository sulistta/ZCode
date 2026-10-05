import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedWorkflowSnapshotSchema } from "../src/approved-workflow-snapshot.js";

const reviewed = {
  schemaVersion: 1,
  name: "daily",
  meta: { description: "Reviewed" },
  script: "return 1;",
  args: {},
};

test("approved snapshots reject alternate versions, fields and non-JSON arguments/defaults", () => {
  assert.equal(approvedWorkflowSnapshotSchema.safeParse(reviewed).success, true);
  for (const input of [
    { ...reviewed, schemaVersion: 2 },
    { ...reviewed, workspaceIdentity: "social-account:other" },
    { ...reviewed, args: { amount: Infinity } },
    {
      ...reviewed,
      meta: { description: "Reviewed", args: { amount: { type: "json", default: 1n } } },
    },
  ])
    assert.equal(approvedWorkflowSnapshotSchema.safeParse(input).success, false);
});

test("complete snapshots and source are bounded by UTF-8 bytes", () => {
  assert.equal(
    approvedWorkflowSnapshotSchema.safeParse({ ...reviewed, script: "é".repeat(600_000) }).success,
    false,
  );
  assert.equal(
    approvedWorkflowSnapshotSchema.safeParse({ ...reviewed, args: { text: "x".repeat(1_048_576) } })
      .success,
    false,
  );
});
