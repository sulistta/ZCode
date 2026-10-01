import {
  parseSocialAccountWorkspaceIdentity,
  socialAgentContextSchema,
  socialAgentMediaAssetSchema,
  socialAgentPublicationRequestResultSchema,
} from "@social-harness/shared";
import type { ISocialAccountService } from "../../social-account/contract.js";
import type { ISocialMediaService } from "../../social-media/contract.js";
import type { ISocialProjectService } from "../../social-project/contract.js";
import type { ISocialPublishingService } from "../../social-publishing/contract.js";
import type { SocialAgentService, SocialAgentScope } from "../contract.js";

export function createSocialAgentService(options: {
  accountService: ISocialAccountService;
  mediaService: ISocialMediaService;
  projectService: ISocialProjectService;
  publishingService?: ISocialPublishingService;
}): SocialAgentService {
  return {
    async resolveScope(workspaceIdentity): Promise<SocialAgentScope | null> {
      const parsedAccountId = parseSocialAccountWorkspaceIdentity(workspaceIdentity);
      if (!parsedAccountId) return null;
      const accountId: string = parsedAccountId;
      if (!(await options.accountService.get(accountId))) return null;

      async function requireCurrentAccount() {
        const account = await options.accountService.get(accountId);
        if (!account) throw new Error("The social account for this Agent scope is unavailable.");
        return account;
      }

      return {
        async getContext() {
          const account = await requireCurrentAccount();
          const [projects, exports, publicationHistory] = await Promise.all([
            options.projectService.list(accountId),
            options.projectService.listExports(accountId),
            options.publishingService
              ? options.publishingService
                  .listInstagramPublications(accountId)
                  .then((items) => ({
                    status: "available" as const,
                    items: items
                      .toSorted((first, second) => second.createdAt - first.createdAt)
                      .slice(0, 25)
                      .map((item) => ({
                        projectId: item.projectId,
                        projectRevision: item.projectRevision,
                        status: item.status,
                        caption: item.caption,
                        ...(item.permalink ? { permalink: item.permalink } : {}),
                        createdAt: item.createdAt,
                      })),
                  }))
                  .catch(() => ({ status: "unavailable" as const, items: [] }))
              : Promise.resolve({ status: "unavailable" as const, items: [] }),
          ]);
          const currentRevisions = new Map(
            projects.map((project) => [project.projectId, project.revision]),
          );
          return socialAgentContextSchema.parse({
            editorialProfile: account.editorialProfile,
            automationPolicy: account.automationPolicy,
            projects: projects
              .toSorted((first, second) => second.updatedAt - first.updatedAt)
              .slice(0, 100)
              .map(({ accountId: _accountId, ...project }) => project),
            completedExports: exports
              .filter(
                (item) =>
                  item.status === "completed" &&
                  currentRevisions.get(item.projectId) === item.projectRevision,
              )
              .toSorted((first, second) => second.createdAt - first.createdAt)
              .slice(0, 100)
              .map(({ exportId, projectId, projectRevision, createdAt }) => ({
                exportId,
                projectId,
                projectRevision,
                createdAt,
              })),
            publicationHistory,
          });
        },
        async listMedia() {
          await requireCurrentAccount();
          const assets = await options.mediaService.list(accountId);
          return assets
            .toSorted((first, second) => second.importedAt - first.importedAt)
            .slice(0, 500)
            .map((asset) =>
              socialAgentMediaAssetSchema.parse({
                mediaId: asset.mediaId,
                sourceKind: asset.sourceKind,
                ...(asset.sourceOrigin ? { sourceOrigin: asset.sourceOrigin } : {}),
                originalName: asset.originalName,
                mediaKind: asset.mediaKind,
                sizeBytes: asset.sizeBytes,
                importedAt: asset.importedAt,
                ...(asset.sourceKind === "youtube" && asset.sourceUrl
                  ? { sourceUrl: asset.sourceUrl }
                  : {}),
                ...(asset.sourceTitle ? { sourceTitle: asset.sourceTitle } : {}),
                ...(asset.sourceChannel !== undefined
                  ? { sourceChannel: asset.sourceChannel }
                  : {}),
                ...(asset.sourceDurationSeconds !== undefined
                  ? { sourceDurationSeconds: asset.sourceDurationSeconds }
                  : {}),
                transcript: asset.transcript
                  ? {
                      languageCode: asset.transcript.languageCode,
                      method: asset.transcript.method,
                      segmentCount: asset.transcript.segments.length,
                    }
                  : null,
                heatmapSegmentCount: asset.heatmap?.length ?? 0,
              }),
            );
        },
        async searchYouTube(query) {
          await requireCurrentAccount();
          return options.mediaService.searchYouTube({ accountId, query });
        },
        async suggestClipCandidates(input) {
          await requireCurrentAccount();
          const { accountId: _accountId, ...result } =
            await options.mediaService.suggestClipCandidates({
              accountId,
              mediaId: input.mediaId,
              mode: input.mode,
            });
          return result;
        },
        async requestPublication(input) {
          if (!options.publishingService) {
            throw new Error("Instagram publishing is unavailable for this account.");
          }
          await requireCurrentAccount();
          const publication = await options.publishingService.requestAutomatedInstagramPublication({
            accountId,
            exportId: input.exportId,
            caption: input.caption,
            requestId: input.requestId,
          });
          return socialAgentPublicationRequestResultSchema.parse({
            publicationId: publication.publicationId,
            projectId: publication.projectId,
            projectRevision: publication.projectRevision,
            status: publication.status,
            caption: publication.caption,
            createdAt: publication.createdAt,
          });
        },
      };
    },
  };
}
