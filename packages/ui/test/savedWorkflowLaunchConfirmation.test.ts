import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CommandAck,
  CommandEnvelope,
  V4ConversationWorkflowRunsResult,
} from "@social-harness/shared/zcode-protocol-v4";
import { confirmSavedWorkflowLaunch } from "../src/hooks/savedWorkflowLaunchConfirmation.js";

const envelope = { commandId: "same-command", sessionId: "owned-parent" } as CommandEnvelope;
const accepted: CommandAck = {
  commandId: envelope.commandId,
  status: "accepted",
  revisionAtDecision: 0,
  result: { type: "startSavedWorkflow", runId: "actual-engine", toolCallId: "launch-same-command" },
};
const rejected: CommandAck = {
  commandId: envelope.commandId,
  status: "rejected",
  revisionAtDecision: 0,
  reasonCode: "fault.command.savedWorkflowStartRejected.compile_failed",
};
const runs = (toolCallId = "launch-same-command") =>
  ({
    runs: [{ runId: "actual-engine", toolCallId, status: "completed" }],
  }) as V4ConversationWorkflowRunsResult;

test("lost launch ACK reads journal evidence without sending a second launch", async () => {
  let sent = 0;
  const result = await confirmSavedWorkflowLaunch(
    {
      sendCommand: async (command) => {
        sent++;
        assert.equal(command, envelope);
        throw new Error("lost ACK");
      },
      queryCommands: async () => {
        throw new Error("query unavailable");
      },
      workflowRuns: async (query) => {
        assert.deepEqual(query, { sessionId: "owned-parent" });
        return runs();
      },
    },
    envelope,
  );
  assert.deepEqual(result, {
    state: "started",
    runId: "actual-engine",
    toolCallId: "launch-same-command",
  });
  assert.equal(sent, 1);
});

test("unknown confirmation retains the parent; foreign evidence cannot confirm it", async () => {
  const result = await confirmSavedWorkflowLaunch(
    {
      sendCommand: async () => {
        throw new Error("lost ACK");
      },
      queryCommands: async () => ({
        results: [
          { key: { sessionId: "another-parent", commandId: envelope.commandId }, result: accepted },
        ],
      }),
      workflowRuns: async () => runs("launch-another-command"),
    },
    envelope,
  );
  assert.equal(result.state, "uncertain");
});

test("authoritative duplicate confirmation opens the original run", async () => {
  const result = await confirmSavedWorkflowLaunch(
    {
      sendCommand: async () => {
        throw new Error("lost ACK");
      },
      queryCommands: async (query) => {
        assert.deepEqual(query, {
          commands: [{ commandId: envelope.commandId, sessionId: envelope.sessionId }],
        });
        return {
          results: [
            {
              key: { sessionId: envelope.sessionId, commandId: envelope.commandId },
              result: { ...accepted, status: "duplicate" },
            },
          ],
        };
      },
      workflowRuns: async () => {
        throw new Error("journal is unnecessary after confirmation");
      },
    },
    envelope,
  );
  assert.equal(result.state, "started");
});

test("only definite rejection without matching engine evidence permits empty-parent reclamation", async () => {
  const port = {
    sendCommand: async () => rejected,
    queryCommands: async () => ({ results: [] }),
    workflowRuns: async () => runs("other"),
  };
  assert.deepEqual(await confirmSavedWorkflowLaunch(port, envelope), {
    state: "rejected",
    ack: rejected,
  });
  assert.equal(
    (await confirmSavedWorkflowLaunch({ ...port, workflowRuns: async () => runs() }, envelope))
      .state,
    "started",
  );
});

test("malformed accepted ACK remains uncertain rather than authorizing deletion", async () => {
  const result = await confirmSavedWorkflowLaunch(
    {
      sendCommand: async () => ({ ...accepted, result: undefined }),
      queryCommands: async () => ({ results: [] }),
      workflowRuns: async () => ({ runs: [] }),
    },
    envelope,
  );
  assert.equal(result.state, "uncertain");
});
