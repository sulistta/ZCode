import type { SocialAgentService } from "./contract.js";

export async function readCurrentAccountEditorialContext(
  service: SocialAgentService,
  workspaceIdentity: string,
) {
  const scope = await service.resolveScope(workspaceIdentity);
  if (!scope) return null;
  return scope.getContext();
}
