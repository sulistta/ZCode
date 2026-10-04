import assert from "node:assert/strict";
import test from "node:test";
import type { SocialProjectAgentScope, SocialProjectSummary } from "@social-harness/shared";
import { zcodeProtocolMethods } from "@social-harness/shared";
import { executeSocialProjectAgentRequest } from "../src/zcode-agent/socialProjectToolRequests.js";

const summary: SocialProjectSummary = {
  projectId: "project-1",
  accountId: "account-1",
  displayName: "Podcast",
  revision: 2,
  updatedAt: 20,
  trackCount: 2,
};

function createScope(): SocialProjectAgentScope {
  return {
    list: async () => [summary],
    get: async (projectId) => (projectId === summary.projectId ? null : null),
    executeCommand: async (request) => {
      throw new Error(`unexpected command ${request.commandId}`);
    },
  };
}

test("Agent project requests resolve only from the Host-bound workspace identity", async () => {
  const scope = createScope();
  let resolvedIdentity = "";
  const result = await executeSocialProjectAgentRequest({
    method: zcodeProtocolMethods.socialProjectList,
    params: {},
    workspaceIdentity: "social-account:account-1",
    resolveScope: async (identity) => {
      resolvedIdentity = identity;
      return scope;
    },
  });

  assert.equal(resolvedIdentity, "social-account:account-1");
  assert.deepEqual(result, { kind: "result", result: { projects: [summary] } });
});

test("Agent project protocol rejects account IDs supplied in tool parameters", async () => {
  let scopeResolutionCount = 0;
  const result = await executeSocialProjectAgentRequest({
    method: zcodeProtocolMethods.socialProjectCommand,
    params: {
      accountId: "account-2",
      projectId: "project-1",
      commandId: "agent-command",
      expectedRevision: 2,
      operation: { type: "rename-project", displayName: "Changed" },
    },
    workspaceIdentity: "social-account:account-1",
    resolveScope: async () => {
      scopeResolutionCount += 1;
      return createScope();
    },
  });

  assert.equal(scopeResolutionCount, 1);
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.code, -32602);
});

test("Agent project protocol fails closed without an account-scoped workspace", async () => {
  let called = false;
  const result = await executeSocialProjectAgentRequest({
    method: zcodeProtocolMethods.socialProjectList,
    params: {},
    workspaceIdentity: "ordinary-workspace",
    resolveScope: async () => {
      called = true;
      return createScope();
    },
  });

  assert.equal(called, false);
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.code, -32120);
});
