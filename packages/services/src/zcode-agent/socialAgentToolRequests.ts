import {
  socialAgentQueryParamsSchema,
  socialAgentQueryResultSchema,
  zcodeProtocolMethods,
} from "@social-harness/shared";
import type { SocialAgentService } from "../social-agent/contract.js";

export type SocialAgentRequestResult =
  | { kind: "result"; result: unknown }
  | { kind: "error"; code: number; message: string };

export async function executeSocialAgentRequest(input: {
  method: string;
  params: unknown;
  workspaceIdentity?: string;
  resolveScope?: SocialAgentService["resolveScope"];
}): Promise<SocialAgentRequestResult> {
  if (
    input.method !== zcodeProtocolMethods.socialAgentQuery ||
    !input.workspaceIdentity?.trim() ||
    !input.resolveScope
  ) {
    return scopeUnavailable();
  }
  const parsed = socialAgentQueryParamsSchema.safeParse(input.params);
  if (!parsed.success) {
    return {
      kind: "error",
      code: -32602,
      message: "Invalid social Agent request parameters.",
    };
  }

  try {
    const scope = await input.resolveScope(input.workspaceIdentity);
    if (!scope) return scopeUnavailable();
    const request = parsed.data;
    const result =
      request.action === "context"
        ? { action: request.action, context: await scope.getContext() }
        : request.action === "list-media"
          ? { action: request.action, assets: await scope.listMedia() }
          : request.action === "search-youtube"
            ? { action: request.action, results: await scope.searchYouTube(request.query) }
            : request.action === "suggest-candidates"
              ? {
                  action: request.action,
                  result: await scope.suggestClipCandidates({
                    mediaId: request.mediaId,
                    mode: request.mode,
                  }),
                }
              : {
                  action: request.action,
                  result: await scope.requestPublication({
                    exportId: request.exportId,
                    caption: request.caption,
                    requestId: request.requestId,
                  }),
                };
    return {
      kind: "result",
      result: socialAgentQueryResultSchema.parse(result),
    };
  } catch {
    return {
      kind: "error",
      code: -32130,
      message: "The requested social account data is not available in this account.",
    };
  }
}

export function isSocialAgentProtocolMethod(method: string): boolean {
  return method === zcodeProtocolMethods.socialAgentQuery;
}

function scopeUnavailable(): SocialAgentRequestResult {
  return {
    kind: "error",
    code: -32131,
    message: "Social Agent tools require a verified account-scoped conversation.",
  };
}
