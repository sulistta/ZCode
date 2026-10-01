import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { withFileLock } from "@social-harness/shared/node";
import {
  socialMediaAssetSchema,
  socialMediaJobSchema,
  socialMediaSubtitleTrackSchema,
  type SocialMediaSubtitleTrack,
} from "@social-harness/shared";
import type { SocialMediaSourceUrlFinalizationInput } from "../app/ports/socialMediaStore.js";
import { resolveMediaFileType } from "../domain/mediaFileType.js";
import {
  readSocialMediaCatalog,
  writeSocialMediaCatalog,
} from "./socialMediaCatalogPersistence.js";

async function hashPath(
  path: string,
  maximumSizeBytes: number,
): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    if (sizeBytes > maximumSizeBytes) throw new Error("Media job output exceeded its size limit");
    hash.update(buffer);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

function safeOriginalName(title: string, extension: string): string {
  const safeTitle = title
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${safeTitle || "video"}${extension}`;
}

async function assertManagedRegularFile(path: string, directory: string): Promise<string> {
  const [directoryPath, pathInfo] = await Promise.all([realpath(directory), lstat(path)]);
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
    throw new Error("Media job output must be a regular file");
  }
  const resolvedPath = await realpath(path);
  const relativePath = relative(directoryPath, resolvedPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Media job output escaped its managed staging directory");
  }
  if (dirname(resolvedPath) !== directoryPath) {
    throw new Error("Media job output must be directly inside its staging directory");
  }
  return resolvedPath;
}

export async function finalizeSocialMediaSourceUrlDownload(input: {
  catalogPath: string;
  jobsDir: string;
  originalsDir: string;
  data: SocialMediaSourceUrlFinalizationInput;
}) {
  const { data } = input;
  const jobDirectory = join(input.jobsDir, socialMediaJobSchema.shape.jobId.parse(data.job.jobId));
  const mediaPath = await assertManagedRegularFile(data.mediaPath, jobDirectory);
  const extension = extname(mediaPath).toLowerCase();
  const fileType = resolveMediaFileType(extension);
  if (!fileType || fileType.mediaKind === "image") throw new Error("Unsupported media output type");
  const mediaDigest = await hashPath(mediaPath, 4 * 1024 * 1024 * 1024);
  if (mediaDigest.sizeBytes < 1 || mediaDigest.sizeBytes > 4 * 1024 * 1024 * 1024) {
    throw new Error("Media output exceeded the size limit");
  }

  const subtitleTracks: SocialMediaSubtitleTrack[] = [];
  const subtitleSources: Array<{ source: string; target: string }> = [];
  const languageCodes = new Set<string>();
  let totalSubtitleBytes = 0;
  for (const subtitle of data.subtitles.slice(0, 4)) {
    const track = socialMediaSubtitleTrackSchema.parse(subtitle);
    if (languageCodes.has(track.languageCode.toLowerCase())) continue;
    languageCodes.add(track.languageCode.toLowerCase());
    const source = await assertManagedRegularFile(subtitle.path, jobDirectory);
    const digest = await hashPath(source, 10 * 1024 * 1024);
    if (
      digest.sizeBytes < 1 ||
      digest.sizeBytes > 10 * 1024 * 1024 ||
      digest.sizeBytes !== track.sizeBytes ||
      digest.sha256 !== track.sha256
    ) {
      throw new Error("Media subtitle failed integrity validation");
    }
    totalSubtitleBytes += digest.sizeBytes;
    if (totalSubtitleBytes > 20 * 1024 * 1024)
      throw new Error("Media subtitles exceeded the size limit");
    subtitleTracks.push(track);
    subtitleSources.push({ source, target: `${data.job.jobId}.${track.languageCode}.vtt` });
  }

  return withFileLock(input.catalogPath, async () => {
    const catalog = await readSocialMediaCatalog(input.catalogPath);
    const jobIndex = catalog.jobs.findIndex(
      (job) => job.accountId === data.job.accountId && job.jobId === data.job.jobId,
    );
    if (jobIndex < 0) throw new Error("Media download job disappeared before finalization");
    const currentJob = catalog.jobs[jobIndex]!;
    if (currentJob.state !== "finalizing")
      throw new Error("Media download job is no longer finalizing");
    if (catalog.assets.some((asset) => asset.mediaId === data.job.jobId)) {
      throw new Error("Media asset already exists for this job");
    }

    const accountDir = join(input.originalsDir, data.job.accountId);
    await mkdir(accountDir, { recursive: true, mode: 0o700 });
    const mediaTarget = join(accountDir, `${data.job.jobId}${extension}`);
    const movedTargets: string[] = [];
    try {
      await rename(mediaPath, mediaTarget);
      movedTargets.push(mediaTarget);
      for (const subtitle of subtitleSources) {
        const target = join(accountDir, subtitle.target);
        await rename(subtitle.source, target);
        movedTargets.push(target);
      }
      const asset = socialMediaAssetSchema.parse({
        mediaId: data.job.jobId,
        accountId: data.job.accountId,
        sourceKind: data.job.sourceKind,
        sourceOrigin: data.job.sourceOrigin,
        originalName: safeOriginalName(data.title, extension),
        mediaKind: fileType.mediaKind,
        extension,
        mimeType: fileType.mimeType,
        sizeBytes: mediaDigest.sizeBytes,
        sha256: mediaDigest.sha256,
        importedAt: data.importedAt,
        ...(data.job.sourceVideoId ? { sourceVideoId: data.job.sourceVideoId } : {}),
        sourceUrl: data.job.sourceUrl,
        sourceTitle: data.title,
        sourceChannel: data.channel,
        sourceDurationSeconds: data.durationSeconds,
        sourceViewCount: data.viewCount,
        sourceUploadDate: data.uploadDate,
        subtitleTracks,
        heatmap: data.heatmap,
      });
      const jobs = [...catalog.jobs];
      jobs[jobIndex] = socialMediaJobSchema.parse({
        ...currentJob,
        state: "transcribing",
        downloadedBytes: mediaDigest.sizeBytes,
        totalBytes: mediaDigest.sizeBytes,
        etaSeconds: null,
        mediaId: asset.mediaId,
        errorCode: null,
        updatedAt: data.importedAt,
      });
      await writeSocialMediaCatalog(input.catalogPath, {
        ...catalog,
        assets: [...catalog.assets, asset],
        jobs,
      });
      return asset;
    } catch (error) {
      await Promise.all(movedTargets.map((path) => rm(path, { force: true })));
      throw error;
    }
  });
}
