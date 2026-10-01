/** Social account and editorial-profile module boundary. */
export const socialAccountModule = {
  id: "social-account",
  requires: ["shared", "rpc", "services"],
  provides: ["social-account-service"],
  publicEntrypoints: ["contract.ts"],
} as const;
