/** Account-scoped editor document and revisioned-command module boundary. */
export const socialProjectModule = {
  id: "social-project",
  requires: ["shared", "rpc", "services", "social-account", "social-media", "opencut-core"],
  provides: ["social-project-service"],
  publicEntrypoints: ["contract.ts"],
} as const;
