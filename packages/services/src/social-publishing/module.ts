/** Instagram connection and publishing-capability module boundary. */
export const socialPublishingModule = {
  id: "social-publishing",
  requires: ["shared", "rpc", "services", "social-account", "social-media", "social-project"],
  provides: ["social-publishing-service"],
  publicEntrypoints: ["contract.ts"],
} as const;
