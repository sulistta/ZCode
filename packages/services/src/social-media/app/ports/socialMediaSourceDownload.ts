import type { SocialMediaHeatmapSegment } from "@social-harness/shared";

export interface SocialMediaSourceDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  etaSeconds: number | null;
}

export interface SocialMediaSubtitleFile {
  languageCode: string;
  automatic: boolean;
  extension: ".vtt";
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface SocialMediaSourceDownloadOutput {
  mediaPath: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  uploadDate: string | null;
  heatmap: SocialMediaHeatmapSegment[];
  subtitles: SocialMediaSubtitleFile[];
}

export interface SocialMediaSourceDownloadTask {
  completion: Promise<SocialMediaSourceDownloadOutput>;
  cancel(): Promise<void>;
}

export interface SocialMediaSourceUrlDownload {
  start(input: {
    sourceKey: string;
    sourceUrl: string;
    workingDirectory: string;
    language: string;
    onProgress(progress: SocialMediaSourceDownloadProgress): void;
  }): SocialMediaSourceDownloadTask;
}
