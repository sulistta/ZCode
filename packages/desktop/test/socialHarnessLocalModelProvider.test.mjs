import assert from "node:assert/strict";
import { test } from "node:test";
import { startLocalOpenAiMock } from "./socialHarnessLocalModelProviderE2E.mjs";

test("quoted scenario markers in text-only compact requests do not plan execution tools", async (t) => {
  const marker = "SOCIAL_HARNESS_CANDIDATE_HANDOFF_ISOLATED";
  const provider = await startLocalOpenAiMock({ candidateHandoffs: [{ marker }] });
  t.after(() => provider.close());
  const tool = { type: "function", function: { name: "SocialAgentGetContext", parameters: {} } };
  const send = async (content) => {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-chat",
        messages: [{ role: "user", content }],
        tools: [tool],
        tool_choice: "auto",
        stream: false,
      }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const summary = await send(
    `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\n\nQuoted conversation: ${marker}`,
  );
  assert.equal(summary.choices[0].finish_reason, "stop");
  assert.equal(summary.choices[0].message.tool_calls, undefined);
  assert.match(summary.choices[0].message.content, /<summary>/u);
  assert.deepEqual(provider.candidateHandoffToolCalls, []);
  const ordinary = await send(`${marker}: place a measured candidate into an owned project.`);
  assert.equal(ordinary.choices[0].message.tool_calls[0].function.name, "SocialAgentGetContext");
  assert.equal(provider.candidateHandoffToolCalls.length, 1);
});
