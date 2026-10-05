import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { withFileLock } from "@social-harness/shared/node";
import {
  socialMediaAssetSchema,
  socialMediaJobSchema,
  socialMediaTranscriptSchema,
  type SocialMediaAsset,
  type SocialMediaLocalFileImportRequest,
  type SocialMediaTranscript,
} from "@social-harness/shared";
import type {
  SocialMediaStore,
  SocialMediaSubtitleContent,
  SocialMediaSourceUrlFinalizationInput,
} from "../app/ports/socialMediaStore.js";
import { resolveMediaFileType } from "../domain/mediaFileType.js";
import {
  readSocialMediaCatalog,
  writeSocialMediaCatalog,
} from "./socialMediaCatalogPersistence.js";
import { finalizeSocialMediaSourceUrlDownload } from "./socialMediaDownloadFinalizer.js";
import {
  getManagedOriginalPath,
  getManagedPreviewProxyPath,
  readValidSubtitleContents,
} from "./socialMediaAssetFiles.js";
import {
  cleanupSocialMediaJobWorkingDirectory,
  createSocialMediaJobWorkingDirectory,
  discardSocialMediaNonResumableOutput,
} from "./socialMediaJobDirectories.js";

import { completeSocialMediaPreviewProxy } from "./socialMediaPreviewProxyPersistence.js";

interface SocialMediaFileStoreOptions {
  catalogPath: string;
  originalsDir: string;
  jobsDir?: string;
  jobQueueLockPath?: string;
}

export function createSocialMediaFileStore(options: SocialMediaFileStoreOptions): SocialMediaStore {
  const jobsDir = options.jobsDir ?? join(dirname(options.catalogPath), "jobs");
  const jobQueueLockPath = options.jobQueueLockPath ?? `${options.catalogPath}.jobs-queue`;

  async function removeUncataloguedFiles(
    accountId: string,
    assets: SocialMediaAsset[],
  ): Promise<void> {
    const accountDir = join(options.originalsDir, accountId);
    let entries;
    try {
      entries = await readdir(accountDir, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    const known = new Set<string>();
    for (const asset of assets.filter((item) => item.accountId === accountId)) {
      known.add(`${asset.mediaId}${asset.extension}`);
      if (asset.previewProxy) known.add(`${asset.mediaId}.preview-v1.mp4`);
      for (const subtitle of asset.subtitleTracks ?? []) {
        known.add(`${asset.mediaId}.${subtitle.languageCode}.vtt`);
      }
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !known.has(entry.name))
        .map((entry) => rm(join(accountDir, entry.name), { force: true })),
    );
  }

  return {
    async list(accountId) {
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        await removeUncataloguedFiles(accountId, catalog.assets);
        return catalog.assets.filter((asset) => asset.accountId === accountId);
      });
    },
    async getAsset(accountId, mediaId) {
      return withFileLock(
        options.catalogPath,
        async () =>
          (await readSocialMediaCatalog(options.catalogPath)).assets.find(
            (asset) => asset.accountId === accountId && asset.mediaId === mediaId,
          ) ?? null,
      );
    },
    async listJobs(accountId) {
      return withFileLock(options.catalogPath, async () =>
        (await readSocialMediaCatalog(options.catalogPath)).jobs
          .filter((job) => job.accountId === accountId)
          .sort((first, second) => first.createdAt - second.createdAt),
      );
    },
    async importLocalFile(
      input: SocialMediaLocalFileImportRequest & { mediaId: string; importedAt: number },
    ) {
      if (!isAbsolute(input.sourcePath)) throw new Error("A native absolute file path is required");
      const originalName = basename(input.sourcePath);
      const extension = extname(originalName).toLowerCase();
      const fileType = resolveMediaFileType(extension);
      if (!fileType) throw new Error("Unsupported local media file type");

      const sourceInfo = await stat(input.sourcePath);
      if (!sourceInfo.isFile()) throw new Error("The selected path is not a regular file");
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        if (catalog.assets.some((asset) => asset.mediaId === input.mediaId)) {
          throw new Error(`Social media item already exists: ${input.mediaId}`);
        }
        const accountDir = join(options.originalsDir, input.accountId);
        await mkdir(accountDir, { recursive: true, mode: 0o700 });
        const stagedPath = join(accountDir, `.${input.mediaId}${extension}.partial`);
        const managedPath = join(accountDir, `${input.mediaId}${extension}`);
        const hash = createHash("sha256");
        const hashWhileCopying = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        try {
          await pipeline(
            createReadStream(input.sourcePath),
            hashWhileCopying,
            createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }),
          );
          const copiedInfo = await stat(stagedPath);
          if (!copiedInfo.isFile() || copiedInfo.size === 0) {
            throw new Error("The selected media file is empty or unreadable");
          }
          await rename(stagedPath, managedPath);
          const asset = socialMediaAssetSchema.parse({
            mediaId: input.mediaId,
            accountId: input.accountId,
            sourceKind: "local-file",
            originalName,
            mediaKind: fileType.mediaKind,
            extension,
            mimeType: fileType.mimeType,
            sizeBytes: copiedInfo.size,
            sha256: hash.digest("hex"),
            importedAt: input.importedAt,
          });
          await writeSocialMediaCatalog(options.catalogPath, {
            ...catalog,
            assets: [...catalog.assets, asset],
          });
          return asset;
        } catch (error) {
          await Promise.all([rm(stagedPath, { force: true }), rm(managedPath, { force: true })]);
          throw error;
        }
      });
    },
    async createOrGetJob(job) {
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        const sourceKey = job.sourceKey ?? job.sourceVideoId;
        const existing = catalog.jobs.find(
          (record) =>
            record.accountId === job.accountId &&
            record.sourceKind === job.sourceKind &&
            (record.sourceKey ?? record.sourceVideoId) === sourceKey,
        );
        if (existing) return { job: existing, created: false };
        const parsed = socialMediaJobSchema.parse(job);
        await writeSocialMediaCatalog(options.catalogPath, {
          ...catalog,
          jobs: [...catalog.jobs, parsed],
        });
        return { job: parsed, created: true };
      });
    },
    async getJob(accountId, jobId) {
      return withFileLock(
        options.catalogPath,
        async () =>
          (await readSocialMediaCatalog(options.catalogPath)).jobs.find(
            (job) => job.accountId === accountId && job.jobId === jobId,
          ) ?? null,
      );
    },
    async updateJob(accountId, jobId, expectedStates, update) {
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        const index = catalog.jobs.findIndex(
          (job) => job.accountId === accountId && job.jobId === jobId,
        );
        if (index < 0) return null;
        const current = catalog.jobs[index]!;
        if (!expectedStates.includes(current.state)) return current;
        const next = socialMediaJobSchema.parse({
          ...current,
          ...update,
          jobId: current.jobId,
          accountId: current.accountId,
          sourceKind: current.sourceKind,
          sourceKey: current.sourceKey,
          sourceOrigin: current.sourceOrigin,
          sourceVideoId: current.sourceVideoId,
          sourceUrl: current.sourceUrl,
          createdAt: current.createdAt,
        });
        const jobs = [...catalog.jobs];
        jobs[index] = next;
        await writeSocialMediaCatalog(options.catalogPath, { ...catalog, jobs });
        return next;
      });
    },
    async requestCancel(accountId, jobId, updatedAt) {
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        const index = catalog.jobs.findIndex(
          (job) => job.accountId === accountId && job.jobId === jobId,
        );
        if (index < 0) return null;
        const current = catalog.jobs[index]!;
        if (current.state === "queued") {
          const jobs = [...catalog.jobs];
          jobs[index] = socialMediaJobSchema.parse({
            ...current,
            state: "cancelled",
            errorCode: null,
            updatedAt,
          });
          await writeSocialMediaCatalog(options.catalogPath, { ...catalog, jobs });
          return jobs[index]!;
        }
        if (
          current.state !== "downloading" &&
          current.state !== "finalizing" &&
          current.state !== "transcribing" &&
          current.state !== "proxying"
        ) {
          return current;
        }
        const jobs = [...catalog.jobs];
        jobs[index] = socialMediaJobSchema.parse({ ...current, state: "cancelling", updatedAt });
        await writeSocialMediaCatalog(options.catalogPath, { ...catalog, jobs });
        return jobs[index]!;
      });
    },
    async recoverInterruptedJobs(updatedAt) {
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        let changed = false;
        const jobs = catalog.jobs.map((job) => {
          if (
            job.state !== "downloading" &&
            job.state !== "finalizing" &&
            job.state !== "transcribing" &&
            job.state !== "proxying" &&
            job.state !== "cancelling"
          ) {
            return job;
          }
          changed = true;
          return socialMediaJobSchema.parse({
            ...job,
            state: job.state === "cancelling" ? "cancelled" : "queued",
            errorCode: null,
            updatedAt,
          });
        });
        if (changed) await writeSocialMediaCatalog(options.catalogPath, { ...catalog, jobs });
        if (!changed) return [];
        return jobs.filter((job, index) => job.state !== catalog.jobs[index]!.state);
      });
    },
    async claimNextQueuedJob(updatedAt) {
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        const index = catalog.jobs.findIndex((job) => job.state === "queued");
        if (index < 0) return null;
        const jobs = [...catalog.jobs];
        jobs[index] = socialMediaJobSchema.parse({
          ...jobs[index]!,
          state:
            jobs[index]!.sourceKind === "preview-proxy"
              ? "proxying"
              : jobs[index]!.mediaId
                ? "transcribing"
                : "downloading",
          errorCode: null,
          updatedAt,
        });
        await writeSocialMediaCatalog(options.catalogPath, { ...catalog, jobs });
        return jobs[index]!;
      });
    },
    async createJobWorkingDirectory(jobId) {
      return createSocialMediaJobWorkingDirectory(jobsDir, jobId);
    },
    async cleanupJobWorkingDirectory(jobId) {
      await cleanupSocialMediaJobWorkingDirectory(jobsDir, jobId);
    },
    async discardNonResumableJobOutput(jobId, sourceKey) {
      await discardSocialMediaNonResumableOutput(jobsDir, jobId, sourceKey);
    },
    finalizeSourceUrlDownload(input: SocialMediaSourceUrlFinalizationInput) {
      return finalizeSocialMediaSourceUrlDownload({
        catalogPath: options.catalogPath,
        jobsDir,
        originalsDir: options.originalsDir,
        data: input,
      });
    },
    getManagedOriginalPath(asset: SocialMediaAsset) {
      return getManagedOriginalPath(asset, options.originalsDir);
    },
    getManagedPreviewProxyPath(asset) {
      return getManagedPreviewProxyPath(asset, options.originalsDir);
    },
    completePreviewProxy(input) {
      return completeSocialMediaPreviewProxy({ ...options, jobsDir }, input);
    },
    readValidSubtitleContents(asset: SocialMediaAsset): Promise<SocialMediaSubtitleContent[]> {
      return readValidSubtitleContents(asset, options.originalsDir);
    },
    async completeTranscription(input: {
      accountId: string;
      jobId: string;
      mediaId: string;
      transcript: SocialMediaTranscript;
      updatedAt: number;
    }) {
      const transcript = socialMediaTranscriptSchema.parse(input.transcript);
      return withFileLock(options.catalogPath, async () => {
        const catalog = await readSocialMediaCatalog(options.catalogPath);
        const assetIndex = catalog.assets.findIndex(
          (asset) => asset.accountId === input.accountId && asset.mediaId === input.mediaId,
        );
        const jobIndex = catalog.jobs.findIndex(
          (job) => job.accountId === input.accountId && job.jobId === input.jobId,
        );
        if (assetIndex < 0 || jobIndex < 0) return null;
        const currentAsset = catalog.assets[assetIndex]!;
        const currentJob = catalog.jobs[jobIndex]!;
        if (
          currentJob.state !== "transcribing" ||
          currentJob.mediaId !== input.mediaId ||
          currentAsset.sourceKind !== currentJob.sourceKind ||
          currentAsset.sourceUrl !== currentJob.sourceUrl ||
          currentAsset.sourceVideoId !== currentJob.sourceVideoId
        ) {
          return null;
        }
        const asset = socialMediaAssetSchema.parse({ ...currentAsset, transcript });
        const job = socialMediaJobSchema.parse({
          ...currentJob,
          state: "completed",
          errorCode: null,
          updatedAt: input.updatedAt,
        });
        const assets = [...catalog.assets];
        const jobs = [...catalog.jobs];
        assets[assetIndex] = asset;
        jobs[jobIndex] = job;
        await writeSocialMediaCatalog(options.catalogPath, { ...catalog, assets, jobs });
        return { asset, job };
      });
    },
    withJobQueueLock<T>(operation: () => Promise<T>) {
      return withFileLock(jobQueueLockPath, operation, { lockMaxWaitMs: 1_500 });
    },
  };
}
