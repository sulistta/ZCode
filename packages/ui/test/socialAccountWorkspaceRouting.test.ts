import assert from "node:assert/strict";
import test from "node:test";
import { createSocialAccountWorkspaceIdentity } from "@social-harness/shared";
import type { IServiceAccessor } from "@social-harness/services";
import { shouldEnableWorkspaceRpc } from "../src/lib/workspaceRpcAvailability.js";
import {
  isRemoteWorkspaceTarget,
  resolveWorkspaceRemoteSessionId,
  resolveWorkspaceServices,
} from "../src/lib/workspaceServiceResolver.js";

test("a Social Harness account identity routes to the local Host without remote attachment", () => {
  const workspacePath = "/tmp/social-harness/social-accounts/workspaces/account-1";
  const workspaceIdentity = createSocialAccountWorkspaceIdentity("account-1");
  const baseServices = {} as IServiceAccessor;
  const resolverState = {
    sessionsById: {},
    sessionIdByWorkspaceIdentity: {},
    sessionIdByWorkspacePath: {},
  };
  const target = { workspacePath, workspaceIdentity };

  assert.equal(isRemoteWorkspaceTarget(target), false);
  assert.equal(resolveWorkspaceRemoteSessionId(target, resolverState), undefined);
  assert.deepEqual(resolveWorkspaceServices(target, baseServices, resolverState), {
    services: baseServices,
    isRemoteWorkspace: false,
  });
  assert.equal(shouldEnableWorkspaceRpc(target), true);
});

test("an invalid social identity remains fail-closed as a remote-looking target", () => {
  const target = {
    workspacePath: "/tmp/social-harness/social-accounts/workspaces/account-1",
    workspaceIdentity: "social-account:../other",
  };

  assert.equal(isRemoteWorkspaceTarget(target), true);
  assert.equal(shouldEnableWorkspaceRpc(target), false);
});
