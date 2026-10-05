import assert from "node:assert/strict";
import { test } from "node:test";
import { startLocalOpenAiMock } from "./socialHarnessLocalModelProviderE2E.mjs";
import { collectToolResults, serializeFixtureContext } from "./socialHarnessToolResultsE2E.mjs";

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

test("text-only compact instructions appended to provider history do not repeat execution tools", async (t) => {
  const marker = "SOCIAL_HARNESS_CANDIDATE_HANDOFF_HISTORY";
  const provider = await startLocalOpenAiMock({ candidateHandoffs: [{ marker }] });
  t.after(() => provider.close());
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mock-chat",
      messages: [
        { role: "system", content: "Isolated account fixture" },
        { role: "user", content: `${marker}: prepare a measured candidate.` },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "owned-context",
              type: "function",
              function: { name: "SocialAgentGetContext", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "owned-context", content: "{}" },
        {
          role: "user",
          content:
            "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\nSummarize the preceding context.",
        },
      ],
      tools: [{ type: "function", function: { name: "SocialMediaList", parameters: {} } }],
      stream: false,
    }),
  });
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.choices[0].finish_reason, "stop");
  assert.equal(summary.choices[0].message.tool_calls, undefined);
  assert.match(summary.choices[0].message.content, /<summary>/u);
  assert.deepEqual(provider.candidateHandoffToolCalls, []);
});

test("compact continuation retains the current request and completed read facts", async (t) => {
  const marker = "SOCIAL_HARNESS_CANDIDATE_COMPACT_CONTINUATION";
  const provider = await startLocalOpenAiMock({
    candidateHandoffs: [{ marker, mediaName: "owned.mp4", mode: "music" }],
  });
  t.after(() => provider.close());
  const send = async (messages) => {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-chat",
        messages,
        stream: false,
        tools: ["SocialAgentGetContext", "SocialMediaList", "SocialClipCandidates"].map((name) => ({
          type: "function",
          function: { name, parameters: {} },
        })),
      }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).choices[0].message;
  };
  const summary = await send([
    { role: "user", content: `${marker}: analyze owned.mp4 in music mode.` },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "context-before-compact",
          type: "function",
          function: { name: "SocialAgentGetContext", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "context-before-compact",
      content: JSON.stringify({ account: { accountId: "owned" } }),
    },
    {
      role: "user",
      content:
        "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\nSummarize current progress.",
    },
  ]);
  const continued = await send([
    { role: "user", content: summary.content },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "pending-media",
          type: "function",
          function: { name: "SocialMediaList", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "pending-media",
      content: JSON.stringify({ assets: [{ mediaId: "owned-media", originalName: "owned.mp4" }] }),
    },
  ]);
  assert.equal(continued.tool_calls?.[0]?.function.name, "SocialClipCandidates");
  assert.deepEqual(JSON.parse(continued.tool_calls[0].function.arguments), {
    mediaId: "owned-media",
    mode: "music",
  });
  assert.deepEqual(
    provider.candidateHandoffToolCalls.map((call) => call.name),
    ["SocialClipCandidates"],
  );
});

test("production continuation after compact retains account reads and the admitted import", async (t) => {
  const marker = "PRODUCTION_COMPACT_CONTINUATION";
  const provider = await startLocalOpenAiMock({ production: { marker } });
  t.after(() => provider.close());
  const send = async (messages) => {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-chat",
        messages,
        stream: false,
        tools: ["SocialAgentGetContext", "SocialMediaList", "SocialMediaJobs"].map((name) => ({
          type: "function",
          function: { name, parameters: {} },
        })),
      }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).choices[0].message;
  };
  const history = [
    { role: "user", content: `${marker}: prepare the source Reel.` },
    {
      role: "tool",
      name: "SocialAgentGetContext",
      content: JSON.stringify({ context: { projects: [] } }),
    },
    { role: "tool", name: "SocialMediaList", content: JSON.stringify({ assets: [] }) },
  ];
  const summary = await send([
    ...history,
    {
      role: "user",
      content:
        "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\nSummarize current progress.",
    },
  ]);
  const continuation = await send([
    { role: "user", content: summary.content },
    {
      role: "tool",
      name: "SocialMediaImportUrl",
      content: JSON.stringify({ job: { jobId: "owned-job" } }),
    },
  ]);
  assert.equal(continuation.tool_calls?.[0]?.function.name, "SocialMediaJobs");
  assert.deepEqual(JSON.parse(continuation.tool_calls[0].function.arguments), {
    jobId: "owned-job",
  });
});

test("fixture summaries retain latest job state in chronological order and reject oversized payloads", () => {
  const summary = serializeFixtureContext("owned request", [
    { name: "SocialAgentGetContext", content: { accountId: "owned" } },
    { name: "SocialMediaJobs", content: { state: "failed" } },
    { name: "SocialMediaJobCommand", content: { action: "retry" } },
    { name: "SocialMediaJobs", content: { state: "downloading" } },
    { name: "SocialMediaJobs", content: { state: "completed", mediaId: "owned-media" } },
  ]);
  assert.deepEqual(collectToolResults([{ role: "user", content: summary }]), [
    { name: "SocialAgentGetContext", content: { accountId: "owned" } },
    { name: "SocialMediaJobCommand", content: { action: "retry" } },
    { name: "SocialMediaJobs", content: { state: "completed", mediaId: "owned-media" } },
  ]);
  assert.throws(() => serializeFixtureContext("x".repeat(256_001), []), /exceeds its bound/u);
});
