import type {
  SocialAgentContext,
  SocialAgentMediaAsset,
  SocialAgentQueryResult,
  SocialAgentPublicationRequestResult,
  SocialAgentMediaJob,
  SocialAgentExportJob,
  SocialAgentProjectSummary,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";
import type { TraceContext } from "../tracing/tracer.js";

type AgentCandidateResult = Extract<
  SocialAgentQueryResult,
  { action: "suggest-candidates" }
>["result"];

export interface SocialAgentPort {
  importSource(
    url: string,
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentMediaJob>;
  listMediaJobs(
    input: { jobId?: string },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentMediaJob[]>;
  mediaJobCommand(
    input: { jobId: string; action: "cancel" | "retry" },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentMediaJob>;
  createProject(
    input: { displayName: string; requestId: string },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentProjectSummary>;
  startExport(
    input: { projectId: string; expectedRevision: number; requestId: string },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentExportJob>;
  listExports(
    input: { projectId?: string; exportId?: string },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentExportJob[]>;
  getContext(options?: {
    signal?: AbortSignal;
    traceContext?: TraceContext;
  }): Promise<SocialAgentContext>;
  listMedia(options?: {
    signal?: AbortSignal;
    traceContext?: TraceContext;
  }): Promise<SocialAgentMediaAsset[]>;
  searchYouTube(
    query: string,
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialMediaYouTubeSearchResult[]>;
  suggestClipCandidates(
    input: { mediaId: string; mode: "podcast" | "music" },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<AgentCandidateResult>;
  requestPublication(
    input: { exportId: string; caption: string; requestId: string },
    options?: { signal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<SocialAgentPublicationRequestResult>;
}
