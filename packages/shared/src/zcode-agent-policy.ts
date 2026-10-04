import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { ZCodeProvider } from "./zcode-task-types-core.js";

export const SOCIAL_HARNESS_AGENT_PROVIDER = "glm" satisfies ZCodeProvider;
export const SOCIAL_HARNESS_AGENT_PROVIDER_LABEL = "ZCode Agent";
export const SOCIAL_HARNESS_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

export const zcodeAgentProviderSchema = z.literal(SOCIAL_HARNESS_AGENT_PROVIDER);

export const SOCIAL_HARNESS_COMMAND_AGENT_SOURCES = [
  SOCIAL_HARNESS_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToZCodeAgent(
  _provider?: ZCodeProvider | null,
): ZCodeProvider {
  return SOCIAL_HARNESS_AGENT_PROVIDER;
}

export function isZCodeAgentProvider(
  provider: ZCodeProvider | null | undefined,
): provider is typeof SOCIAL_HARNESS_AGENT_PROVIDER {
  return provider === SOCIAL_HARNESS_AGENT_PROVIDER;
}
