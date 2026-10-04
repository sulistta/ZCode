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
  CREATE_WORKFLOW_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  LIST_SAVED_WORKFLOWS_TOOL_NAME,
  LIST_WORKFLOW_RUNS_TOOL_NAME,
  GET_WORKFLOW_RUN_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
} from "@social-harness/contracts";
import type { AgentRuntimeConfig } from "../../../src/runtime/types.js";
import {
  isSocialAccountRuntime,
  resolveBuiltInToolAllowlist,
} from "../../../src/runtime/helpers/tool-allowlist.js";

function runtimeConfig(input: Partial<AgentRuntimeConfig>): AgentRuntimeConfig {
  return input as AgentRuntimeConfig;
}

test("social account parent exposes social tools and the bounded recipe surface", () => {
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
    "SocialMediaImportUrl",
    "SocialMediaJobs",
    "SocialMediaJobCommand",
    "SocialProjectCreate",
    "SocialProjectExport",
    "SocialProjectExports",
    LIST_SAVED_WORKFLOWS_TOOL_NAME,
    SAVE_WORKFLOW_TOOL_NAME,
    CREATE_WORKFLOW_TOOL_NAME,
    LIST_WORKFLOW_RUNS_TOOL_NAME,
    GET_WORKFLOW_RUN_TOOL_NAME,
    RESUME_WORKFLOW_RUN_TOOL_NAME,
    RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
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

test("account workflow actors keep safe engine control with a narrow tool request", () => {
  const config = runtimeConfig({
    workspaceIdentity: "social-account:account-1" as never,
    taskType: "workflow_child",
    toolAllowlist: ["Bash", SOCIAL_PROJECT_READ_TOOL_NAME],
  });
  assert.deepEqual(resolveBuiltInToolAllowlist(config), [
    SOCIAL_PROJECT_READ_TOOL_NAME,
    "submit_result",
    "escalate",
  ]);
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
    "SocialMediaImportUrl",
    "SocialMediaJobs",
    "SocialMediaJobCommand",
    "SocialProjectCreate",
    "SocialProjectExport",
    "SocialProjectExports",
  ]);
});
