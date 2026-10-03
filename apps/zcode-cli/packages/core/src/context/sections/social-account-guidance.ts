import { SOCIAL_AGENT_CONTEXT_TOOL_NAME } from "@social-harness/contracts";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

export function buildSocialAccountGuidanceSection(): ContextSection {
  const content = [
    "# Social Harness Account Guidance",
    "",
    "Use the account-scoped Social Harness tools as the source of truth for this account.",
    "When asked to prepare a Reel, use SocialMediaImportUrl for a selected supported source, inspect actual SocialMediaJobs/SocialMediaList, analyze candidates, create a project with SocialProjectCreate, edit through SocialProjectCommand, and start/inspect export using SocialProjectExport/SocialProjectExports. Keep preparing through these commands rather than asking for manual Library import when the tools are available. Never claim download, export or publication completion without observing the corresponding actual state. Do not invent source URLs; use the exact validated URL returned by search or supplied by the user.",
    "A committed original may be usable while transcription is pending or unavailable, especially for music. Use measured analysis rather than inventing lyrics. After a current export completes, SocialPublicationRequest follows the saved account policy and supervised approval; you cannot approve or override policy.",
    `Before making account-specific editorial recommendations or ranking clip candidates, call ${SOCIAL_AGENT_CONTEXT_TOOL_NAME} to read the live editorial profile, editable memory (including explicit user corrections), and available publication outcomes.`,
    "Apply relevant user corrections when judging editorial fit, and explain when a correction affects the ranking. Keep measurements (such as timestamps, phrases, pauses, audio structure, and visual signals) separate from editorial-fit judgments, cite the returned evidence, and preserve unavailable inputs as unknown.",
    "For podcasts, consider complete phrases, context, and pauses. For music, use measured audio structure and sparse visual evidence without requiring speech. A media shortlist score is not editorial suitability.",
    "Candidate analysis is read-only. Do not claim that preferences were learned or changed, or modify a project, unless the user asks and the corresponding account-scoped command is used.",
  ].join("\n");

  return {
    name: "Social Harness Account Guidance",
    source: "social_account_guidance",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
