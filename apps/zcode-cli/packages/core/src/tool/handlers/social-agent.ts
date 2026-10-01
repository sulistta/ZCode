import { createHash } from "node:crypto";
import {
  CoreErrorType,
  SOCIAL_AGENT_CONTEXT_TOOL_NAME,
  SOCIAL_CLIP_CANDIDATES_TOOL_NAME,
  SOCIAL_MEDIA_LIST_TOOL_NAME,
  SOCIAL_YOUTUBE_SEARCH_TOOL_NAME,
  SOCIAL_PUBLICATION_REQUEST_TOOL_NAME,
  SocialAgentContextInputJsonSchema,
  SocialAgentContextInputSchema,
  SocialClipCandidatesInputJsonSchema,
  SocialClipCandidatesInputSchema,
  SocialMediaListInputJsonSchema,
  SocialMediaListInputSchema,
  SocialYouTubeSearchInputJsonSchema,
  SocialYouTubeSearchInputSchema,
  SocialPublicationRequestInputJsonSchema,
  SocialPublicationRequestInputSchema,
  SocialAgentReadOutputJsonSchema,
  createCoreError,
  type SocialAgentPort,
} from "@social-harness/contracts";
import type { ToolEntry, ToolExecutionContext } from "../types.js";

const SOCIAL_AGENT_TOOL_MAX_BYTES = 64_000;

function requireSocialAgentPort(context: ToolExecutionContext, toolName: string): SocialAgentPort {
  if (context.socialAgentPort) return context.socialAgentPort;
  throw createCoreError(CoreErrorType.ConfigurationError, `${toolName} is not available here`, {
    context: { toolCallId: context.toolCallId, toolName },
    recoverable: false,
  });
}

function readOptions(context: ToolExecutionContext) {
  return { signal: context.abortSignal, traceContext: context.traceContext };
}

const socialAgentContextHandler: ToolEntry["handler"] = async (input, context) => {
  SocialAgentContextInputSchema.parse(input);
  return { context: await requireSocialAgentPort(context, SOCIAL_AGENT_CONTEXT_TOOL_NAME).getContext(readOptions(context)) };
};

const socialMediaListHandler: ToolEntry["handler"] = async (input, context) => {
  SocialMediaListInputSchema.parse(input);
  return { assets: await requireSocialAgentPort(context, SOCIAL_MEDIA_LIST_TOOL_NAME).listMedia(readOptions(context)) };
};

const socialYouTubeSearchHandler: ToolEntry["handler"] = async (input, context) => {
  const parsed = SocialYouTubeSearchInputSchema.parse(input);
  return {
    results: await requireSocialAgentPort(context, SOCIAL_YOUTUBE_SEARCH_TOOL_NAME).searchYouTube(
      parsed.query,
      readOptions(context),
    ),
  };
};

const socialClipCandidatesHandler: ToolEntry["handler"] = async (input, context) => {
  const parsed = SocialClipCandidatesInputSchema.parse(input);
  return {
    result: await requireSocialAgentPort(context, SOCIAL_CLIP_CANDIDATES_TOOL_NAME).suggestClipCandidates(
      parsed,
      readOptions(context),
    ),
  };
};

const socialPublicationRequestHandler: ToolEntry["handler"] = async (input, context) => {
  const parsed = SocialPublicationRequestInputSchema.parse(input);
  const requestId = createHash("sha256").update(context.toolCallId).digest("base64url");
  return {
    publication: await requireSocialAgentPort(context, SOCIAL_PUBLICATION_REQUEST_TOOL_NAME).requestPublication(
      { ...parsed, requestId },
      readOptions(context),
    ),
  };
};

const readPermission = {
  permission: "social.media.read",
  reason: "Read editorial context and media belonging only to the account bound to this conversation",
  riskLevel: "low" as const,
  sideEffectScope: "none" as const,
  needsApproval: false,
  patternSources: ["toolName" as const],
  alwaysAllowPatternSources: ["toolName" as const],
  denyPriority: "beforeAsk" as const,
};

const networkReadPermission = {
  ...readPermission,
  sideEffectScope: "network" as const,
};

function createReadToolEntry(options: {
  name: string;
  description: string;
  inputSchema: ToolEntry["inputSchema"];
  runtimeInputSchema: ToolEntry["runtimeInputSchema"];
  handler: ToolEntry["handler"];
  network?: boolean;
}): ToolEntry {
  const permission = options.network ? networkReadPermission : readPermission;
  const sideEffectScope = options.network ? "network" : "none";
  return {
    capability: options.description,
    metadata: {
      name: options.name,
      description: options.description,
      readOnly: true,
      destructive: false,
      concurrentSafe: true,
      timeoutMs: options.network ? 45_000 : 30_000,
      maxOutputBytes: SOCIAL_AGENT_TOOL_MAX_BYTES,
      sideEffectScope,
      riskLevel: "low",
      needsApproval: false,
    },
    handler: options.handler,
    inputSchema: options.inputSchema,
    outputSchema: SocialAgentReadOutputJsonSchema,
    runtimeInputSchema: options.runtimeInputSchema,
    permission,
    resultBudget: {
      maxInlineBytes: SOCIAL_AGENT_TOOL_MAX_BYTES,
      maxModelBytes: SOCIAL_AGENT_TOOL_MAX_BYTES,
      strategy: "truncate",
      preview: { maxBytes: SOCIAL_AGENT_TOOL_MAX_BYTES, direction: "head" },
    },
    timeout: {
      defaultMs: options.network ? 45_000 : 30_000,
      maxMs: options.network ? 45_000 : 30_000,
      allowCallOverride: false,
    },
    cancellation: {
      supported: true,
      cleanup: "none",
      userVisibleMessage: `${options.name} was cancelled before it returned.`,
    },
    trace: { required: true, propagateToAdapters: false, recordInput: "summary", recordOutput: "summary" },
  };
}

export const socialAgentContextToolEntry = createReadToolEntry({
  name: SOCIAL_AGENT_CONTEXT_TOOL_NAME,
  description:
    "Read the current account's editorial profile, policy, projects, and recent publication outcomes before planning or ranking content. Apply the profile and editable memory, including explicit user corrections, as current guidance. Treat unavailable publication history as unknown, not as evidence that nothing was published.",
  inputSchema: SocialAgentContextInputJsonSchema,
  runtimeInputSchema: SocialAgentContextInputSchema,
  handler: socialAgentContextHandler,
});

export const socialMediaListToolEntry = createReadToolEntry({
  name: SOCIAL_MEDIA_LIST_TOOL_NAME,
  description:
    "List media available to the current social account. Results contain safe metadata, never local file paths or credentials.",
  inputSchema: SocialMediaListInputJsonSchema,
  runtimeInputSchema: SocialMediaListInputSchema,
  handler: socialMediaListHandler,
});

export const socialYouTubeSearchToolEntry = createReadToolEntry({
  name: SOCIAL_YOUTUBE_SEARCH_TOOL_NAME,
  description:
    "Search YouTube for source videos to add to the current account's media library. This does not download videos.",
  inputSchema: SocialYouTubeSearchInputJsonSchema,
  runtimeInputSchema: SocialYouTubeSearchInputSchema,
  handler: socialYouTubeSearchHandler,
  network: true,
});

export const socialClipCandidatesToolEntry = createReadToolEntry({
  name: SOCIAL_CLIP_CANDIDATES_TOOL_NAME,
  description:
    "Analyze a media asset already in the current account's library and return measured candidate windows, not editorial rankings. Read SocialAgentGetContext first, then compare evidence with the account's niche, audience, language, tone, references, visual style, editable memory (including explicit user corrections), and available publication outcomes. Apply relevant corrections and explain when they affect editorial fit. For podcasts, consider measured complete phrases, context, and pauses; for music, consider measured audio structure/rhythm and sparse visual evidence without requiring speech. Separate measured facts from editorial-fit judgments, cite timestamps and returned evidence, and call out unavailable inputs. Never invent transcripts, heatmaps, signals, or publication outcomes. This is read-only and does not export a project.",
  inputSchema: SocialClipCandidatesInputJsonSchema,
  runtimeInputSchema: SocialClipCandidatesInputSchema,
  handler: socialClipCandidatesHandler,
});

export const socialPublicationRequestToolEntry: ToolEntry = {
  capability:
    "Request publication of a completed Instagram export under the current account policy",
  metadata: {
    name: SOCIAL_PUBLICATION_REQUEST_TOOL_NAME,
    description:
      "Request publication of a current completed export. The Host rechecks source, cadence, and limits. If the account is supervised, this creates a proposal that waits for user approval; if autonomy is enabled, the Host may publish within the saved policy. You cannot approve proposals or override account policy.",
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: 30_000,
    maxOutputBytes: SOCIAL_AGENT_TOOL_MAX_BYTES,
    sideEffectScope: "network",
    riskLevel: "high",
    needsApproval: false,
  },
  handler: socialPublicationRequestHandler,
  inputSchema: SocialPublicationRequestInputJsonSchema,
  outputSchema: SocialAgentReadOutputJsonSchema,
  runtimeInputSchema: SocialPublicationRequestInputSchema,
  permission: {
    permission: "social.publication.request",
    reason: "Request publication under the current account's saved policy",
    riskLevel: "high",
    sideEffectScope: "network",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: SOCIAL_AGENT_TOOL_MAX_BYTES,
    maxModelBytes: SOCIAL_AGENT_TOOL_MAX_BYTES,
    strategy: "truncate",
    preview: { maxBytes: SOCIAL_AGENT_TOOL_MAX_BYTES, direction: "head" },
  },
  timeout: { defaultMs: 30_000, maxMs: 30_000, allowCallOverride: false },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage:
      "A publication request may already have started and needs review in the project.",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
