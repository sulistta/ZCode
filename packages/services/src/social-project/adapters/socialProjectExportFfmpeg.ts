import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SocialMediaAsset } from "@social-harness/shared";
import type { SocialProjectExportRenderer } from "../app/socialProjectExportService.js";
import { SocialProjectExportRenderError } from "../app/errors.js";
import { renderSocialProjectWithFfmpeg } from "./socialProjectExportFfmpegProcess.js";

interface ProjectExportFfmpegOptions {
  ffmpegExecutablePath?: string;
  ffprobeExecutablePath?: string;
  exportDirectory: string;
  resolveMediaPath: (asset: SocialMediaAsset) => Promise<string>;
  createDownloadUrl: (path: string) => Promise<{ url: string; expiresAt: number }>;
}

function validateExportId(exportId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) {
    throw new SocialProjectExportRenderError("invalid-project");
  }
  return exportId;
}

function finalOutputPath(exportDirectory: string, exportId: string): string {
  return join(exportDirectory, `${validateExportId(exportId)}.mp4`);
}

function partialOutputPath(exportDirectory: string, exportId: string): string {
  return join(exportDirectory, `${validateExportId(exportId)}.partial.mp4`);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function createSocialProjectExportFfmpegRenderer(
  options: ProjectExportFfmpegOptions,
): SocialProjectExportRenderer {
  const ffmpegExecutable = options.ffmpegExecutablePath?.trim() || "ffmpeg";
  const ffprobeExecutable = options.ffprobeExecutablePath?.trim() || "ffprobe";
  return {
    async render(input) {
      const exportId = validateExportId(input.exportId);
      const outputPath = finalOutputPath(options.exportDirectory, exportId);
      const stagedOutputPath = partialOutputPath(options.exportDirectory, exportId);
      const mediaPaths = new Map<string, string>();
      const mediaAssets = [...input.mediaAssets.values()];
      for (const asset of mediaAssets) {
        mediaPaths.set(asset.mediaId, await options.resolveMediaPath(asset));
      }
      await mkdir(options.exportDirectory, { recursive: true, mode: 0o700 });
      await rm(stagedOutputPath, { force: true });
      await rm(outputPath, { force: true });
      const workDirectory = await mkdtemp(join(options.exportDirectory, ".social-export-"));
      try {
        const durationMs = await renderSocialProjectWithFfmpeg({
          project: input.project,
          mediaPaths,
          outputPath: stagedOutputPath,
          workDirectory,
          ffmpegExecutable,
          ffprobeExecutable,
          onProgress: input.onProgress,
          signal: input.signal,
        });
        const fileInfo = await stat(stagedOutputPath);
        if (!fileInfo.isFile() || fileInfo.size <= 0) {
          throw new SocialProjectExportRenderError("verification-failed");
        }
        const sha256 = await sha256File(stagedOutputPath);
        await rename(stagedOutputPath, outputPath);
        return { durationMs, fileSizeBytes: fileInfo.size, sha256 };
      } catch (error) {
        await rm(stagedOutputPath, { force: true }).catch(() => undefined);
        await rm(outputPath, { force: true }).catch(() => undefined);
        if (error instanceof SocialProjectExportRenderError) throw error;
        throw new SocialProjectExportRenderError("render-failed");
      } finally {
        await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async discard(exportId) {
      await Promise.all([
        rm(partialOutputPath(options.exportDirectory, exportId), { force: true }),
        rm(finalOutputPath(options.exportDirectory, exportId), { force: true }),
      ]);
    },
    async createDownloadUrl(input) {
      const outputPath = finalOutputPath(options.exportDirectory, input.exportId);
      try {
        const [root, actualPath, linkInfo] = await Promise.all([
          realpath(options.exportDirectory),
          realpath(outputPath),
          lstat(outputPath),
        ]);
        const fileInfo = await stat(actualPath);
        if (
          !linkInfo.isFile() ||
          linkInfo.isSymbolicLink() ||
          dirname(actualPath) !== root ||
          !fileInfo.isFile() ||
          fileInfo.size !== input.fileSizeBytes ||
          (await sha256File(actualPath)) !== input.sha256
        ) {
          throw new SocialProjectExportRenderError("verification-failed");
        }
        return await options.createDownloadUrl(actualPath);
      } catch {
        throw new SocialProjectExportRenderError("verification-failed");
      }
    },
  };
}
