import { createHash } from "node:crypto";
import type { DynamicWorkflowRunSubmitRequest } from "@social-harness/contracts";
import { canonicalJson } from "@social-harness/dynamic-workflow";
import type { RunRegistryEntry } from "./dynamic-workflow-run-observation.js";
import type { DynamicWorkflowRunServiceDeps } from "./dynamic-workflow-run-service.js";

const MAX_ADMISSION_KEY_CHARS = 512;

/** 复用既有 owner 的同步 registry 和持久 journal；不预插引擎行、不创建第二份 admission 状态。 */
export function resolveAccountWorkflowAdmission(
  context: {
    deps: Pick<DynamicWorkflowRunServiceDeps, "journal" | "capabilityScope">;
    runs: ReadonlyMap<string, RunRegistryEntry>;
  },
  request: DynamicWorkflowRunSubmitRequest,
): { runId: string; replayed: boolean } | undefined {
  if (request.admissionKey === undefined) return undefined;
  if (
    context.deps.capabilityScope !== "social-account" ||
    typeof request.admissionKey !== "string" ||
    !request.admissionKey.trim() ||
    request.admissionKey.length > MAX_ADMISSION_KEY_CHARS ||
    request.launchInputId !== request.admissionKey ||
    !request.parentSessionId
  )
    throw new Error("Invalid account workflow admission key");

  // 旧 submit 每次随机铸 runId；丢 ACK 后重试会再次执行已批准脚本。
  // 以可信账号/父会话/commandId 派生安全文件名，冷重启也能直接命中引擎独占的 journal 行。
  const runId = `dwfrun-${createHash("sha256")
    .update(JSON.stringify([request.cwd, request.parentSessionId, request.admissionKey]))
    .digest("hex")}`;
  const entry = context.runs.get(runId);
  const record = entry ? undefined : context.deps.journal.getRun(runId);
  const existing = entry ?? record;
  if (!existing) return { runId, replayed: false };

  const argsJson = entry ? entry.admissionArgsJson : canonicalJson(record?.args ?? {});
  if (
    existing.cwd !== request.cwd ||
    existing.parentSessionId !== request.parentSessionId ||
    existing.name !== request.name ||
    existing.scriptText !== request.scriptText ||
    existing.toolCallId !== request.toolCallId ||
    argsJson !== canonicalJson(request.args ?? {})
  )
    throw new Error("Account workflow admission conflict");
  return { runId, replayed: true };
}
