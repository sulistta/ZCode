import { mkdir } from "node:fs/promises";
import { getConversationWorkspaceDir } from "@social-harness/services/node";
import type { WorkspacePurpose } from "@social-harness/shared";

export interface StartupWorkspaceWarmupTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface StartupWindowBootstrap {
  restoreSession?: boolean;
  initialWorkspacePath?: string;
  initialWorkspacePurpose?: WorkspacePurpose;
  unavailableWorkspacePath?: string;
  agentWarmupTargets?: StartupWorkspaceWarmupTarget[];
}

export async function resolveStartupWindowBootstrap(
  runtimeWorkspaceDir = getConversationWorkspaceDir(),
): Promise<StartupWindowBootstrap> {
  await mkdir(runtimeWorkspaceDir, { recursive: true });
  return {};
}
