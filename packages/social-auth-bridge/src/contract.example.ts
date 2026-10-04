import type { InstagramAuthAuthorizeRequest, InstagramAuthRedeemRequest } from "./contract.js";

/** The Host binds OAuth handoff and its separate media credential to one local account. */
export const instagramAuthBridgeExample = {
  authorize: {
    state: "random-host-owned-state",
    codeChallenge: "base64url-sha256-of-host-owned-verifier",
    accountId: "local-social-account-id",
  } satisfies InstagramAuthAuthorizeRequest,
  redeem: {
    handoffTicket: "single-use-ticket-from-desktop-callback",
    codeVerifier: "original-host-owned-pkce-verifier",
  } satisfies InstagramAuthRedeemRequest,
  mediaUpload: {
    method: "POST",
    path: "/v1/media/upload",
    headers: {
      authorization: "Bearer host-vault-media-credential",
      "idempotency-key": "publication-request-id",
      "x-social-account-id": "local-social-account-id",
      "x-content-sha256": "64-character-lowercase-sha256",
      "content-type": "video/mp4",
    },
    response: {
      leaseId: "opaque-cleanup-id",
      mediaUrl: "https://bridge.example.test/v1/media/random-capability",
      expiresAt: 1_800_000_000_000,
    },
  },
  mediaFetch: {
    method: "GET",
    path: "/v1/media/random-capability",
    description: "Public, unguessable URL served only until its short expiry.",
  },
} as const;
