import assert from "node:assert/strict";
import test from "node:test";
import type { ContextSourceSnapshot } from "@social-harness/contracts";
import { createContextBuilderFromSnapshot } from "../../src/runtime/methods/context.js";

const snapshot: ContextSourceSnapshot = {
  workingDirectory: "/workspace",
  envInfo: {
    cwd: "/workspace",
    platform: "linux",
    shell: "bash",
    osVersion: "test",
    nodeVersion: "24",
  },
  diagnostics: [],
};

function buildContext(workspaceIdentity?: string, systemPrompt?: string) {
  const runtime = {
    config: {
      workingDirectory: snapshot.workingDirectory,
      workspaceIdentity,
      systemPrompt,
    },
    getTools: () => [],
    registry: {},
    skillLoadOutcome: undefined,
  };

  return createContextBuilderFromSnapshot
    .call(runtime as never, snapshot, undefined, { persistEnvInfo: false })
    .build();
}

test("social account sessions receive stable editorial guidance from their workspace identity", () => {
  const context = buildContext("social-account:account-1");
  const guidance = context.sections.find((section) => section.source === "social_account_guidance");
  const systemContent = context.systemMessages.map((message) => message.content).join("\n");

  assert.ok(guidance);
  assert.equal(guidance.cacheHint, "stable");
  assert.match(guidance.content, /SocialAgentGetContext/u);
  assert.match(guidance.content, /measurements.*editorial-fit judgments/u);
  assert.match(guidance.content, /unavailable inputs as unknown/u);
  assert.doesNotMatch(guidance.content, /account-1/u);
  assert.match(systemContent, /You are the Social Agent in Social Harness/u);
  assert.doesNotMatch(systemContent, /You are ZCode, an interactive coding agent/u);
  assert.doesNotMatch(
    systemContent,
    /You are an interactive ZCode agent that helps users with software engineering tasks/u,
  );
  assert.doesNotMatch(
    systemContent,
    /Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal\./u,
  );
});

test("social account guidance remains present alongside a custom system prompt", () => {
  const context = buildContext("social-account:account-1", "Follow this custom persona.");
  const systemContent = context.systemMessages.map((message) => message.content).join("\n");

  assert.match(systemContent, /Follow this custom persona\./u);
  assert.match(systemContent, /You are the Social Agent in Social Harness/u);
  assert.match(systemContent, /Social Harness Account Guidance/u);
  assert.match(systemContent, /SocialAgentGetContext/u);
  assert.doesNotMatch(systemContent, /You are ZCode, an interactive coding agent/u);
});

test("ordinary workspace sessions do not receive Social Harness account guidance", () => {
  const context = buildContext("local:workspace-1");
  const systemContent = context.systemMessages.map((message) => message.content).join("\n");

  assert.equal(
    context.sections.some((section) => section.source === "social_account_guidance"),
    false,
  );
  assert.match(
    systemContent,
    /You are an interactive ZCode agent that helps users with software engineering tasks/u,
  );
});
