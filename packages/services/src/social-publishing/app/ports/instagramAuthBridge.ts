export interface InstagramAuthTokenSet {
  accessToken: string;
  expiresAt?: number;
  /** Host-local timestamp used to avoid refreshing the same long-lived token repeatedly. */
  refreshedAt?: number;
  /** Separate Host-only bridge credential; never returned to Renderer or Agent. */
  mediaUploadCredential?: string;
  bridgeOrigin?: string;
  bridgeInstallationHash?: string;
}

export interface InstagramAuthBridge {
  isAvailable?(): Promise<boolean>;
  acceptsCredential?(tokens: InstagramAuthTokenSet): Promise<boolean>;
  createAuthorization(input: {
    accountId: string;
    state: string;
    codeChallenge: string;
  }): Promise<string>;
  redeemHandoff(input: {
    handoffTicket: string;
    codeVerifier: string;
  }): Promise<InstagramAuthTokenSet>;
  revokeMediaUploadCredential?(credential: string): Promise<void>;
  revokeAllMediaUploadCredentials?(credential: string): Promise<void>;
  uploadTemporaryMedia?(input: {
    accountId: string;
    credential: string;
    file: Blob;
    idempotencyKey: string;
    sha256: string;
  }): Promise<{ leaseId: string; mediaUrl: string; expiresAt: number }>;
  deleteTemporaryMedia?(input: {
    accountId: string;
    credential: string;
    leaseId: string;
  }): Promise<void>;
}
