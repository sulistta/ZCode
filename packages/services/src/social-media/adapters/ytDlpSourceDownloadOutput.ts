import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  socialMediaHeatmapSegmentSchema,
  socialMediaSourceKeySchema,
  socialMediaYouTubeUploadDateSchema,
  type SocialMediaHeatmapSegment,
} from "@social-harness/shared";
import type {
  SocialMediaSourceDownloadOutput,
  SocialMediaSubtitleFile,
} from "../app/ports/socialMediaSourceDownload.js";
import { SocialMediaSourceDownloadOutputError } from "../app/errors.js";
import { resolveMediaFileType } from "../domain/mediaFileType.js";

const MAX_INFO_JSON_BYTES = 5 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_SUBTITLE_BYTES = 20 * 1024 * 1024;
const MAX_SUBTITLE_TRACKS = 4;
const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;

type InfoRecord = Record<string, unknown>;

function recordOrNull(value: unknown): InfoRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as InfoRecord)
    : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function nonnegativeFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonnegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseUploadDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;
  const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = socialMediaYouTubeUploadDateSchema.safeParse(formatted);
  return parsed.success ? parsed.data : null;
}

function parseHeatmap(value: unknown, durationSeconds: number | null): SocialMediaHeatmapSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: SocialMediaHeatmapSegment[] = [];
  for (const candidate of value.slice(0, 5_000)) {
    const record = recordOrNull(candidate);
    if (!record) continue;
    const parsed = socialMediaHeatmapSegmentSchema.safeParse({
      startSeconds: record.start_time,
      endSeconds: record.end_time,
      intensity: record.value,
    });
    if (
      !parsed.success ||
      (durationSeconds !== null && parsed.data.endSeconds > durationSeconds + 1)
    ) {
      continue;
    }
    segments.push(parsed.data);
  }
  return segments;
}

async function hashFile(path: string): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    if (sizeBytes > MAX_SUBTITLE_BYTES) throw new SocialMediaSourceDownloadOutputError();
    hash.update(buffer);
  }
  if (sizeBytes === 0) throw new SocialMediaSourceDownloadOutputError();
  return { sizeBytes, sha256: hash.digest("hex") };
}

async function readSubtitleFiles(
  workingDirectory: string,
  sourceKey: string,
  automaticCaptions: unknown,
): Promise<SocialMediaSubtitleFile[]> {
  const automaticLanguages = new Set(
    Object.keys(recordOrNull(automaticCaptions) ?? {}).map((language) => language.toLowerCase()),
  );
  const files = (await readdir(workingDirectory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && entry.name.startsWith(`${sourceKey}.`) && entry.name.endsWith(".vtt"),
    )
    .slice(0, MAX_SUBTITLE_TRACKS);
  const results: SocialMediaSubtitleFile[] = [];
  let totalBytes = 0;
  for (const entry of files) {
    const match = new RegExp(`^${sourceKey}\\.([A-Za-z0-9-]{2,32})\\.vtt$`).exec(entry.name);
    if (!match) continue;
    const path = join(workingDirectory, entry.name);
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_SUBTITLE_BYTES) continue;
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_SUBTITLE_BYTES) break;
    const digest = await hashFile(path);
    const languageCode = match[1]!;
    results.push({
      languageCode,
      automatic: automaticLanguages.has(languageCode.toLowerCase()),
      extension: ".vtt",
      path,
      ...digest,
    });
  }
  return results;
}

export async function parseYtDlpSourceDownloadOutput(
  workingDirectory: string,
  untrustedSourceKey: string,
): Promise<SocialMediaSourceDownloadOutput> {
  const sourceKey = socialMediaSourceKeySchema.parse(untrustedSourceKey);
  const infoPath = join(workingDirectory, `${sourceKey}.info.json`);
  let info: InfoRecord;
  try {
    const infoStat = await stat(infoPath);
    if (!infoStat.isFile() || infoStat.size > MAX_INFO_JSON_BYTES) {
      throw new SocialMediaSourceDownloadOutputError();
    }
    info = recordOrNull(JSON.parse(await readFile(infoPath, "utf8")) as unknown) ?? {};
  } catch {
    throw new SocialMediaSourceDownloadOutputError();
  } finally {
    await rm(infoPath, { force: true }).catch(() => undefined);
  }

  const mediaEntries = (await readdir(workingDirectory, { withFileTypes: true })).filter(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith(`${sourceKey}.`) &&
      !entry.name.endsWith(".part") &&
      !entry.name.endsWith(".info.json") &&
      !entry.name.endsWith(".vtt"),
  );
  if (mediaEntries.length !== 1) throw new SocialMediaSourceDownloadOutputError();
  const mediaEntry = mediaEntries[0]!;
  const extension = extname(mediaEntry.name).toLowerCase();
  const fileType = resolveMediaFileType(extension);
  if (!fileType || fileType.mediaKind === "image") {
    throw new SocialMediaSourceDownloadOutputError();
  }
  const mediaPath = join(workingDirectory, mediaEntry.name);
  const mediaInfo = await stat(mediaPath);
  if (!mediaInfo.isFile() || mediaInfo.size < 1 || mediaInfo.size > MAX_MEDIA_BYTES) {
    throw new SocialMediaSourceDownloadOutputError();
  }
  const title = boundedText(info.title, 1000);
  if (!title) throw new SocialMediaSourceDownloadOutputError();
  const durationSeconds = nonnegativeFinite(info.duration);
  const subtitles = await readSubtitleFiles(workingDirectory, sourceKey, info.automatic_captions);

  return {
    mediaPath,
    title,
    channel: boundedText(info.channel, 500) ?? boundedText(info.uploader, 500),
    durationSeconds,
    viewCount: nonnegativeSafeInteger(info.view_count),
    uploadDate: parseUploadDate(info.upload_date),
    heatmap: parseHeatmap(info.heatmap, durationSeconds),
    subtitles,
  };
}
