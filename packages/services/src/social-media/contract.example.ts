import type { ISocialMediaService } from "./contract.js";
import type { ISocialMediaPreviewService } from "./previewContract.js";

/** Import one file selected by the desktop platform into an account's managed library. */
export function importPickedMedia(
  service: ISocialMediaService,
  accountId: string,
  sourcePath: string,
) {
  return service.importLocalFile({ accountId, sourcePath });
}

/** Search metadata for the selected account without creating catalog entries or jobs. */
export function searchAccountYouTube(
  service: ISocialMediaService,
  accountId: string,
  query: string,
) {
  return service.searchYouTube({ accountId, query });
}

/** Suggest reviewable time ranges using only evidence already available for one account asset. */
export function suggestAccountMediaClips(
  service: ISocialMediaService,
  accountId: string,
  mediaId: string,
  mode: "podcast" | "music",
) {
  return service.suggestClipCandidates({ accountId, mediaId, mode });
}

/** Request a short-lived preview capability without returning the managed file path. */
export function prepareAccountMediaPreview(
  service: ISocialMediaPreviewService,
  accountId: string,
  mediaId: string,
) {
  return service.prepare({ accountId, mediaId });
}

/** Request a compatibility job only after a video decoder rejects the original. */
export function requestAccountVideoPreviewProxy(
  service: ISocialMediaPreviewService,
  accountId: string,
  mediaId: string,
) {
  return service.requestProxy({ accountId, mediaId });
}

/** Queue one supported account-scoped source URL; repeated calls reuse its job. */
export function addMediaUrlToLibrary(service: ISocialMediaService, accountId: string, url: string) {
  return service.downloadSourceUrl({ accountId, url });
}

/** Cancel or retry with both IDs so another account cannot observe or control this job. */
export function cancelSourceDownload(
  service: ISocialMediaService,
  accountId: string,
  jobId: string,
) {
  return service.cancelJob({ accountId, jobId });
}

/** Inspect the app-wide local transcription model setup without exposing model paths. */
export function getLocalTranscriptionSetup(service: ISocialMediaService) {
  return service.getTranscriptionSetup();
}

/** Select a supported multilingual model; `small` is the initial default. */
export function selectLocalTranscriptionModel(
  service: ISocialMediaService,
  modelId: "tiny" | "base" | "small" | "large-v3-turbo",
) {
  return service.selectTranscriptionModel({ modelId });
}

/** Install the selected verified model during setup. Progress is broadcast as setup changes. */
export function installLocalTranscriptionModel(
  service: ISocialMediaService,
  modelId: "tiny" | "base" | "small" | "large-v3-turbo",
) {
  return service.downloadTranscriptionModel({ modelId });
}

/** Cancel only the active app-wide download for the selected model. */
export function cancelLocalTranscriptionModelDownload(
  service: ISocialMediaService,
  modelId: "tiny" | "base" | "small" | "large-v3-turbo",
) {
  return service.cancelTranscriptionModelDownload({ modelId });
}
