import type {
  InstagramConnection,
  InstagramMedia,
  ListInstagramMediaRequest,
} from "@social-harness/shared";
import { listInstagramMediaRequestSchema } from "@social-harness/shared";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import type { InstagramMediaReader } from "./ports/instagramMediaReader.js";
import { SocialPublishingError } from "./socialPublishingError.js";

interface InstagramMediaListServiceOptions {
  credentialStore: InstagramCredentialStore;
  mediaReader?: InstagramMediaReader;
  now: () => number;
  requireAccount: (accountId: string) => Promise<void>;
  getConnection: (accountId: string) => Promise<InstagramConnection | null>;
}

export function createInstagramMediaLister(options: InstagramMediaListServiceOptions) {
  return async function listInstagramMedia(
    request: ListInstagramMediaRequest,
  ): Promise<InstagramMedia[]> {
    const input = listInstagramMediaRequestSchema.parse(request);
    await options.requireAccount(input.accountId);
    const connection = await options.getConnection(input.accountId);
    if (
      !connection?.profile ||
      connection.status === "disconnected" ||
      connection.status === "connecting"
    ) {
      throw new SocialPublishingError(
        "instagram-not-connected",
        "Connect Instagram before loading account media.",
      );
    }
    if (connection.status !== "connected") {
      throw new SocialPublishingError(
        "authorization-expired",
        "Instagram authorization must be renewed before loading media.",
      );
    }
    if (!options.mediaReader) {
      throw new SocialPublishingError(
        "instagram-media-unavailable",
        "Instagram media is not available on this installation.",
      );
    }
    const tokens = await options.credentialStore.load(input.accountId);
    if (
      !tokens?.accessToken.trim() ||
      (tokens.expiresAt !== undefined && tokens.expiresAt <= options.now())
    ) {
      throw new SocialPublishingError(
        "authorization-expired",
        "Instagram authorization must be renewed before loading media.",
      );
    }
    try {
      return await options.mediaReader.list({
        instagramUserId: connection.profile.instagramUserId,
        accessToken: tokens.accessToken,
        limit: input.limit,
      });
    } catch {
      throw new SocialPublishingError(
        "instagram-media-unavailable",
        "Instagram media could not be loaded. Try again.",
      );
    }
  };
}
