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
import { registerBuiltInTools } from "../../../src/tool/handlers/index.js";

const accountToolNames = [
  SOCIAL_PROJECT_LIST_TOOL_NAME,
  SOCIAL_PROJECT_READ_TOOL_NAME,
  SOCIAL_PROJECT_COMMAND_TOOL_NAME,
  SOCIAL_AGENT_CONTEXT_TOOL_NAME,
  SOCIAL_MEDIA_LIST_TOOL_NAME,
  SOCIAL_YOUTUBE_SEARCH_TOOL_NAME,
  SOCIAL_CLIP_CANDIDATES_TOOL_NAME,
  SOCIAL_PUBLICATION_REQUEST_TOOL_NAME,
];

function registerAccountTools(includeSocialAgent: boolean): string[] {
  const names: string[] = [];
  registerBuiltInTools(
    {
      register(entry) {
        names.push(entry.metadata.name);
      },
    },
    {
      allowedTools: accountToolNames,
      includeSocialProject: true,
      includeSocialAgent,
    },
  );
  return names;
}

function readSocialAgentToolDescriptions(): Map<string, string> {
  const descriptions = new Map<string, string>();
  registerBuiltInTools(
    {
      register(entry) {
        if (accountToolNames.includes(entry.metadata.name)) {
          descriptions.set(entry.metadata.name, entry.metadata.description);
        }
      },
    },
    {
      allowedTools: accountToolNames,
      includeSocialProject: true,
      includeSocialAgent: true,
    },
  );
  return descriptions;
}

test("account context and media tools require the social Agent registration gate", () => {
  const projectsOnly = registerAccountTools(false);
  assert.deepEqual(projectsOnly, [
    SOCIAL_PROJECT_LIST_TOOL_NAME,
    SOCIAL_PROJECT_READ_TOOL_NAME,
    SOCIAL_PROJECT_COMMAND_TOOL_NAME,
  ]);

  const withSocialAgent = registerAccountTools(true);
  assert.deepEqual(withSocialAgent, accountToolNames);
});

test("candidate tool guidance grounds editorial ranking in account context and measured evidence", () => {
  const descriptions = readSocialAgentToolDescriptions();
  const contextDescription = descriptions.get(SOCIAL_AGENT_CONTEXT_TOOL_NAME);
  const candidateDescription = descriptions.get(SOCIAL_CLIP_CANDIDATES_TOOL_NAME);

  assert.ok(contextDescription);
  assert.match(contextDescription, /editable memory/u);
  assert.match(contextDescription, /explicit user corrections/u);
  assert.match(contextDescription, /unavailable publication history as unknown/u);

  assert.ok(candidateDescription);
  assert.match(candidateDescription, /Read SocialAgentGetContext first/u);
  assert.match(candidateDescription, /explicit user corrections/u);
  assert.match(candidateDescription, /explain when they affect editorial fit/u);
  assert.match(candidateDescription, /publication outcomes/u);
  assert.match(candidateDescription, /complete phrases, context, and pauses/u);
  assert.match(candidateDescription, /audio structure\/rhythm and sparse visual evidence/u);
  assert.match(candidateDescription, /Separate measured facts from editorial-fit judgments/u);
  assert.match(candidateDescription, /Never invent transcripts, heatmaps, signals, or publication outcomes/u);
});
