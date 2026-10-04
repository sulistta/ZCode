/** Account-scoped source media catalog and managed-original module boundary. */
export const socialMediaModule = {
  id: "social-media",
  requires: ["shared", "rpc", "services", "social-account"],
  provides: ["social-media-service"],
  publicEntrypoints: ["contract.ts"],
} as const;
