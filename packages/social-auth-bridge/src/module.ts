/** Maintainer-operated Instagram OAuth bridge. */
export const socialAuthBridgeModule = {
  id: "social-auth-bridge",
  requires: [],
  provides: ["instagram-oauth-handoff", "temporary-media-capabilities"],
  publicEntrypoints: ["app.ts", "contract.ts"],
} as const;
