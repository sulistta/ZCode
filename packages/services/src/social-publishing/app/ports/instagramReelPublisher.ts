export interface InstagramReelPublisher {
  createReelContainer(input: {
    instagramUserId: string;
    accessToken: string;
    videoUrl: string;
    caption: string;
  }): Promise<{ containerId: string }>;
  getContainerStatus(input: {
    containerId: string;
    accessToken: string;
  }): Promise<{ statusCode: string; statusMessage?: string }>;
  publishReel(input: {
    instagramUserId: string;
    containerId: string;
    accessToken: string;
  }): Promise<{ mediaId: string }>;
}

export type InstagramReelRemoteFailureKind = "rejected" | "unknown";

export class InstagramReelRemoteError extends Error {
  constructor(readonly kind: InstagramReelRemoteFailureKind) {
    super("Instagram Reel request failed");
    this.name = "InstagramReelRemoteError";
  }
}
