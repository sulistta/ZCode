import { createHash } from "node:crypto";
import {
  CoreErrorType,
  SocialProjectCommandInputJsonSchema,
  SocialProjectCommandInputSchema,
  SocialProjectGetInputJsonSchema,
  SocialProjectGetInputSchema,
  SocialProjectListInputJsonSchema,
  SocialProjectListInputSchema,
  SocialProjectOutputJsonSchema,
  SOCIAL_PROJECT_COMMAND_TOOL_NAME,
  SOCIAL_PROJECT_LIST_TOOL_NAME,
  SOCIAL_PROJECT_READ_TOOL_NAME,
  createCoreError,
  type SocialProjectPort,
} from "@social-harness/contracts";
import {
  isSocialProjectAgentOperation,
  socialProjectOperationSchema,
  type SocialProjectReadModel,
  type SocialProjectSummary,
} from "@social-harness/shared";
import type { SocialProjectCommandResult } from "@social-harness/shared";
import type { ToolEntry, ToolExecutionContext } from "../types.js";

const SOCIAL_PROJECT_TOOL_MAX_BYTES = 64_000;

function requireSocialProjectPort(
  context: ToolExecutionContext,
  toolName: string,
): SocialProjectPort {
  if (context.socialProjectPort) return context.socialProjectPort;
  throw createCoreError(CoreErrorType.ConfigurationError, `${toolName} is not available here`, {
    context: { toolCallId: context.toolCallId, toolName },
    recoverable: false,
  });
}

function toModelSummary(project: SocialProjectSummary) {
  const { accountId: _accountId, ...visibleProject } = project;
  return visibleProject;
}

function toModelReadModel(readModel: SocialProjectReadModel | null) {
  if (!readModel) return null;
  const { accountId: _accountId, ...project } = readModel.project;
  return {
    ...readModel,
    history: readModel.history.slice(-50),
    project,
  };
}

function toModelCommandResult(result: SocialProjectCommandResult) {
  const { accountId: _accountId, ...project } = result.project;
  return { ...result, history: result.history.slice(-50), project };
}

const socialProjectListHandler: ToolEntry["handler"] = async (input, context) => {
  SocialProjectListInputSchema.parse(input);
  const projects = await requireSocialProjectPort(context, SOCIAL_PROJECT_LIST_TOOL_NAME).list({
    signal: context.abortSignal,
    traceContext: context.traceContext,
  });
  return { projects: projects.map(toModelSummary) };
};

const socialProjectReadHandler: ToolEntry["handler"] = async (input, context) => {
  const parsed = SocialProjectGetInputSchema.parse(input);
  const project = await requireSocialProjectPort(context, SOCIAL_PROJECT_READ_TOOL_NAME).get(
    parsed.projectId,
    { signal: context.abortSignal, traceContext: context.traceContext },
  );
  return { project: toModelReadModel(project) };
};

const socialProjectCommandHandler: ToolEntry["handler"] = async (input, context) => {
  const parsed = SocialProjectCommandInputSchema.parse(input);
  const operation = socialProjectOperationSchema.parse(parsed.operation);
  if (!isSocialProjectAgentOperation(operation)) {
    throw createCoreError(
      CoreErrorType.PermissionDenied,
      "Agent project commands cannot change edit control or history state.",
      {
        context: { toolCallId: context.toolCallId, toolName: SOCIAL_PROJECT_COMMAND_TOOL_NAME },
        recoverable: false,
        retryable: false,
      },
    );
  }
  const commandId = `agent-${createHash("sha256")
    .update(`${context.sessionId}\u0000${context.toolCallId}`)
    .digest("hex")
    .slice(0, 48)}`;
  const result = await requireSocialProjectPort(context, SOCIAL_PROJECT_COMMAND_TOOL_NAME).executeCommand(
    {
      commandId,
      expectedRevision: parsed.expectedRevision,
      operation,
      projectId: parsed.projectId,
    },
    { signal: context.abortSignal, traceContext: context.traceContext },
  );
  return { result: toModelCommandResult(result) };
};

const readPermission = {
  permission: "social.project.read",
  reason: "Read only projects in the account bound to this conversation",
  riskLevel: "low" as const,
  sideEffectScope: "none" as const,
  needsApproval: false,
  patternSources: ["toolName" as const],
  alwaysAllowPatternSources: ["toolName" as const],
  denyPriority: "beforeAsk" as const,
};

export const socialProjectListToolEntry: ToolEntry = {
  capability: "List projects belonging only to the account bound to this conversation",
  metadata: {
    name: SOCIAL_PROJECT_LIST_TOOL_NAME,
    description: "List the projects for the current social account",
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: 30_000,
    maxOutputBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: socialProjectListHandler,
  inputSchema: SocialProjectListInputJsonSchema,
  outputSchema: SocialProjectOutputJsonSchema,
  runtimeInputSchema: SocialProjectListInputSchema,
  permission: readPermission,
  resultBudget: {
    maxInlineBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    maxModelBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    strategy: "truncate",
    preview: { maxBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES, direction: "head" },
  },
  timeout: { defaultMs: 30_000, maxMs: 30_000, allowCallOverride: false },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "Project listing was cancelled before it returned.",
  },
  trace: { required: true, propagateToAdapters: false, recordInput: "summary", recordOutput: "summary" },
};

export const socialProjectReadToolEntry: ToolEntry = {
  capability: "Read one project from the account bound to this conversation",
  metadata: {
    name: SOCIAL_PROJECT_READ_TOOL_NAME,
    description: "Read a social project before planning or applying edits",
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: 30_000,
    maxOutputBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: socialProjectReadHandler,
  inputSchema: SocialProjectGetInputJsonSchema,
  outputSchema: SocialProjectOutputJsonSchema,
  runtimeInputSchema: SocialProjectGetInputSchema,
  permission: readPermission,
  resultBudget: {
    maxInlineBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    maxModelBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    strategy: "truncate",
    preview: { maxBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES, direction: "head" },
  },
  timeout: { defaultMs: 30_000, maxMs: 30_000, allowCallOverride: false },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "Project read was cancelled before it returned.",
  },
  trace: { required: true, propagateToAdapters: false, recordInput: "summary", recordOutput: "summary" },
};

export const socialProjectCommandToolEntry: ToolEntry = {
  capability: "Apply a revision-checked edit to the current account's shared project document",
  metadata: {
    name: SOCIAL_PROJECT_COMMAND_TOOL_NAME,
    description:
      "Apply one project edit using the latest revision. If the command fails or its result is uncertain, read the project again before retrying. The user retains control of undo, redo, and edit handoff.",
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: 30_000,
    maxOutputBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: false,
  },
  handler: socialProjectCommandHandler,
  inputSchema: SocialProjectCommandInputJsonSchema,
  outputSchema: SocialProjectOutputJsonSchema,
  runtimeInputSchema: SocialProjectCommandInputSchema,
  permission: {
    permission: "social.project.write",
    reason: "Apply a reversible project command through the account-bound project service",
    riskLevel: "medium",
    sideEffectScope: "workspace",
    needsApproval: false,
    patternSources: ["toolName" as const, "input" as const],
    alwaysAllowPatternSources: ["toolName" as const],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    maxModelBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES,
    strategy: "truncate",
    preview: { maxBytes: SOCIAL_PROJECT_TOOL_MAX_BYTES, direction: "head" },
  },
  timeout: { defaultMs: 30_000, maxMs: 30_000, allowCallOverride: false },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage:
      "Project command was interrupted. Read the project before retrying because the Host may already have committed it.",
  },
  trace: { required: true, propagateToAdapters: false, recordInput: "summary", recordOutput: "summary" },
};
