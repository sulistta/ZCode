import type { SocialMediaJob } from "@social-harness/shared";
import type { ISocialAccountService } from "../../../social-account/contract.js";
import type { SocialMediaStore } from "./socialMediaStore.js";
import type { SocialMediaSourceUrlDownload } from "./socialMediaSourceDownload.js";
import type { SocialMediaTranscriber } from "./socialMediaTranscriber.js";
import type { SocialMediaTranscriptionModelManager } from "./socialMediaTranscriptionModelManager.js";
import type { SocialMediaPreviewProxyRenderer } from "./socialMediaPreviewProxyRenderer.js";

export interface SocialMediaJobQueueOptions {
  store: SocialMediaStore;
  socialAccountService: ISocialAccountService;
  sourceUrlDownload: SocialMediaSourceUrlDownload;
  transcriptionModelManager: SocialMediaTranscriptionModelManager;
  transcriber: SocialMediaTranscriber;
  previewProxyRenderer?: SocialMediaPreviewProxyRenderer;
  now(): number;
  onJobChanged(job: SocialMediaJob): void;
  onMediaImported(asset: Awaited<ReturnType<SocialMediaStore["finalizeSourceUrlDownload"]>>): void;
}

export interface SocialMediaJobQueue {
  requestQueueRun(): void;
  cancelActiveJob(job: SocialMediaJob): Promise<void>;
  disposeAll(): void;
  disposeAllAndWait(): Promise<void>;
}
