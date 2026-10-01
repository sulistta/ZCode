import { parseSocialAccountWorkspaceIdentity } from "@social-harness/shared";

export function isConversationSharingAvailable(workspaceIdentity?: string): boolean {
  return parseSocialAccountWorkspaceIdentity(workspaceIdentity?.trim()) === null;
}
