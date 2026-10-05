import type { IZCodeAgentService } from "@social-harness/services";
import { createHostCommandEnvelope, type AutomationRepo } from "@social-harness/services/node";
import {
  approvedWorkflowSnapshotSchema,
  parseSocialAccountWorkspaceIdentity,
  type ZCodeAutomationRun,
} from "@social-harness/shared";
import { createAccountRecipeRunTracker } from "./accountRecipeRunTracker.js";

export class AccountRecipeAdmissionUncertainError extends Error {
  constructor(readonly sessionId: string) {
    super(
      "Recipe admission confirmation is unavailable. Reconnect and retry this same occurrence; do not start another run.",
    );
    this.name = "AccountRecipeAdmissionUncertainError";
  }
}

/** 调度 source 只取已认领 run；旧 schedule/definition 不能替换用户批准的字节。 */
export async function dispatchAccountRecipeOccurrence(params: {
  runId: string;
  automationId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  run: ZCodeAutomationRun;
  repo: Pick<
    AutomationRepo,
    | "fixRunSession"
    | "ensureRunClaimed"
    | "markRunOutcome"
    | "markRunDispatch"
    | "touchManualClaim"
    | "releaseManualClaim"
  >;
  agent: Pick<
    IZCodeAgentService,
    | "validateSavedWorkflow"
    | "sendConversationCommandV4"
    | "conversationWorkflowRunsV4"
    | "onDynamicConversationTelemetryFact"
  >;
  createParent(): Promise<string>;
  resumeParent(sessionId: string): Promise<void>;
  discardEmptyParent(sessionId: string): Promise<void>;
  registerTracker(
    tracker: ReturnType<typeof createAccountRecipeRunTracker>,
    sessionId: string,
  ): void;
  onTrackerSettled?(
    tracker: ReturnType<typeof createAccountRecipeRunTracker>,
    sessionId: string,
  ): void;
  setUnread(sessionId: string): Promise<void>;
  logWarn(message: string, error: unknown): void;
}): Promise<{ taskId: string; sessionId: string }> {
  const { run } = params;
  const workspaceKey = params.workspaceIdentity?.trim() || params.workspacePath;
  if (
    run.runId !== params.runId ||
    run.automationId !== params.automationId ||
    run.workspaceKey !== workspaceKey ||
    !parseSocialAccountWorkspaceIdentity(params.workspaceIdentity)
  )
    throw new Error("Recipe occurrence is unavailable for this account.");
  if (run.recipeSnapshotError || !run.recipeSnapshot)
    throw new Error("Recipe snapshot is invalid or unavailable.");
  const snapshot = approvedWorkflowSnapshotSchema.parse(run.recipeSnapshot);
  const target = {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
  };
  // 共享 Agent service 在启动 runtime 前校验 identity/cwd；core 编译器仍是唯一的脚本/实参验证者。
  const validation = await params.agent.validateSavedWorkflow({
    ...target,
    approvedSnapshot: snapshot,
  });
  if (!validation.ok) throw new Error(validation.message);
  let sessionId = run.sessionId;
  const reusedParent = !!sessionId;
  if (!sessionId) {
    const created = await params.createParent();
    try {
      sessionId = await params.repo.fixRunSession({
        runId: run.runId,
        automationId: run.automationId,
        workspaceKey,
        sessionId: created,
      });
    } catch (error) {
      await params.discardEmptyParent(created);
      throw error;
    }
    if (sessionId !== created) {
      await params.discardEmptyParent(created);
      await params.resumeParent(sessionId);
    }
  } else await params.resumeParent(sessionId);
  const result = { taskId: sessionId, sessionId };
  const tracker = createAccountRecipeRunTracker({
    ...params,
    target,
    run: { ...run, sessionId },
    setUnread: () => params.setUnread(sessionId),
    onSettled: () => params.onTrackerSettled?.(tracker, sessionId),
  });
  params.registerTracker(tracker, sessionId);
  try {
    if (reusedParent && (await tracker.reconcile())) return result;
    await tracker.markRunning();
    let rejected = false;
    try {
      const ack = await params.agent.sendConversationCommandV4({
        ...target,
        clientMode: "desktop-continuous",
        envelope: createHostCommandEnvelope({
          commandId: run.runId,
          type: "startSavedWorkflow",
          sessionId,
          payload: {
            name: snapshot.name,
            scope: "project",
            approvedSnapshot: validation.approvedSnapshot,
          },
        }),
      });
      if (
        (ack.status === "accepted" || ack.status === "duplicate") &&
        ack.result?.type === "startSavedWorkflow"
      ) {
        try {
          await tracker.reconcile();
        } catch (error) {
          params.logWarn("Recipe admission accepted; journal reconciliation unavailable", error);
        }
        return result;
      }
      rejected = ack.status === "rejected" || ack.status === "stale" || ack.status === "failed";
      throw new Error(ack.message ?? `Recipe admission ${ack.status}`);
    } catch (error) {
      // 网络异常不等于脚本未启动。先用同一父会话的 journal 对账，不能释放 claim 后用新 key 再运行。
      try {
        if (await tracker.reconcile()) return result;
      } catch (queryError) {
        params.logWarn("Recipe admission journal reconciliation unavailable", queryError);
      }
      if (rejected) throw error;
      const uncertain = new AccountRecipeAdmissionUncertainError(sessionId);
      await params.repo.markRunDispatch({
        runId: run.runId,
        dispatchStatus: "claimed",
        error: uncertain.message,
      });
      throw uncertain;
    }
  } catch (error) {
    if (!(error instanceof AccountRecipeAdmissionUncertainError)) tracker.dispose();
    throw error;
  }
}
