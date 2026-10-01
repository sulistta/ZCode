import { SOCIAL_AGENT_CONTEXT_TOOL_NAME } from "@social-harness/contracts";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

export function buildSocialAccountGuidanceSection(): ContextSection {
  const content = [
    "# Social Harness Account Guidance",
    "",
    "Use the account-scoped Social Harness tools as the source of truth for this account.",
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
