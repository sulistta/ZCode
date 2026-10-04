import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SocialProject, SocialProjectClip } from "@social-harness/shared";
import {
  getSocialProjectContentDurationMs,
  getSocialProjectRenderableClips,
} from "@social-harness/opencut-core";
import { SocialProjectExportRenderError } from "../app/errors.js";
import {
  buildSocialProjectExportGraph,
  socialProjectClipSourceDurationMs,
} from "./socialProjectExportPlan.js";
import {
  parseSocialProjectExportProgress,
  probeSocialProjectExportMedia,
  runSocialProjectExportProcess,
} from "./socialProjectExportProcesses.js";

const SOCIAL_PROJECT_EXPORT_VIDEO_MAX_BITRATE = "25M";
const SOCIAL_PROJECT_EXPORT_VIDEO_BUFFER_SIZE = "50M";
const SOCIAL_PROJECT_EXPORT_AUDIO_BITRATE = "120k";

export interface SocialProjectExportFfmpegProcessInput {
  project: SocialProject;
  mediaPaths: ReadonlyMap<string, string>;
  outputPath: string;
  workDirectory: string;
  onProgress: (progress: number) => void;
  signal: AbortSignal;
  ffmpegExecutable: string;
  ffprobeExecutable: string;
}

function mediaClips(
  project: SocialProject,
): Array<{ clip: Exclude<SocialProjectClip, { kind: "text" }>; trackMuted: boolean }> {
  return getSocialProjectRenderableClips(project).flatMap(({ clip, track }) =>
    clip.kind === "text" ? [] : [{ clip, trackMuted: track.muted }],
  );
}

export async function renderSocialProjectWithFfmpeg(
  input: SocialProjectExportFfmpegProcessInput,
): Promise<number> {
  const project = input.project;
  const endMs = Math.ceil(getSocialProjectContentDurationMs(project));
  const durationSeconds = (endMs / 1000).toFixed(6);
  const frameRate = project.settings.frameRate;
  const frameRateValue = `${frameRate.numerator}/${frameRate.denominator}`;
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-progress",
    "pipe:1",
    "-nostats",
  ];
  const backgroundColor = `0x${project.settings.backgroundColor.slice(1)}`;
  ffmpegArgs.push(
    "-f",
    "lavfi",
    "-i",
    `color=c=${backgroundColor}:s=${project.settings.width}x${project.settings.height}:r=${frameRateValue}:d=${durationSeconds}`,
  );
  const inputIndexByClipId = new Map<string, number>();
  const textFileByClipId = new Map<string, string>();
  const clipInfoById = new Map(
    mediaClips(project).map(({ clip, trackMuted }) => [clip.clipId, { clip, trackMuted }]),
  );
  let inputIndex = 1;
  for (const { clip } of getSocialProjectRenderableClips(project)) {
    if (clip.kind === "text") {
      const filePath = join(input.workDirectory, `${clip.clipId}.txt`);
      await writeFile(filePath, clip.text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      textFileByClipId.set(clip.clipId, filePath);
      inputIndexByClipId.set(clip.clipId, inputIndex);
      ffmpegArgs.push(
        "-f",
        "lavfi",
        "-i",
        // 颜色源默认像素格式会丢掉 black@0 的 alpha；显式保留 RGBA，避免字幕底图遮住下层轨道。
        `color=c=black@0:s=${project.settings.width}x${project.settings.height}:r=${frameRateValue}:d=${(clip.durationMs / 1000).toFixed(6)},format=rgba`,
      );
      inputIndex += 1;
      continue;
    }
    inputIndexByClipId.set(clip.clipId, inputIndex);
    const mediaPath = input.mediaPaths.get(clip.mediaId);
    if (!mediaPath) throw new SocialProjectExportRenderError("invalid-media");
    if (clip.kind === "image") {
      ffmpegArgs.push(
        "-loop",
        "1",
        "-framerate",
        frameRateValue,
        "-t",
        (socialProjectClipSourceDurationMs(clip) / 1000).toFixed(6),
        "-i",
        mediaPath,
      );
    } else {
      ffmpegArgs.push(
        "-ss",
        (clip.sourceStartMs / 1000).toFixed(6),
        "-t",
        (socialProjectClipSourceDurationMs(clip) / 1000).toFixed(6),
        "-i",
        mediaPath,
      );
    }
    inputIndex += 1;
  }

  const clipsWithAudio = new Set<string>();
  const probeByMediaId = new Map<string, ReturnType<typeof probeSocialProjectExportMedia>>();
  for (const { clip, trackMuted } of clipInfoById.values()) {
    if (clip.kind === "image" || trackMuted) continue;
    let probePromise = probeByMediaId.get(clip.mediaId);
    if (!probePromise) {
      const mediaPath = input.mediaPaths.get(clip.mediaId);
      if (!mediaPath) throw new SocialProjectExportRenderError("invalid-media");
      probePromise = probeSocialProjectExportMedia({
        executable: input.ffprobeExecutable,
        path: mediaPath,
        signal: input.signal,
      });
      probeByMediaId.set(clip.mediaId, probePromise);
    }
    const info = await probePromise;
    if (clip.kind === "audio" && !info.hasAudio) {
      throw new SocialProjectExportRenderError("invalid-media");
    }
    if (clip.kind === "video" && !info.hasVideo) {
      throw new SocialProjectExportRenderError("invalid-media");
    }
    if (info.hasAudio) clipsWithAudio.add(clip.clipId);
  }

  const graph = buildSocialProjectExportGraph({
    project,
    inputIndexByClipId,
    textFileByClipId,
    clipsWithAudio,
  });
  const maps = ["-map", `[${graph.videoOutputLabel}]`];
  if (graph.audioOutputLabel) maps.push("-map", `[${graph.audioOutputLabel}]`);
  ffmpegArgs.push(
    "-filter_complex",
    graph.filterComplex,
    ...maps,
    "-t",
    durationSeconds,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-maxrate:v",
    SOCIAL_PROJECT_EXPORT_VIDEO_MAX_BITRATE,
    "-bufsize:v",
    SOCIAL_PROJECT_EXPORT_VIDEO_BUFFER_SIZE,
    "-pix_fmt",
    "yuv420p",
  );
  if (graph.audioOutputLabel) {
    ffmpegArgs.push(
      "-c:a",
      "aac",
      "-b:a",
      SOCIAL_PROJECT_EXPORT_AUDIO_BITRATE,
      "-ac",
      "2",
      "-ar",
      "48000",
    );
  } else {
    ffmpegArgs.push("-an");
  }
  ffmpegArgs.push("-movflags", "+faststart", "-f", "mp4", input.outputPath);

  await runSocialProjectExportProcess({
    executable: input.ffmpegExecutable,
    args: ffmpegArgs,
    signal: input.signal,
    timeoutMs: 15 * 60 * 1000,
    maximumOutputBytes: 4 * 1024 * 1024,
    onProgress(line) {
      const value = parseSocialProjectExportProgress(line, endMs);
      if (value !== null) input.onProgress(value);
    },
  });
  const outputInfo = await probeSocialProjectExportMedia({
    executable: input.ffprobeExecutable,
    path: input.outputPath,
    signal: input.signal,
  });
  if (!outputInfo.hasVideo || outputInfo.durationMs <= 0) {
    throw new SocialProjectExportRenderError("verification-failed");
  }
  return outputInfo.durationMs;
}
