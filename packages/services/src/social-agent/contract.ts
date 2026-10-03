import type {
  SocialAgentContext,
  SocialAgentMediaAsset,
  SocialAgentPublicationRequestResult,
  SocialAgentMediaJob,
  SocialAgentExportJob,
  SocialAgentProjectSummary,
  SocialMediaClipCandidateResult,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";

export type SocialAgentCandidateResult = Omit<SocialMediaClipCandidateResult, "accountId">;

export interface SocialAgentScope {
  importSource(url: string): Promise<SocialAgentMediaJob>;
  listMediaJobs(input: { jobId?: string }): Promise<SocialAgentMediaJob[]>;
  mediaJobCommand(input: {
    jobId: string;
    action: "cancel" | "retry";
  }): Promise<SocialAgentMediaJob>;
  createProject(input: {
    displayName: string;
    requestId: string;
  }): Promise<SocialAgentProjectSummary>;
  startExport(input: {
    projectId: string;
    expectedRevision: number;
    requestId: string;
  }): Promise<SocialAgentExportJob>;
  listExports(input: { projectId?: string; exportId?: string }): Promise<SocialAgentExportJob[]>;
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
