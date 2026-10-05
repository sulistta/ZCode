import type { IZCodeAgentService } from "@social-harness/services";
import type { AutomationRepo } from "@social-harness/services/node";
import type { ZCodeAutomationRun, ZCodeAutomationRunOutcome } from "@social-harness/shared";
import {
  recordCronRunOutcomeBestEffort,
  settleCronRunTerminalOutcome,
  startManualClaimHeartbeat,
} from "./cronRunLifecycle.js";

export function createAccountRecipeRunTracker(params: {
  run: ZCodeAutomationRun;
  target: { workspacePath: string; workspaceIdentity?: string };
  agent: Pick<
    IZCodeAgentService,
    "onDynamicConversationTelemetryFact" | "conversationWorkflowRunsV4"
  >;
  repo: Pick<
    AutomationRepo,
    | "ensureRunClaimed"
    | "markRunOutcome"
    | "markRunDispatch"
    | "touchManualClaim"
    | "releaseManualClaim"
  >;
  setUnread(): Promise<void>;
  onSettled?(): void;
  logWarn(message: string, error: unknown): void;
}) {
  const { run } = params;
  if (!run.sessionId) throw new Error("Recipe occurrence has no bound parent.");
  const identity = {
    runId: run.runId,
    automationId: run.automationId,
    workspaceKey: run.workspaceKey,
    scheduledAt: run.scheduledAt ?? null,
    trigger: run.trigger,
  };
  let settled = false;
  let disposed = false;
  let settlement = Promise.resolve();
  const heartbeat =
    run.trigger === "manual"
      ? startManualClaimHeartbeat({ ...identity, repo: params.repo, logWarn: params.logWarn })
      : undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    heartbeat?.dispose();
    subscription.dispose();
  };
  const settle = (outcome: Exclude<ZCodeAutomationRunOutcome, "running">, error?: string) => {
    if (settled || disposed) return;
    settled = true;
    dispose();
    settlement = (async () => {
      await settleCronRunTerminalOutcome({
        ...identity,
        repo: params.repo,
        outcome,
        error,
        logWarn: params.logWarn,
      });
      try {
        await params.setUnread();
      } catch (error) {
        params.logWarn("Recipe conversation unread update failed", error);
      }
      params.onSettled?.();
    })();
  };
  // 启动 turn 是 controlOnly，结束不代表脚本结束；仅引擎终态和 journal 读面能结算 occurrence。
  const subscription = params.agent.onDynamicConversationTelemetryFact(params.target)((fact) => {
    if (
      fact.kind !== "workflow.lifecycle" ||
      fact.phase !== "run-settled" ||
      fact.sessionId !== run.sessionId ||
      fact.sourceCommandId !== run.runId ||
      (fact.toolCallId && fact.toolCallId !== `launch-${run.runId}`)
    )
      return;
    if (fact.status === "completed") settle("succeeded");
    if (fact.status === "errored") settle("failed", fact.errorMessage);
    if (fact.status === "stopped") settle("stopped", fact.errorMessage ?? fact.stopReason);
  });
  const markRunning = async () => {
    if (settled || disposed) return;
    await recordCronRunOutcomeBestEffort({
      ...identity,
      repo: params.repo,
      outcome: "running",
      logWarn: params.logWarn,
    });
  };
  return {
    dispose,
    markRunning,
    isSettled: () => settled,
    flush: () => settlement,
    async reconcile(): Promise<boolean> {
      if (settled) {
        await settlement;
        return true;
      }
      const result = await params.agent.conversationWorkflowRunsV4({
        ...params.target,
        sessionId: run.sessionId!,
      });
      // journal 是重连后的权威；按 launch 工具 id 对账，不在 Host 复制引擎 runId 的散列算法。
      const summary = result.runs.find((entry) => entry.toolCallId === `launch-${run.runId}`);
      if (!summary) return false;
      if (summary.status === "completed") settle("succeeded");
      else if (summary.status === "errored")
        settle("failed", summary.failureMessage ?? summary.failureCode);
      else if (summary.status === "stopped")
        settle("stopped", summary.failureMessage ?? summary.stopReason);
      else await markRunning();
      await settlement;
      return true;
    },
  };
}
