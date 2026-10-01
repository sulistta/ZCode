import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SocialMediaAsset } from "@social-harness/shared";
import type { SocialMediaSubtitleContent } from "../app/ports/socialMediaStore.js";

const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;

async function resolvePrivateAssetFile(
  asset: SocialMediaAsset,
  originalsDir: string,
  fileName: string,
  maximumBytes: number,
): Promise<string | null> {
  const accountDirectory = join(originalsDir, asset.accountId);
  const path = join(accountDirectory, fileName);
  try {
    const [rootPath, pathInfo] = await Promise.all([realpath(accountDirectory), lstat(path)]);
    const actualPath = await realpath(path);
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      dirname(actualPath) !== rootPath ||
      pathInfo.size < 1 ||
      pathInfo.size > maximumBytes
    ) {
      return null;
    }
    return actualPath;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function hashManagedFile(path: string, maximumBytes: number) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    if (sizeBytes > maximumBytes) return null;
    hash.update(buffer);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

export async function getManagedOriginalPath(
  asset: SocialMediaAsset,
  originalsDir: string,
): Promise<string> {
  const path = await resolvePrivateAssetFile(
    asset,
    originalsDir,
    `${asset.mediaId}${asset.extension}`,
    MAX_MEDIA_BYTES,
  );
  if (!path) throw new Error("The managed source file is missing or invalid");
  const digest = await hashManagedFile(path, MAX_MEDIA_BYTES);
  if (!digest || digest.sizeBytes !== asset.sizeBytes || digest.sha256 !== asset.sha256) {
    throw new Error("The managed source file failed integrity validation");
  }
  return path;
}

export async function readValidSubtitleContents(
  asset: SocialMediaAsset,
  originalsDir: string,
): Promise<SocialMediaSubtitleContent[]> {
  const results: SocialMediaSubtitleContent[] = [];
  for (const track of asset.subtitleTracks ?? []) {
    const path = await resolvePrivateAssetFile(
      asset,
      originalsDir,
      `${asset.mediaId}.${track.languageCode}.vtt`,
      MAX_SUBTITLE_BYTES,
    );
    if (!path) continue;
    const fileInfo = await stat(path);
    if (fileInfo.size !== track.sizeBytes || fileInfo.size > MAX_SUBTITLE_BYTES) continue;
    const content = await readFile(path, "utf8");
    const digest = createHash("sha256").update(content, "utf8").digest("hex");
    if (digest !== track.sha256) continue;
    results.push({
      languageCode: track.languageCode,
      automatic: track.automatic,
      content,
    });
  }
  return results;
}
