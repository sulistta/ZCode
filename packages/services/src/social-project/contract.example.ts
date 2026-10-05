import type { ISocialProjectService } from "./contract.js";

/** Create a portrait project scoped to one locally prepared account. */
export function createSocialReelProject(service: ISocialProjectService, accountId: string) {
  return service.create({ accountId, displayName: "New Reel" });
}

/** Apply an editor or Agent operation using the exact same revisioned command boundary. */
export function addVideoTrack(
  service: ISocialProjectService,
  project: Awaited<ReturnType<ISocialProjectService["get"]>>,
) {
  if (!project) throw new Error("Social project not found");
  return service.executeCommand({
    accountId: project.project.accountId,
    projectId: project.project.projectId,
    commandId: crypto.randomUUID(),
    expectedRevision: project.project.revision,
    author: "user",
    operation: {
      type: "add-track",
      trackId: crypto.randomUUID(),
      name: "Video 1",
      trackType: "video",
      position: project.project.tracks.length,
    },
  });
}

/** Resolve an Agent view from the Host-owned account workspace identity. */
export async function listAgentProjects(service: ISocialProjectService, workspaceIdentity: string) {
  const accountScope = await service.agentScope(workspaceIdentity);
  if (!accountScope) return [];
  return accountScope.list();
}

/** Queue an immutable export of the exact accepted project revision. */
export function startAcceptedRevisionExport(
  service: ISocialProjectService,
  project: Awaited<ReturnType<ISocialProjectService["get"]>>,
) {
  if (!project) throw new Error("Social project not found");
  return service.startExport({
    accountId: project.project.accountId,
    projectId: project.project.projectId,
    expectedRevision: project.project.revision,
    requestId: crypto.randomUUID(),
  });
}

/** Prepare a short-lived capability only after the Host has completed the export. */
export function prepareCompletedExportDownload(
  service: ISocialProjectService,
  accountId: string,
  exportId: string,
) {
  return service.prepareExportDownload({ accountId, exportId });
}
