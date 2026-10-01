import assert from "node:assert/strict";
import test from "node:test";
import {
  SOCIAL_AGENT_CONTEXT_TOOL_NAME,
  SOCIAL_CLIP_CANDIDATES_TOOL_NAME,
  SOCIAL_MEDIA_LIST_TOOL_NAME,
  SOCIAL_PROJECT_COMMAND_TOOL_NAME,
  SOCIAL_PROJECT_LIST_TOOL_NAME,
  SOCIAL_PROJECT_READ_TOOL_NAME,
  SOCIAL_YOUTUBE_SEARCH_TOOL_NAME,
  SOCIAL_PUBLICATION_REQUEST_TOOL_NAME,
} from "@social-harness/contracts";
import type { AgentRuntimeConfig } from "../../../src/runtime/types.js";
import {
  isSocialAccountRuntime,
  resolveBuiltInToolAllowlist,
} from "../../../src/runtime/helpers/tool-allowlist.js";

function runtimeConfig(input: Partial<AgentRuntimeConfig>): AgentRuntimeConfig {
  return input as AgentRuntimeConfig;
}

test("social account runtimes expose only account-scoped social tools", () => {
  const config = runtimeConfig({ workspaceIdentity: "social-account:account-1" as never });

  assert.equal(isSocialAccountRuntime(config), true);
  assert.deepEqual(resolveBuiltInToolAllowlist(config), [
    SOCIAL_PROJECT_LIST_TOOL_NAME,
    SOCIAL_PROJECT_READ_TOOL_NAME,
    SOCIAL_PROJECT_COMMAND_TOOL_NAME,
    SOCIAL_AGENT_CONTEXT_TOOL_NAME,
    SOCIAL_MEDIA_LIST_TOOL_NAME,
    SOCIAL_YOUTUBE_SEARCH_TOOL_NAME,
    SOCIAL_CLIP_CANDIDATES_TOOL_NAME,
    SOCIAL_PUBLICATION_REQUEST_TOOL_NAME,
  ]);
});

test("social account runtime respects a narrower configured tool allowlist", () => {
  const config = runtimeConfig({
    toolAllowlist: ["Bash", SOCIAL_PROJECT_READ_TOOL_NAME],
    workspaceIdentity: "social-account:account-1" as never,
  });

  assert.deepEqual(resolveBuiltInToolAllowlist(config), [SOCIAL_PROJECT_READ_TOOL_NAME]);
});

test("ordinary workspaces retain their existing unrestricted default", () => {
  const config = runtimeConfig({ workspaceIdentity: "ordinary-workspace" as never });

  assert.equal(isSocialAccountRuntime(config), false);
  assert.equal(resolveBuiltInToolAllowlist(config), undefined);
});

test("malformed social account identity keeps the generic tool surface closed", () => {
  const config = runtimeConfig({ workspaceIdentity: "social-account:../escape" as never });

  assert.equal(isSocialAccountRuntime(config), true);
  assert.deepEqual(resolveBuiltInToolAllowlist(config), [
    SOCIAL_PROJECT_LIST_TOOL_NAME,
    SOCIAL_PROJECT_READ_TOOL_NAME,
    SOCIAL_PROJECT_COMMAND_TOOL_NAME,
    SOCIAL_AGENT_CONTEXT_TOOL_NAME,
    SOCIAL_MEDIA_LIST_TOOL_NAME,
    SOCIAL_YOUTUBE_SEARCH_TOOL_NAME,
    SOCIAL_CLIP_CANDIDATES_TOOL_NAME,
    SOCIAL_PUBLICATION_REQUEST_TOOL_NAME,
  ]);
});
