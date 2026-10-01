import type {
  SocialMediaAsset,
  SocialMediaJob,
  SocialMediaLocalFileImportRequest,
  SocialMediaSubtitleTrack,
  SocialMediaHeatmapSegment,
  SocialMediaTranscript,
} from "@social-harness/shared";

export interface SocialMediaSubtitleContent {
  languageCode: string;
  automatic: boolean;
  content: string;
}

export interface SocialMediaSourceUrlFinalizationInput {
  job: SocialMediaJob;
  mediaPath: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  uploadDate: string | null;
  heatmap: SocialMediaHeatmapSegment[];
  subtitles: Array<SocialMediaSubtitleTrack & { path: string }>;
  importedAt: number;
}

export interface SocialMediaStore {
  list(accountId: string): Promise<SocialMediaAsset[]>;
  getAsset(accountId: string, mediaId: string): Promise<SocialMediaAsset | null>;
  listJobs(accountId: string): Promise<SocialMediaJob[]>;
  importLocalFile(
    input: SocialMediaLocalFileImportRequest & { mediaId: string; importedAt: number },
  ): Promise<SocialMediaAsset>;
  createOrGetSourceUrlJob(job: SocialMediaJob): Promise<{ job: SocialMediaJob; created: boolean }>;
  getJob(accountId: string, jobId: string): Promise<SocialMediaJob | null>;
  updateJob(
    accountId: string,
    jobId: string,
    expectedStates: readonly SocialMediaJob["state"][],
    update: Partial<SocialMediaJob>,
  ): Promise<SocialMediaJob | null>;
  requestCancel(
    accountId: string,
    jobId: string,
    updatedAt: number,
  ): Promise<SocialMediaJob | null>;
  recoverInterruptedJobs(updatedAt: number): Promise<SocialMediaJob[]>;
  claimNextQueuedJob(updatedAt: number): Promise<SocialMediaJob | null>;
  createJobWorkingDirectory(jobId: string): Promise<string>;
  cleanupJobWorkingDirectory(jobId: string): Promise<void>;
  discardNonResumableJobOutput(jobId: string, sourceKey: string): Promise<void>;
  finalizeSourceUrlDownload(
    input: SocialMediaSourceUrlFinalizationInput,
  ): Promise<SocialMediaAsset>;
  getManagedOriginalPath(asset: SocialMediaAsset): Promise<string>;
  readValidSubtitleContents(asset: SocialMediaAsset): Promise<SocialMediaSubtitleContent[]>;
  completeTranscription(input: {
    accountId: string;
    jobId: string;
    mediaId: string;
    transcript: SocialMediaTranscript;
    updatedAt: number;
  }): Promise<{ asset: SocialMediaAsset; job: SocialMediaJob } | null>;
  withJobQueueLock<T>(operation: () => Promise<T>): Promise<T>;
}
