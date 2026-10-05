import { HostMessageTypes } from "@social-harness/shared";
import type { UtilityProcess } from "electron";
import type {
  MainToSchedulerMessage,
  SchedulerToMainMessage,
} from "../scheduler/schedulerProtocol.js";

export type CronDispatchRequest = Extract<
  SchedulerToMainMessage,
  { type: "cron-dispatch-request" }
>;

export interface CronDispatchRouterDeps {
  isDisposing: boolean;
  postToScheduler: (message: MainToSchedulerMessage) => void;
  resolveDispatchHost: () => Pick<UtilityProcess, "postMessage"> | null;
  logger: { warn: (...args: unknown[]) => void };
}

/** 将 scheduler 的请求转为 Host CronRun；失败时向 scheduler 返回可重试结果。 */
export function routeCronDispatchRequest(
  msg: CronDispatchRequest,
  deps: CronDispatchRouterDeps,
): void {
  if (deps.isDisposing) {
    // App 退出时拒绝新派发，避免发送给正在关闭的 Host。
    deps.postToScheduler({
      type: "cron-dispatch-result",
      runId: msg.runId,
      ok: false,
      failureKind: "transient",
      error: "app is shutting down",
    });
    return;
  }

  const host = deps.resolveDispatchHost();
  if (!host) {
    // 没有可派发的本地 host（无窗口/未就绪）：退避后重试。
    deps.postToScheduler({
      type: "cron-dispatch-result",
      runId: msg.runId,
      ok: false,
      failureKind: "transient",
      error: "no local host available",
    });
    return;
  }

  try {
    host.postMessage({
      type: HostMessageTypes.CronRun,
      automationId: msg.automationId,
      runId: msg.runId,
      prompt: msg.prompt,
      targetTaskId: msg.targetTaskId,
      modelSelection: msg.modelSelection,
      mode: msg.mode,
      workspacePath: msg.workspacePath,
      workspaceIdentity: msg.workspaceIdentity,
    });
  } catch (error) {
    deps.logger.warn("[cron-scheduler] forward CronRun to host failed:", error);
    deps.postToScheduler({
      type: "cron-dispatch-result",
      runId: msg.runId,
      ok: false,
      failureKind: "transient",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
