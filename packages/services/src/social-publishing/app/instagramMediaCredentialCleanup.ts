import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { InstagramAuthBridge } from "./ports/instagramAuthBridge.js";

const logger = createServiceLogger("social-publishing");
const MEDIA_UPLOAD_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;

export function requireInstagramMediaUploadCredential(credential: string | undefined): string {
  if (!credential || !MEDIA_UPLOAD_CREDENTIAL_PATTERN.test(credential)) {
    throw new Error("Instagram media upload credential is missing");
  }
  return credential;
}

export async function revokeInstagramMediaCredentialBestEffort(input: {
  accountId: string;
  authBridge: InstagramAuthBridge;
  credential: string | null;
  reason: "rejected-connection" | "replaced-after-reconnect";
}): Promise<void> {
  if (!input.credential) return;
  try {
    if (!input.authBridge.revokeMediaUploadCredential) {
      throw new Error("Instagram media upload credential revocation is unavailable");
    }
    await input.authBridge.revokeMediaUploadCredential(input.credential);
  } catch {
    logger.warn(undefined, "Instagram media credential cleanup failed", {
      accountId: input.accountId,
      errorCode: "media-credential-revocation-failed",
      reason: input.reason,
    });
  }
}
