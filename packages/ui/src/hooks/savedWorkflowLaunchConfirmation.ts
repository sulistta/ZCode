import type { CommandAck, CommandEnvelope } from "@social-harness/shared/zcode-protocol-v4";
import type { ConversationTransport } from "../v4/transport.js";

type Confirmation =
  | { state: "started"; runId: string; toolCallId: string }
  | { state: "rejected"; ack: CommandAck }
  | { state: "uncertain" };

function started(ack: CommandAck | undefined, commandId: string): Confirmation | undefined {
  if (
    ack?.commandId !== commandId ||
    (ack.status !== "accepted" && ack.status !== "duplicate") ||
    ack.result?.type !== "startSavedWorkflow"
  )
    return;
  return { state: "started", runId: ack.result.runId, toolCallId: ack.result.toolCallId };
}

/** 丢失 ACK 不是拒绝：按原 command/session 对账，不删除可能已接受脚本的父会话。 */
export async function confirmSavedWorkflowLaunch(
  transport: Pick<ConversationTransport, "sendCommand" | "queryCommands" | "workflowRuns">,
  envelope: CommandEnvelope,
): Promise<Confirmation> {
  let ack: CommandAck | undefined;
  try {
    ack = await transport.sendCommand(envelope);
  } catch {
    /* 原命令可能已经接受；继续读取 owner 投影。 */
  }
  const direct = started(ack, envelope.commandId);
  if (direct) return direct;
  if (
    !ack ||
    ack.commandId !== envelope.commandId ||
    ack.status === "accepted" ||
    ack.status === "duplicate"
  ) {
    try {
      const query = await transport.queryCommands({
        commands: [{ sessionId: envelope.sessionId, commandId: envelope.commandId }],
      });
      const item = query.results.find(
        (entry) =>
          entry.key.commandId === envelope.commandId && entry.key.sessionId === envelope.sessionId,
      );
      if (item && item.result !== "unknown") ack = item.result;
    } catch {
      /* 冷进程的 journal 仍可证明接受，不能用通信失败替代该事实。 */
    }
    const confirmed = started(ack, envelope.commandId);
    if (confirmed) return confirmed;
  }
  if (envelope.sessionId) {
    try {
      const query = await transport.workflowRuns({ sessionId: envelope.sessionId });
      const run = query.runs.find((entry) => entry.toolCallId === `launch-${envelope.commandId}`);
      if (run)
        return { state: "started", runId: run.runId, toolCallId: `launch-${envelope.commandId}` };
    } catch {
      /* 无法读取不是“没有运行”，保留父会话等待恢复。 */
    }
  }
  if (ack?.commandId === envelope.commandId && ["rejected", "stale", "failed"].includes(ack.status))
    return { state: "rejected", ack };
  return { state: "uncertain" };
}
