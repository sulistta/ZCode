export const socialAgentModule = {
  id: "social-agent",
  requires: ["shared", "social-account", "social-media", "social-project", "social-publishing"],
  provides: ["account-scoped-agent-context"],
  publicEntrypoints: ["contract.ts"],
} as const;
