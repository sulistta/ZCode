import type { SocialProjectAgentScope, ZCodeProtocolMethod } from "@social-harness/shared";
import {
  isSocialProjectAgentOperation,
  parseSocialAccountWorkspaceIdentity,
  zcodeProtocolMethods,
  zcodeSocialProjectCommandParamsSchema,
  zcodeSocialProjectGetParamsSchema,
  zcodeSocialProjectListParamsSchema,
} from "@social-harness/shared";

export const SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS = {
  scopeUnavailable: -32120,
  notFound: -32121,
  revisionConflict: -32122,
  editSuspended: -32123,
  commandConflict: -32124,
  invalidCommand: -32125,
  internal: -32126,
} as const;

export type SocialProjectAgentRequestResult =
  | { kind: "result"; result: unknown }
  | { kind: "error"; code: number; message: string; data?: Record<string, unknown> };

export async function executeSocialProjectAgentRequest(input: {
  method: ZCodeProtocolMethod;
  params: unknown;
  workspaceIdentity?: string;
  resolveScope?: (workspaceIdentity: string) => Promise<SocialProjectAgentScope | null>;
}): Promise<SocialProjectAgentRequestResult> {
  const identity = input.workspaceIdentity?.trim();
  if (!identity || !parseSocialAccountWorkspaceIdentity(identity) || !input.resolveScope) {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.scopeUnavailable,
      message: "Social project tools are unavailable outside an account-scoped conversation.",
    };
  }

  let scope: SocialProjectAgentScope | null;
  try {
    scope = await input.resolveScope(identity);
  } catch {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.scopeUnavailable,
      message: "The current account scope could not be verified.",
    };
  }
  if (!scope) {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.scopeUnavailable,
      message: "The current account scope could not be verified.",
    };
  }

  try {
    if (input.method === zcodeProtocolMethods.socialProjectList) {
      const parsed = zcodeSocialProjectListParamsSchema.safeParse(input.params);
      if (!parsed.success) return invalidRequest();
      return { kind: "result", result: { projects: await scope.list() } };
    }
    if (input.method === zcodeProtocolMethods.socialProjectGet) {
      const parsed = zcodeSocialProjectGetParamsSchema.safeParse(input.params);
      if (!parsed.success) return invalidRequest();
      return {
        kind: "result",
        result: { project: await scope.get(parsed.data.projectId) },
      };
    }
    if (input.method === zcodeProtocolMethods.socialProjectCommand) {
      const parsed = zcodeSocialProjectCommandParamsSchema.safeParse(input.params);
      if (!parsed.success) return invalidRequest();
      if (!isSocialProjectAgentOperation(parsed.data.operation)) return invalidRequest();
      return {
        kind: "result",
        result: {
          result: await scope.executeCommand({
            commandId: parsed.data.commandId,
            expectedRevision: parsed.data.expectedRevision,
            operation: parsed.data.operation,
            projectId: parsed.data.projectId,
          }),
        },
      };
    }
    return invalidRequest();
  } catch (error) {
    return mapCommandError(error);
  }
}

function invalidRequest(): SocialProjectAgentRequestResult {
  return {
    kind: "error",
    code: -32602,
    message: "Invalid social project request parameters.",
  };
}

function mapCommandError(error: unknown): SocialProjectAgentRequestResult {
  const errorName = error instanceof Error ? error.name : "";
  if (errorName === "SocialProjectRevisionConflictError") {
    const currentRevision =
      typeof error === "object" && error !== null && "currentRevision" in error
        ? (error as { currentRevision?: unknown }).currentRevision
        : undefined;
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.revisionConflict,
      message: "Project revision changed; read the project again before editing.",
      ...(typeof currentRevision === "number" ? { data: { currentRevision } } : {}),
    };
  }
  if (errorName === "SocialProjectAgentEditSuspendedError") {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.editSuspended,
      message: "The user currently controls this project. Do not retry until control is returned.",
    };
  }
  if (
    errorName === "SocialProjectNotFoundError" ||
    errorName === "SocialProjectMediaNotFoundError"
  ) {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.notFound,
      message: "The requested project or media is not available in the current account.",
    };
  }
  if (errorName === "SocialProjectIdempotencyConflictError") {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.commandConflict,
      message: "This command ID was already used with different content. Read the project again.",
    };
  }
  if (errorName === "SocialProjectInvalidOperationError" || errorName === "ZodError") {
    return {
      kind: "error",
      code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.invalidCommand,
      message: "The project rejected this edit. Read the project and submit a valid command.",
    };
  }
  return {
    kind: "error",
    code: SOCIAL_PROJECT_AGENT_PROTOCOL_ERRORS.internal,
    message: "The project command could not be completed. Read the project before retrying.",
  };
}

export function isSocialProjectAgentProtocolMethod(method: string): method is ZCodeProtocolMethod {
  return (
    method === zcodeProtocolMethods.socialProjectList ||
    method === zcodeProtocolMethods.socialProjectGet ||
    method === zcodeProtocolMethods.socialProjectCommand
  );
}
