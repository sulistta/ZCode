import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileLock } from "@social-harness/shared/node";
import { socialMediaAssetSchema, socialMediaJobSchema } from "@social-harness/shared";
import type { SocialMediaStore } from "../app/ports/socialMediaStore.js";
import {
  readSocialMediaCatalog,
  writeSocialMediaCatalog,
} from "./socialMediaCatalogPersistence.js";

export async function completeSocialMediaPreviewProxy(
  options: { catalogPath: string; originalsDir: string; jobsDir: string },
  input: Parameters<SocialMediaStore["completePreviewProxy"]>[0],
) {
  const directory = await realpath(join(options.jobsDir, input.job.jobId));
  const info = await lstat(input.outputPath);
  const outputPath = await realpath(input.outputPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    dirname(outputPath) !== directory ||
    info.size < 1 ||
    info.size > 4 * 1024 ** 3
  ) {
    throw new Error("Invalid preview output");
  }
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(outputPath)) {
    sizeBytes += chunk.length;
    if (sizeBytes > 4 * 1024 ** 3) throw new Error("Preview output exceeded its limit");
    hash.update(chunk);
  }
  const sha256 = hash.digest("hex");
  return withFileLock(options.catalogPath, async () => {
    const catalog = await readSocialMediaCatalog(options.catalogPath);
    const jobIndex = catalog.jobs.findIndex(
      (job) => job.accountId === input.job.accountId && job.jobId === input.job.jobId,
    );
    const assetIndex = catalog.assets.findIndex(
      (asset) => asset.accountId === input.job.accountId && asset.mediaId === input.asset.mediaId,
    );
    const currentJob = catalog.jobs[jobIndex];
    const currentAsset = catalog.assets[assetIndex];
    // 取消与完成争用同一目录锁；只允许仍在 proxying 的同账户、同原始哈希工作提交。
    if (
      !currentJob ||
      !currentAsset ||
      currentJob.sourceKind !== "preview-proxy" ||
      currentJob.state !== "proxying" ||
      currentJob.mediaId !== currentAsset.mediaId ||
      currentAsset.sha256 !== input.asset.sha256 ||
      currentAsset.mediaKind !== "video"
    )
      return null;
    const asset = socialMediaAssetSchema.parse({
      ...currentAsset,
      previewProxy: {
        profileVersion: 1,
        sourceSha256: currentAsset.sha256,
        sha256,
        sizeBytes,
        durationSeconds: input.durationSeconds,
        createdAt: input.updatedAt,
      },
    });
    const job = socialMediaJobSchema.parse({
      ...currentJob,
      state: "completed",
      errorCode: null,
      downloadedBytes: sizeBytes,
      processedSeconds: input.durationSeconds,
      durationSeconds: input.durationSeconds,
      updatedAt: input.updatedAt,
    });
    const accountDir = join(options.originalsDir, asset.accountId);
    await mkdir(accountDir, { recursive: true, mode: 0o700 });
    const target = join(accountDir, `${asset.mediaId}.preview-v1.mp4`);
    await chmod(outputPath, 0o600);
    await rename(outputPath, target);
    try {
      catalog.assets[assetIndex] = asset;
      catalog.jobs[jobIndex] = job;
      await writeSocialMediaCatalog(options.catalogPath, catalog);
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    return { asset, job };
  });
}
