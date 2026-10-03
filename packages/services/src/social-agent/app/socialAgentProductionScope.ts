import {
  socialAgentMediaJobSchema,
  socialAgentExportJobSchema,
  socialAgentProjectSummarySchema,
} from "@social-harness/shared";
import type { ISocialMediaService } from "../../social-media/contract.js";
import type { ISocialProjectService } from "../../social-project/contract.js";
import type { SocialAgentScope } from "../contract.js";

type ProductionScope = Pick<
  SocialAgentScope,
  | "importSource"
  | "listMediaJobs"
  | "mediaJobCommand"
  | "createProject"
  | "startExport"
  | "listExports"
>;
const MAX_JOBS = 100;

export function createSocialAgentProductionScope(options: {
  accountId: string;
  requireCurrentAccount(): Promise<unknown>;
  mediaService: ISocialMediaService;
  projectService: ISocialProjectService;
}): ProductionScope {
  const { accountId, mediaService, projectService } = options;
  return {
    async importSource(url) {
      await options.requireCurrentAccount();
      // Agent 只提交命令；下载、去重与恢复仍由原媒体 owner 管理。
      return socialAgentMediaJobSchema.parse(
        await mediaService.downloadSourceUrl({ accountId, url }),
      );
    },
    async listMediaJobs(input) {
      await options.requireCurrentAccount();
      return (await mediaService.listJobs(accountId))
        .filter((job) => !input.jobId || job.jobId === input.jobId)
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_JOBS)
        .map((job) => socialAgentMediaJobSchema.parse(job));
    },
    async mediaJobCommand(input) {
      await options.requireCurrentAccount();
      const request = { accountId, jobId: input.jobId };
      return socialAgentMediaJobSchema.parse(
        await (input.action === "cancel"
          ? mediaService.cancelJob(request)
          : mediaService.retryJob(request)),
      );
    },
    async createProject(input) {
      await options.requireCurrentAccount();
      const result = await projectService.create({
        accountId,
        displayName: input.displayName,
        requestId: input.requestId,
      });
      return socialAgentProjectSummarySchema.parse({
        ...result.project,
        trackCount: result.project.tracks.length,
      });
    },
    async startExport(input) {
      await options.requireCurrentAccount();
      return socialAgentExportJobSchema.parse(
        await projectService.startExport({
          accountId,
          projectId: input.projectId,
          expectedRevision: input.expectedRevision,
          requestId: input.requestId,
        }),
      );
    },
    async listExports(input) {
      await options.requireCurrentAccount();
      return (await projectService.listExports(accountId, input.projectId))
        .filter((job) => !input.exportId || job.exportId === input.exportId)
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_JOBS)
        .map((job) => socialAgentExportJobSchema.parse(job));
    },
  };
}
