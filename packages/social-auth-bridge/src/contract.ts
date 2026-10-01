export interface InstagramAuthAuthorizeRequest {
  state: string;
  codeChallenge: string;
  accountId: string;
}

export interface InstagramAuthAuthorizeResponse {
  authorizeUrl: string;
}

export interface InstagramAuthRedeemRequest {
  handoffTicket: string;
  codeVerifier: string;
}

export interface InstagramAuthTokenSet {
  accessToken: string;
  expiresAt: number;
  mediaUploadCredential: string;
}

export interface InstagramGraphTokenSet {
  accessToken: string;
  expiresAt: number;
}

export const instagramAuthBridgeRoutes = {
  authorize: "POST /v1/instagram/authorize",
  callback: "GET /v1/instagram/callback",
  redeem: "POST /v1/instagram/redeem",
  uploadTemporaryMedia: "POST /v1/media/upload",
  deleteTemporaryMedia: "DELETE /v1/media/:leaseId",
  revokeMediaCredential: "DELETE /v1/media/credential",
  revokeAllMediaCredentials: "DELETE /v1/media/credentials",
  fetchTemporaryMedia: "GET /v1/media/:capability",
} as const;
