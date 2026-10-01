import type { SocialAgentPort, TraceContext } from "@social-harness/contracts";
import {
  parseSocialAccountWorkspaceIdentity,
  zcodeProtocolMethods,
  zcodeSocialAgentQueryResultSchema,
  type SocialAgentQueryParams,
  type SocialAgentQueryResult,
} from "@social-harness/shared";
import {
  protocolTraceFromTraceContext,
  requireSession,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

export function createProtocolSocialAgentPort(
  context: ZCodeProtocolAgentServerContext,
  resolveOwnSession: () => { app: { sessionId?: string }; workspace: { workspaceIdentity?: string } } | undefined,
): SocialAgentPort {
  function requireAccountSession(sessionId: string): void {
    const session = resolveOwnSession() ?? requireSession(context, sessionId);
    if (session.app.sessionId && session.app.sessionId !== sessionId) {
      throw new Error("Social Agent request does not belong to the active session.");
    }
    if (!parseSocialAccountWorkspaceIdentity(session.workspace.workspaceIdentity)) {
      throw new Error("Social Agent tools require an account-scoped conversation.");
    }
  }

  async function query(
    params: SocialAgentQueryParams,
    options?: {
    signal?: AbortSignal;
      traceContext?: TraceContext;
    },
  ): Promise<SocialAgentQueryResult> {
    const sessionId = resolveOwnSession()?.app.sessionId;
    if (!sessionId) throw new Error("Social Agent request has no active session.");
    requireAccountSession(sessionId);
    return context.requestClient(
      zcodeProtocolMethods.socialAgentQuery,
      params,
      zcodeSocialAgentQueryResultSchema,
      {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.traceContext
          ? { trace: protocolTraceFromTraceContext(options.traceContext) }
          : {}),
      },
    );
  }

  return {
    async getContext(options) {
      const result = await query({ action: "context" }, options);
      if (result.action !== "context") throw new Error("Social Agent returned the wrong result.");
      return result.context;
    },
    async listMedia(options) {
      const result = await query({ action: "list-media" }, options);
      if (result.action !== "list-media") throw new Error("Social Agent returned the wrong result.");
      return result.assets;
    },
    async searchYouTube(queryText, options) {
      const result = await query({ action: "search-youtube", query: queryText }, options);
      if (result.action !== "search-youtube") {
        throw new Error("Social Agent returned the wrong result.");
      }
      return result.results;
    },
    async suggestClipCandidates(input, options) {
      const result = await query({ action: "suggest-candidates", ...input }, options);
      if (result.action !== "suggest-candidates") {
        throw new Error("Social Agent returned the wrong result.");
      }
      return result.result;
    },
    async requestPublication(input, options) {
      const result = await query({ action: "request-publication", ...input }, options);
      if (result.action !== "request-publication") {
        throw new Error("Social Agent returned the wrong publication result.");
      }
      return result.result;
    },
  };
}
