import {
  approvedWorkflowSnapshotSchema,
  parseSocialAccountWorkspaceIdentity,
  type ApprovedWorkflowSnapshot,
} from "@social-harness/shared";

export function serializeAutomationRecipeSnapshot(input: {
  snapshot?: ApprovedWorkflowSnapshot;
  workspaceIdentity?: string;
  prompt: string;
}): string | null {
  if (input.snapshot === undefined) {
    if (!input.prompt.trim()) throw new Error("Prompt automations require instructions.");
    return null;
  }
  if (!parseSocialAccountWorkspaceIdentity(input.workspaceIdentity))
    throw new Error("Recipe automations require a canonical account workspace.");
  if (input.prompt !== "")
    throw new Error("Recipe automations cannot also dispatch prompt instructions.");
  return JSON.stringify(approvedWorkflowSnapshotSchema.parse(input.snapshot));
}

export function readAutomationRecipeSnapshot(serialized: string | null | undefined): {
  recipeSnapshot?: ApprovedWorkflowSnapshot;
  recipeSnapshotError?: "invalid_recipe_snapshot";
} {
  if (serialized === null || serialized === undefined) return {};
  try {
    return { recipeSnapshot: approvedWorkflowSnapshotSchema.parse(JSON.parse(serialized)) };
  } catch {
    // 坏的非 NULL 快照不能被当成旧 prompt；投影显式错误，保留其它账户的列表与调度可用性。
    return { recipeSnapshotError: "invalid_recipe_snapshot" };
  }
}
