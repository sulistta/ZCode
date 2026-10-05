import { createHash } from "node:crypto";
import {
  CoreErrorType,
  createCoreError,
  SOCIAL_MEDIA_IMPORT_TOOL_NAME,
  SOCIAL_MEDIA_JOBS_TOOL_NAME,
  SOCIAL_MEDIA_JOB_COMMAND_TOOL_NAME,
  SOCIAL_PROJECT_CREATE_TOOL_NAME,
  SOCIAL_PROJECT_EXPORT_TOOL_NAME,
  SOCIAL_PROJECT_EXPORTS_TOOL_NAME,
  SocialMediaImportInputSchema,
  SocialMediaImportInputJsonSchema,
  SocialMediaJobsInputSchema,
  SocialMediaJobsInputJsonSchema,
  SocialMediaJobCommandInputSchema,
  SocialMediaJobCommandInputJsonSchema,
  SocialProjectCreateInputSchema,
  SocialProjectCreateInputJsonSchema,
  SocialProjectExportInputSchema,
  SocialProjectExportInputJsonSchema,
  SocialProjectExportsInputSchema,
  SocialProjectExportsInputJsonSchema,
  type SocialAgentPort,
} from "@social-harness/contracts";
import type { ToolEntry, ToolExecutionContext } from "../types.js";

const MAX_OUTPUT_BYTES = 64_000;
const COMMAND_TIMEOUT_MS = 30_000;
function port(context: ToolExecutionContext): SocialAgentPort {
  if (context.socialAgentPort) return context.socialAgentPort;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    "Social preparation tools require an account-scoped conversation.",
    { recoverable: false },
  );
}
function callOptions(context: ToolExecutionContext) {
  return { signal: context.abortSignal, traceContext: context.traceContext };
}
function requestId(context: ToolExecutionContext) {
  // 工具重放复用 runtime call ID，不能由模型另造幂等键导致重复项目或导出。
  return createHash("sha256").update(context.toolCallId).digest("hex");
}
function entry(input: {
  name: string;
  description: string;
  inputSchema: ToolEntry["inputSchema"];
  runtimeInputSchema: ToolEntry["runtimeInputSchema"];
  handler: ToolEntry["handler"];
  effect: "none" | "workspace" | "network";
  omitInput?: boolean;
}): ToolEntry {
  const readOnly = input.effect === "none";
  return {
    capability: input.description,
    metadata: {
      name: input.name,
      description: input.description,
      readOnly,
      destructive: false,
      concurrentSafe: readOnly,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      sideEffectScope: input.effect,
      riskLevel: readOnly ? "low" : "medium",
      needsApproval: false,
    },
    handler: input.handler,
    inputSchema: input.inputSchema,
    runtimeInputSchema: input.runtimeInputSchema,
    outputSchema: { type: "object" },
    permission: {
      permission: readOnly ? "social.preparation.read" : "social.preparation.write",
      reason: "Prepare media and projects under the bound account's existing Host owners",
      riskLevel: readOnly ? "low" : "medium",
      sideEffectScope: input.effect,
      needsApproval: false,
      patternSources: ["toolName"],
      alwaysAllowPatternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: MAX_OUTPUT_BYTES,
      maxModelBytes: MAX_OUTPUT_BYTES,
      strategy: "truncate",
      preview: { maxBytes: MAX_OUTPUT_BYTES, direction: "head" },
    },
    timeout: { defaultMs: COMMAND_TIMEOUT_MS, maxMs: COMMAND_TIMEOUT_MS, allowCallOverride: false },
    cancellation: {
      supported: readOnly,
      cleanup: "none",
      userVisibleMessage: readOnly
        ? "The read was cancelled."
        : "The admitted Host job may continue. Inspect its state and cancel it explicitly when needed.",
    },
    trace: {
      required: true,
      propagateToAdapters: false,
      recordInput: input.omitInput ? "none" : "summary",
      recordOutput: "summary",
    },
  };
}
export const socialProductionToolEntries: ToolEntry[] = [
  entry({
    name: SOCIAL_MEDIA_IMPORT_TOOL_NAME,
    description:
      "Import a selected supported HTTPS source URL into this account through the existing downloader. This admits an asynchronous job; inspect SocialMediaJobs and SocialMediaList before claiming the original is ready. Search alone does not import. No local path, credentials or other account can be supplied.",
    inputSchema: SocialMediaImportInputJsonSchema,
    runtimeInputSchema: SocialMediaImportInputSchema,
    effect: "network",
    omitInput: true,
    handler: async (input, context) => ({
      job: await port(context).importSource(
        SocialMediaImportInputSchema.parse(input).url,
        callOptions(context),
      ),
    }),
  }),
  entry({
    name: SOCIAL_MEDIA_JOBS_TOOL_NAME,
    description:
      "Read actual media job state and safe error codes. A committed mediaId can be analyzed during transcription; music does not require speech recognition. Failed jobs need an explicit retry.",
    inputSchema: SocialMediaJobsInputJsonSchema,
    runtimeInputSchema: SocialMediaJobsInputSchema,
    effect: "none",
    handler: async (input, context) => ({
      jobs: await port(context).listMediaJobs(
        SocialMediaJobsInputSchema.parse(input),
        callOptions(context),
      ),
    }),
  }),
  entry({
    name: SOCIAL_MEDIA_JOB_COMMAND_TOOL_NAME,
    description:
      "Explicitly cancel or retry one of this account's existing media jobs. Retry preserves managed originals and existing source deduplication.",
    inputSchema: SocialMediaJobCommandInputJsonSchema,
    runtimeInputSchema: SocialMediaJobCommandInputSchema,
    effect: "workspace",
    handler: async (input, context) => ({
      job: await port(context).mediaJobCommand(
        SocialMediaJobCommandInputSchema.parse(input),
        callOptions(context),
      ),
    }),
  }),
  entry({
    name: SOCIAL_PROJECT_CREATE_TOOL_NAME,
    description:
      "Create a project in this account for a user-requested Reel. Creation is idempotent for the current tool call. Use the returned projectId with SocialProjectRead and revisioned SocialProjectCommand; user edit control remains enforced.",
    inputSchema: SocialProjectCreateInputJsonSchema,
    runtimeInputSchema: SocialProjectCreateInputSchema,
    effect: "workspace",
    handler: async (input, context) => ({
      project: await port(context).createProject(
        { ...SocialProjectCreateInputSchema.parse(input), requestId: requestId(context) },
        callOptions(context),
      ),
    }),
  }),
  entry({
    name: SOCIAL_PROJECT_EXPORT_TOOL_NAME,
    description:
      "Start an immutable export of the project's exact current revision. Inspect SocialProjectExports until the actual job completes. This does not publish or approve anything.",
    inputSchema: SocialProjectExportInputJsonSchema,
    runtimeInputSchema: SocialProjectExportInputSchema,
    effect: "workspace",
    handler: async (input, context) => ({
      job: await port(context).startExport(
        { ...SocialProjectExportInputSchema.parse(input), requestId: requestId(context) },
        callOptions(context),
      ),
    }),
  }),
  entry({
    name: SOCIAL_PROJECT_EXPORTS_TOOL_NAME,
    description:
      "Read actual export state, progress and safe failure codes for this account. Only a completed export of the current project revision can be requested for publication.",
    inputSchema: SocialProjectExportsInputJsonSchema,
    runtimeInputSchema: SocialProjectExportsInputSchema,
    effect: "none",
    handler: async (input, context) => ({
      jobs: await port(context).listExports(
        SocialProjectExportsInputSchema.parse(input),
        callOptions(context),
      ),
    }),
  }),
];
