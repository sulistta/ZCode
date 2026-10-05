import {
  approvedWorkflowSnapshotSchema,
  parseSocialAccountWorkspaceIdentity,
  type ApprovedWorkflowSnapshot,
  type ZCodeAutomation,
} from "@social-harness/shared";
import type { IZCodeAgentService } from "./zcodeAgent.js";
import type { ZCodeAgentWorkspaceTarget } from "./zcodeAgentPluginParams.js";

/** Host 只接纳 core 校验后的值；省略快照表示保留版本，不能隐式转换已有 prompt occurrence。 */
export async function validateAccountRecipeScheduleWrite(
  params: ZCodeAgentWorkspaceTarget & {
    recipeSnapshot?: ApprovedWorkflowSnapshot;
    prompt?: string;
    existing?: ZCodeAutomation;
    validate: IZCodeAgentService["validateSavedWorkflow"];
  },
): Promise<ApprovedWorkflowSnapshot | undefined> {
  if (params.recipeSnapshot === undefined) return undefined;
  if (!parseSocialAccountWorkspaceIdentity(params.workspaceIdentity))
    throw new Error("Recipe schedules require a canonical account workspace.");
  if (params.existing && !params.existing.recipeSnapshot && !params.existing.recipeSnapshotError)
    throw new Error("Create a new recipe schedule instead of converting a prompt schedule.");
  if ((params.prompt ?? params.existing?.prompt ?? "") !== "")
    throw new Error("Recipe schedules cannot also dispatch prompt instructions.");
  const snapshot = approvedWorkflowSnapshotSchema.parse(params.recipeSnapshot);
  const result = await params.validate({
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
    ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
    approvedSnapshot: snapshot,
  });
  if (!result.ok) throw new Error(result.message);
  return approvedWorkflowSnapshotSchema.parse(result.approvedSnapshot);
}
