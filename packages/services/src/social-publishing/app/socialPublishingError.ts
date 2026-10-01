export type SocialPublishingErrorCode =
  | "account-not-found"
  | "authorization-unavailable"
  | "authorization-expired"
  | "authorization-invalid"
  | "instagram-not-connected"
  | "instagram-media-unavailable"
  | "connection-failed"
  | "publication-unavailable"
  | "publication-export-unavailable"
  | "publication-video-unsupported"
  | "publication-project-changed"
  | "publication-idempotency-conflict"
  | "publication-already-active"
  | "publication-policy-denied"
  | "publication-media-not-found";

export class SocialPublishingError extends Error {
  constructor(
    readonly code: SocialPublishingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SocialPublishingError";
  }
}
