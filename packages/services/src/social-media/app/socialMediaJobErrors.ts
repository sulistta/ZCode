import type { SocialMediaJob } from "@social-harness/shared";
import type { SocialMediaSourceDownloadProgress } from "./ports/socialMediaSourceDownload.js";
import {
  SocialMediaSourceDownloadUnavailableError,
  SocialMediaSourceDownloadOutputError,
  SocialMediaTranscriptionModelUnavailableError,
  SocialMediaTranscriptionToolUnavailableError,
  SocialMediaTranscriptionOutputError,
  SocialMediaTranscriptionFailedError,
} from "./errors.js";
export function toProgressUpdate(progress: SocialMediaSourceDownloadProgress) {
  return {
    downloadedBytes: Math.max(0, Math.trunc(progress.downloadedBytes)),
    totalBytes:
      progress.totalBytes !== null &&
      Number.isSafeInteger(progress.totalBytes) &&
      progress.totalBytes > 0
        ? progress.totalBytes
        : null,
    etaSeconds:
      progress.etaSeconds !== null &&
      Number.isSafeInteger(progress.etaSeconds) &&
      progress.etaSeconds >= 0
        ? progress.etaSeconds
        : null,
  };
}

export function errorCodeFor(
  error: unknown,
  hasCommittedMedia: boolean,
): SocialMediaJob["errorCode"] {
  if (error instanceof SocialMediaSourceDownloadUnavailableError) return "tool-unavailable";
  if (error instanceof SocialMediaSourceDownloadOutputError) return "output-invalid";
  if (error instanceof SocialMediaTranscriptionModelUnavailableError)
    return "transcription-model-unavailable";
  if (error instanceof SocialMediaTranscriptionToolUnavailableError)
    return "transcription-tool-unavailable";
  if (error instanceof SocialMediaTranscriptionOutputError) return "transcription-output-invalid";
  if (error instanceof SocialMediaTranscriptionFailedError) return "transcription-failed";
  return hasCommittedMedia ? "transcription-failed" : "download-failed";
}
