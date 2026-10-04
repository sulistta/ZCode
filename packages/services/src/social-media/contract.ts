import type { Event } from "@social-harness/rpc";
import type {
  SocialMediaAsset,
  SocialMediaClipCandidateRequest,
  SocialMediaClipCandidateResult,
  SocialMediaJob,
  SocialMediaJobActionRequest,
  SocialMediaJobChange,
  SocialMediaLocalFileImportRequest,
  SocialMediaTranscriptionModelId,
  SocialMediaTranscriptionModelRequest,
  SocialMediaTranscriptionSetup,
  SocialMediaTranscript,
  SocialMediaTranscriptSegment,
  SocialMediaSourceUrlDownloadRequest,
  SocialMediaYouTubeSearchRequest,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";

export type {
  SocialMediaAsset,
  SocialMediaClipCandidate,
  SocialMediaClipCandidateEvidence,
  SocialMediaClipCandidateMode,
  SocialMediaClipCandidateRequest,
  SocialMediaClipCandidateResult,
  SocialMediaClipCandidateUnavailableReason,
  SocialMediaJob,
  SocialMediaJobChange,
  SocialMediaJobActionRequest,
  SocialMediaKind,
  SocialMediaLocalFileImportRequest,
  SocialMediaTranscriptionModelId,
  SocialMediaTranscriptionModelRequest,
  SocialMediaTranscriptionSetup,
  SocialMediaTranscript,
  SocialMediaTranscriptSegment,
  SocialMediaSourceUrlDownloadRequest,
  SocialMediaYouTubeSearchRequest,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";

export type SocialMediaChange = {
  accountId: string;
  mediaId: string;
  importedAt: number;
};

export interface ISocialMediaService {
  list(accountId: string): Promise<SocialMediaAsset[]>;
  listJobs(accountId: string): Promise<SocialMediaJob[]>;
  importLocalFile(request: SocialMediaLocalFileImportRequest): Promise<SocialMediaAsset>;
  downloadSourceUrl(request: SocialMediaSourceUrlDownloadRequest): Promise<SocialMediaJob>;
  cancelJob(request: SocialMediaJobActionRequest): Promise<SocialMediaJob>;
  retryJob(request: SocialMediaJobActionRequest): Promise<SocialMediaJob>;
  getTranscriptionSetup(): Promise<SocialMediaTranscriptionSetup>;
  selectTranscriptionModel(
    request: SocialMediaTranscriptionModelRequest,
  ): Promise<SocialMediaTranscriptionSetup>;
  downloadTranscriptionModel(
    request: SocialMediaTranscriptionModelRequest,
  ): Promise<SocialMediaTranscriptionSetup>;
  cancelTranscriptionModelDownload(
    request: SocialMediaTranscriptionModelRequest,
  ): Promise<SocialMediaTranscriptionSetup>;
  searchYouTube(
    request: SocialMediaYouTubeSearchRequest,
  ): Promise<SocialMediaYouTubeSearchResult[]>;
  suggestClipCandidates(
    request: SocialMediaClipCandidateRequest,
  ): Promise<SocialMediaClipCandidateResult>;
  onChanged: Event<SocialMediaChange>;
  onJobChanged: Event<SocialMediaJobChange>;
  onTranscriptionSetupChanged: Event<{ updatedAt: number }>;
}

export const ISocialMediaService = createServiceDescriptor<ISocialMediaService>(
  ServiceChannels.SocialMedia,
);
