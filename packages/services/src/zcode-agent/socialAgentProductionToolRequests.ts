import type { SocialAgentQueryParams, SocialAgentQueryResult } from "@social-harness/shared";
import type { SocialAgentScope } from "../social-agent/contract.js";

export async function executeSocialAgentProductionRequest(
  scope: SocialAgentScope,
  request: SocialAgentQueryParams,
): Promise<SocialAgentQueryResult | null> {
  switch (request.action) {
    case "import-source":
      return { action: request.action, job: await scope.importSource(request.url) };
    case "list-media-jobs":
      return { action: request.action, jobs: await scope.listMediaJobs(request) };
    case "media-job-command":
      return {
        action: request.action,
        job: await scope.mediaJobCommand({ jobId: request.jobId, action: request.command }),
      };
    case "create-project":
      return {
        action: request.action,
        project: await scope.createProject({
          displayName: request.displayName,
          requestId: request.requestId,
        }),
      };
    case "start-export":
      return {
        action: request.action,
        job: await scope.startExport({
          projectId: request.projectId,
          expectedRevision: request.expectedRevision,
          requestId: request.requestId,
        }),
      };
    case "list-exports":
      return { action: request.action, jobs: await scope.listExports(request) };
    default:
      return null;
  }
}
