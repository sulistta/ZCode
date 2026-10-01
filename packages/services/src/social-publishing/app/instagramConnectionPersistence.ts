import type { InstagramConnection, InstagramConnectionProfile } from "@social-harness/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { InstagramAuthTokenSet } from "./ports/instagramAuthBridge.js";
import type { InstagramConnectionStore } from "./ports/instagramConnectionStore.js";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import { SocialPublishingError } from "./socialPublishingError.js";

const logger = createServiceLogger("social-publishing");

export async function persistInstagramConnection(options: {
  accountId: string;
  connectedAt: number;
  currentGeneration: (accountId: string) => number;
  credentialStore: InstagramCredentialStore;
  connectionStore: InstagramConnectionStore;
  generation: number;
  now: () => number;
  previousConnection: InstagramConnection;
  profile: InstagramConnectionProfile;
  tokens: InstagramAuthTokenSet;
  withAccountLock: <T>(accountId: string, operation: () => Promise<T>) => Promise<T>;
}): Promise<InstagramAuthTokenSet | null> {
  return options.withAccountLock(options.accountId, async () => {
    if (options.currentGeneration(options.accountId) !== options.generation) {
      throw new SocialPublishingError(
        "authorization-invalid",
        "Instagram authorization was superseded. Start a new connection.",
      );
    }
    const previousTokens = await options.credentialStore.load(options.accountId);
    let credentialWasStored = false;
    let connectionRecordWasStored = false;
    try {
      await options.credentialStore.store(options.accountId, {
        ...options.tokens,
        refreshedAt: Math.trunc(options.now()),
      });
      credentialWasStored = true;
      if (options.currentGeneration(options.accountId) !== options.generation) {
        throw new SocialPublishingError(
          "authorization-invalid",
          "Instagram authorization was superseded. Start a new connection.",
        );
      }
      await options.connectionStore.put(options.accountId, {
        profile: options.profile,
        connectedAt: options.connectedAt,
      });
      connectionRecordWasStored = true;
      if (options.currentGeneration(options.accountId) !== options.generation) {
        throw new SocialPublishingError(
          "authorization-invalid",
          "Instagram authorization was superseded. Start a new connection.",
        );
      }
      return previousTokens;
    } catch (error) {
      if (connectionRecordWasStored) {
        try {
          if (
            options.previousConnection.profile &&
            options.previousConnection.connectedAt !== null
          ) {
            await options.connectionStore.put(options.accountId, {
              profile: options.previousConnection.profile,
              connectedAt: options.previousConnection.connectedAt,
            });
          } else {
            await options.connectionStore.delete(options.accountId);
          }
        } catch {
          logger.warn(undefined, "Instagram profile rollback failed", {
            accountId: options.accountId,
            errorCode: "profile-rollback-failed",
          });
        }
      }
      if (credentialWasStored) {
        try {
          if (previousTokens) {
            await options.credentialStore.store(options.accountId, previousTokens);
          } else {
            await options.credentialStore.delete(options.accountId);
          }
        } catch {
          // Fail closed in the projection when credential rollback is unavailable.
          logger.warn(undefined, "Instagram credential rollback failed", {
            accountId: options.accountId,
            errorCode: "credential-rollback-failed",
          });
        }
      }
      throw error;
    }
  });
}
