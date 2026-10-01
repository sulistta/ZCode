import type {
  SocialAgentContext,
  SocialAgentMediaAsset,
  SocialAgentPublicationRequestResult,
  SocialMediaClipCandidateResult,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";

export type SocialAgentCandidateResult = Omit<SocialMediaClipCandidateResult, "accountId">;

export interface SocialAgentScope {
  getContext(): Promise<SocialAgentContext>;
  listMedia(): Promise<SocialAgentMediaAsset[]>;
  searchYouTube(query: string): Promise<SocialMediaYouTubeSearchResult[]>;
  suggestClipCandidates(input: {
    mediaId: string;
    mode: "podcast" | "music";
  }): Promise<SocialAgentCandidateResult>;
  requestPublication(input: {
    exportId: string;
    caption: string;
    requestId: string;
  }): Promise<SocialAgentPublicationRequestResult>;
}

export interface SocialAgentService {
  resolveScope(workspaceIdentity: string): Promise<SocialAgentScope | null>;
}
