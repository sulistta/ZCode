import assert from "node:assert/strict";
import { test } from "node:test";
import { createSocialAccountWorkspaceIdentity } from "@social-harness/shared";
import { resolveWorkspaceRefFromId } from "../src/zcode-protocol/workspace.js";

test("V4 account workspace keys keep identity separate from their physical path", () => {
  const workspaceIdentity = createSocialAccountWorkspaceIdentity("account-1");
  const workspacePath = "/tmp/social harness/accounts/account-1";

  assert.deepEqual(resolveWorkspaceRefFromId(workspaceIdentity, workspacePath), {
    workspaceIdentity,
    workspaceKey: workspaceIdentity,
    workspacePath,
  });
});

test("V4 rejects malformed account identities instead of treating them as local paths", () => {
  assert.throws(
    () => resolveWorkspaceRefFromId("social-account:invalid/id", "/tmp/account"),
    /Invalid social account workspace identity/u,
  );
});

test("V4 requires a Host-resolved path for account-scoped session creation", () => {
  assert.throws(
    () => resolveWorkspaceRefFromId("social-account:account-1"),
    /requires a physical workspace path/u,
  );
});

test("V4 local workspace paths retain the legacy fallback", () => {
  assert.deepEqual(resolveWorkspaceRefFromId("/tmp/project"), {
    workspaceIdentity: undefined,
    workspaceKey: "/tmp/project",
    workspacePath: "/tmp/project",
  });
});
