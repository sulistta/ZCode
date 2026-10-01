import { randomUUID } from "node:crypto";
import { Emitter } from "@social-harness/rpc";
import {
  socialAccountIdSchema,
  socialProjectExportCancelRequestSchema,
  socialProjectExportDownloadRequestSchema,
  socialProjectExportJobSchema,
  socialProjectExportRequestSchema,
  socialProjectIdSchema,
  type SocialProject,
  type SocialProjectExportCancelRequest,
  type SocialProjectExportDownloadRequest,
  type SocialProjectExportDownload,
  type SocialProjectExportJob,
  type SocialProjectExportRequest,
} from "@social-harness/shared";
import type { ISocialAccountService } from "../../social-account/contract.js";
import type { ISocialMediaService, SocialMediaAsset } from "../../social-media/contract.js";
import type { ISocialProjectService, SocialProjectExportChange } from "../contract.js";
import type { SocialProjectExportRecord } from "../domain/projectExportRecord.js";
import {
  canonicalizeProjectExportValue,
  collectProjectExportMediaIds,
  toSocialProjectExportChange,
} from "./projectExportHelpers.js";
import {
  SocialProjectAccountNotFoundError,
  SocialProjectExportRenderError,
  SocialProjectExportRequestConflictError,
  SocialProjectExportRevisionConflictError,
  SocialProjectExportUnavailableError,
  SocialProjectNotFoundError,
} from "./errors.js";
import type { SocialProjectExportStore } from "./ports/socialProjectExportStore.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";

const logger = createServiceLogger("social-project-export");

export interface SocialProjectExportRenderer {
  render(input: {
    exportId: string;
    project: SocialProject;
    mediaAssets: ReadonlyMap<string, SocialMediaAsset>;
    signal: AbortSignal;
    onProgress: (progressPercent: number) => void;
  }): Promise<{ durationMs: number; fileSizeBytes: number; sha256: string }>;
  discard(exportId: string): Promise<void>;
  createDownloadUrl(input: {
    exportId: string;
    sha256: string;
    fileSizeBytes: number;
  }): Promise<{ url: string; expiresAt: number }>;
}

interface SocialProjectExportServiceOptions {
  projectService: Pick<ISocialProjectService, "get">;
  socialAccountService: ISocialAccountService;
  socialMediaService: ISocialMediaService;
  store: SocialProjectExportStore;
  renderer: SocialProjectExportRenderer;
  now?: () => number;
  createExportId?: () => string;
}

export function createSocialProjectExportOperations(options: SocialProjectExportServiceOptions) {
  const now = options.now ?? Date.now;
  const createExportId = options.createExportId ?? randomUUID;
  const changed = new Emitter<SocialProjectExportChange>();
  const active = new Map<string, AbortController>();
  let pumping = false;
  let pumpRequested = false;
  let activeCompletion: Promise<void> | null = null;

  function emit(job: SocialProjectExportJob): void {
    changed.fire(toSocialProjectExportChange(job));
  }

  async function updateJob(
    accountId: string,
    exportId: string,
    update: (job: SocialProjectExportJob) => SocialProjectExportJob,
  ): Promise<SocialProjectExportJob> {
    let changedJob = false;
    const record = await options.store.update(accountId, exportId, (current) => {
      const nextJob = socialProjectExportJobSchema.parse(update(current.job));
      if (canonicalizeProjectExportValue(nextJob) === canonicalizeProjectExportValue(current.job)) {
        return current;
      }
      changedJob = true;
      return { ...current, job: nextJob };
    });
    if (!record) throw new SocialProjectExportUnavailableError();
    if (changedJob) emit(record.job);
    return record.job;
  }

  async function validateMedia(project: SocialProject, accountId: string) {
    const assets = await options.socialMediaService.list(accountId);
    const assetsById = new Map(assets.map((asset) => [asset.mediaId, asset]));
    const projectAssets = new Map<string, SocialMediaAsset>();
    const allMediaIds = collectProjectExportMediaIds(project);
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.kind === "text") continue;
        const asset = assetsById.get(clip.mediaId);
        if (!asset || asset.mediaKind !== clip.kind) {
          throw new SocialProjectExportRenderError("invalid-media");
        }
      }
    }
    for (const mediaId of allMediaIds) {
      const asset = assetsById.get(mediaId);
      if (!asset) throw new SocialProjectExportRenderError("invalid-media");
      projectAssets.set(mediaId, asset);
    }
    return projectAssets;
  }

  async function renderOne(record: SocialProjectExportRecord): Promise<void> {
    const { job, snapshot } = record;
    const controller = new AbortController();
    active.set(job.exportId, controller);
    let claimed = false;
    try {
      const startedAt = now();
      const claimedRecord = await options.store.update(job.accountId, job.exportId, (current) => {
        if (current.job.status !== "queued") return current;
        claimed = true;
        return {
          ...current,
          job: socialProjectExportJobSchema.parse({
            ...current.job,
            status: "rendering",
            progressPercent: 0,
            updatedAt: Math.max(current.job.updatedAt + 1, Math.trunc(startedAt)),
            errorCode: undefined,
          }),
        };
      });
      if (!claimed || !claimedRecord) return;
      emit(claimedRecord.job);
      await options.renderer.discard(job.exportId);
      const mediaAssets = await validateMedia(snapshot, job.accountId);
      let progressWrites = Promise.resolve();
      let progressWriteError: unknown;
      const rendered = await options.renderer.render({
        project: snapshot,
        exportId: job.exportId,
        mediaAssets,
        signal: controller.signal,
        onProgress(progressPercent) {
          if (controller.signal.aborted) return;
          const progress = Math.max(0, Math.min(99, Math.floor(progressPercent)));
          progressWrites = progressWrites.then(async () => {
            await updateJob(job.accountId, job.exportId, (current) =>
              current.status !== "rendering" || progress <= current.progressPercent
                ? current
                : {
                    ...current,
                    progressPercent: progress,
                    updatedAt: Math.max(current.updatedAt + 1, Math.trunc(now())),
                  },
            );
          });
          void progressWrites.catch((error: unknown) => {
            progressWriteError = error;
          });
        },
      });
      await progressWrites;
      if (progressWriteError) throw progressWriteError;
      if (controller.signal.aborted) throw new SocialProjectExportRenderError("render-failed");
      if (rendered.fileSizeBytes <= 0 || !/^[\da-f]{64}$/.test(rendered.sha256)) {
        throw new SocialProjectExportRenderError("verification-failed");
      }
      await updateJob(job.accountId, job.exportId, (current) => ({
        ...current,
        status: "completed",
        progressPercent: 100,
        durationMs: Math.max(1, Math.trunc(rendered.durationMs)),
        fileSizeBytes: rendered.fileSizeBytes,
        sha256: rendered.sha256,
        updatedAt: Math.max(current.updatedAt + 1, Math.trunc(now())),
        errorCode: undefined,
      }));
    } catch (error) {
      await options.renderer.discard(job.exportId).catch(() => undefined);
      const cancelled = controller.signal.aborted;
      const errorCode =
        error instanceof SocialProjectExportRenderError ? error.code : ("render-failed" as const);
      if (!cancelled) {
        logger.warn(undefined, "project export failed", {
          accountId: job.accountId,
          exportId: job.exportId,
          projectId: job.projectId,
          errorCode,
        });
      }
      await updateJob(job.accountId, job.exportId, (current) => ({
        ...current,
        status: cancelled ? "cancelled" : "failed",
        progressPercent: cancelled ? current.progressPercent : 0,
        updatedAt: Math.max(current.updatedAt + 1, Math.trunc(now())),
        ...(cancelled ? { errorCode: undefined } : { errorCode }),
      }));
    } finally {
      active.delete(job.exportId);
    }
  }

  async function pump(): Promise<void> {
    if (pumping) {
      pumpRequested = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpRequested = false;
        while (true) {
          const next = (await options.store.listAll())
            .filter(({ job }) => job.status === "queued")
            .sort((left, right) => left.job.createdAt - right.job.createdAt)[0];
          if (!next) break;
          activeCompletion = renderOne(next);
          try {
            await activeCompletion;
          } finally {
            activeCompletion = null;
          }
        }
      } while (pumpRequested);
    } finally {
      pumping = false;
      if (pumpRequested) {
        pumpRequested = false;
        void pump().catch(() => {
          logger.error(undefined, "project export worker stopped");
        });
      }
    }
  }

  const ready = (async () => {
    for (const record of await options.store.listAll()) {
      if (record.job.status !== "queued" && record.job.status !== "rendering") continue;
      await options.renderer.discard(record.job.exportId);
      if (record.job.status === "rendering") {
        await updateJob(record.job.accountId, record.job.exportId, (current) => ({
          ...current,
          status: "queued",
          progressPercent: 0,
          updatedAt: Math.max(current.updatedAt + 1, Math.trunc(now())),
        }));
      }
    }
    void pump().catch(() => {
      logger.error(undefined, "project export recovery worker stopped");
    });
  })();

  return {
    async startExport(input: SocialProjectExportRequest) {
      await ready;
      const request = socialProjectExportRequestSchema.parse(input);
      const accountId = socialAccountIdSchema.parse(request.accountId);
      const previous = (await options.store.list(accountId)).find(
        ({ job }) => job.requestId === request.requestId,
      );
      if (previous) {
        if (
          previous.job.projectId !== request.projectId ||
          previous.job.projectRevision !== request.expectedRevision
        ) {
          throw new SocialProjectExportRequestConflictError(request.requestId);
        }
        return previous.job;
      }
      const account = await options.socialAccountService.get(accountId);
      if (!account) throw new SocialProjectAccountNotFoundError(accountId);
      const projectId = socialProjectIdSchema.parse(request.projectId);
      const readModel = await options.projectService.get(accountId, projectId);
      if (!readModel) throw new SocialProjectNotFoundError(accountId, projectId);
      if (readModel.project.revision !== request.expectedRevision) {
        throw new SocialProjectExportRevisionConflictError(projectId, readModel.project.revision);
      }
      await validateMedia(readModel.project, accountId);
      const exportId = socialProjectIdSchema.parse(createExportId());
      const timestamp = Math.max(0, Math.trunc(now()));
      const job = socialProjectExportJobSchema.parse({
        exportId,
        requestId: request.requestId,
        accountId,
        projectId,
        projectRevision: readModel.project.revision,
        status: "queued",
        progressPercent: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const created = await options.store.createIfAbsent({
        job,
        snapshot: structuredClone(readModel.project),
      });
      if (!created.created) {
        if (
          created.record.job.projectId !== request.projectId ||
          created.record.job.projectRevision !== request.expectedRevision
        ) {
          throw new SocialProjectExportRequestConflictError(request.requestId);
        }
        return created.record.job;
      }
      const record = created.record;
      emit(record.job);
      void pump().catch(() => {
        logger.error(undefined, "project export worker stopped");
      });
      return record.job;
    },
    async getExport(accountIdInput: string, exportIdInput: string) {
      await ready;
      const accountId = socialAccountIdSchema.parse(accountIdInput);
      const exportId = socialProjectIdSchema.parse(exportIdInput);
      return (await options.store.get(accountId, exportId))?.job ?? null;
    },
    async listExports(accountIdInput: string, projectIdInput?: string) {
      await ready;
      const accountId = socialAccountIdSchema.parse(accountIdInput);
      const projectId = projectIdInput ? socialProjectIdSchema.parse(projectIdInput) : undefined;
      return (await options.store.list(accountId, projectId))
        .sort((left, right) => right.job.createdAt - left.job.createdAt)
        .map(({ job }) => job);
    },
    async cancelExport(input: SocialProjectExportCancelRequest) {
      await ready;
      const request = socialProjectExportCancelRequestSchema.parse(input);
      let changedJob = false;
      const record = await options.store.update(request.accountId, request.exportId, (current) => {
        if (current.job.status !== "queued") return current;
        changedJob = true;
        return {
          ...current,
          job: socialProjectExportJobSchema.parse({
            ...current.job,
            status: "cancelled",
            updatedAt: Math.max(current.job.updatedAt + 1, Math.trunc(now())),
          }),
        };
      });
      if (!record) throw new SocialProjectExportUnavailableError();
      if (changedJob) {
        emit(record.job);
        return record.job;
      }
      const controller = active.get(request.exportId);
      if (controller) {
        controller.abort();
        await activeCompletion;
      }
      return (await options.store.get(request.accountId, request.exportId))?.job ?? record.job;
    },
    async prepareExportDownload(input: SocialProjectExportDownloadRequest) {
      await ready;
      const request = socialProjectExportDownloadRequestSchema.parse(input);
      const record = await options.store.get(request.accountId, request.exportId);
      if (!record || record.job.status !== "completed") {
        throw new SocialProjectExportUnavailableError();
      }
      if (!record.job.sha256 || !record.job.fileSizeBytes) {
        throw new SocialProjectExportUnavailableError();
      }
      let capability: { url: string; expiresAt: number };
      try {
        capability = await options.renderer.createDownloadUrl({
          exportId: record.job.exportId,
          sha256: record.job.sha256,
          fileSizeBytes: record.job.fileSizeBytes,
        });
      } catch {
        throw new SocialProjectExportUnavailableError();
      }
      return {
        ...capability,
        suggestedName: `${record.job.projectId}-r${record.job.projectRevision}.mp4`,
      } satisfies SocialProjectExportDownload;
    },
    onExportChanged: changed.event,
  };
}
