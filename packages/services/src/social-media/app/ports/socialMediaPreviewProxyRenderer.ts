export interface SocialMediaPreviewProxyRenderer {
  start(input: {
    mediaPath: string;
    workingDirectory: string;
    onProgress(progress: { processedSeconds: number; durationSeconds: number }): void;
  }): {
    completion: Promise<{ outputPath: string; durationSeconds: number }>;
    cancel(): Promise<void>;
  };
}
