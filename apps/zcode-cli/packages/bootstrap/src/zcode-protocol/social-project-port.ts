import type { SocialProjectPort } from "@social-harness/contracts";
import {
  parseSocialAccountWorkspaceIdentity,
  zcodeProtocolMethods,
  zcodeSocialProjectCommandResultSchema,
  zcodeSocialProjectGetResultSchema,
  zcodeSocialProjectListResultSchema,
} from "@social-harness/shared";
import {
  protocolTraceFromTraceContext,
  requireSession,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

export function createProtocolSocialProjectPort(
  context: ZCodeProtocolAgentServerContext,
  resolveOwnSession: () => { app: { sessionId?: string }; workspace: { workspaceIdentity?: string } } | undefined,
): SocialProjectPort {
  function requireAccountSession(sessionId: string): void {
    const session = resolveOwnSession() ?? requireSession(context, sessionId);
    if (session.app.sessionId && session.app.sessionId !== sessionId) {
      throw new Error("Social project request does not belong to the active session.");
    }
    if (!parseSocialAccountWorkspaceIdentity(session.workspace.workspaceIdentity)) {
      throw new Error("Social project tools require an account-scoped conversation.");
    }
  }

  return {
    async list(options) {
      const sessionId = resolveOwnSession()?.app.sessionId;
      if (!sessionId) throw new Error("Social project request has no active session.");
      requireAccountSession(sessionId);
      const result = await context.requestClient(
        zcodeProtocolMethods.socialProjectList,
        {},
        zcodeSocialProjectListResultSchema,
        {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.traceContext
            ? { trace: protocolTraceFromTraceContext(options.traceContext) }
            : {}),
        },
      );
      return result.projects;
    },
    async get(projectId, options) {
      const sessionId = resolveOwnSession()?.app.sessionId;
      if (!sessionId) throw new Error("Social project request has no active session.");
      requireAccountSession(sessionId);
      const result = await context.requestClient(
        zcodeProtocolMethods.socialProjectGet,
        { projectId },
        zcodeSocialProjectGetResultSchema,
        {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.traceContext
            ? { trace: protocolTraceFromTraceContext(options.traceContext) }
            : {}),
        },
      );
      return result.project;
    },
    async executeCommand(input, options) {
      const sessionId = resolveOwnSession()?.app.sessionId;
      if (!sessionId) throw new Error("Social project request has no active session.");
      requireAccountSession(sessionId);
      const result = await context.requestClient(
        zcodeProtocolMethods.socialProjectCommand,
        input,
        zcodeSocialProjectCommandResultSchema,
        {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.traceContext
            ? { trace: protocolTraceFromTraceContext(options.traceContext) }
            : {}),
        },
      );
      return result.result;
    },
  };
}
