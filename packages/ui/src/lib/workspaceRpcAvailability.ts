import { parseSocialAccountWorkspaceIdentity } from "@social-harness/shared";

interface WorkspaceRpcAvailabilityTarget {
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  remoteTarget?: unknown;
}

function isRemoteWorkspaceRpcTarget(target: WorkspaceRpcAvailabilityTarget): boolean {
  const identity = target.workspaceIdentity?.trim();
  return Boolean(
    (identity && parseSocialAccountWorkspaceIdentity(identity) === null) ||
    target.remoteSessionId?.trim() ||
    target.remoteTarget,
  );
}

export function shouldEnableWorkspaceRpc(target: WorkspaceRpcAvailabilityTarget): boolean {
  return !isRemoteWorkspaceRpcTarget(target) || Boolean(target.remoteSessionId?.trim());
}
