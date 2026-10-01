import type {
  SocialAgentContext,
  SocialAgentMediaAsset,
  SocialAgentQueryResult,
  SocialAgentPublicationRequestResult,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/shared";
import type { TraceContext } from "../tracing/tracer.js";

type AgentCandidateResult = Extract<
  SocialAgentQueryResult,
  { action: "suggest-candidates" }
>["result"];

export interface SocialAgentPort {
  getContext(options?: { signal?: AbortSignal; traceContext?: TraceContext }): Promise<SocialAgentContext>;
  listMedia(options?: { signal?: AbortSignal; traceContext?: TraceContext }): Promise<SocialAgentMediaAsset[]>;
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
