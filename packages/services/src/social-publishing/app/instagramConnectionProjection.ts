import type { InstagramConnection } from "@social-harness/shared";
import { instagramConnectionSchema } from "@social-harness/shared";
import type { InstagramConnectionStore } from "./ports/instagramConnectionStore.js";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import type { InstagramTokenRefresher } from "./ports/instagramTokenRefresher.js";
import { MIN_TOKEN_AGE_MS, TOKEN_REFRESH_WINDOW_MS } from "./socialPublishingRuntimeState.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";

const logger = createServiceLogger("social-publishing");

interface InstagramConnectionProjectionOptions {
  now: () => number;
  credentialStore: InstagramCredentialStore;
  connectionStore: InstagramConnectionStore;
  tokenRefresher?: InstagramTokenRefresher;
  withAccountLock: <T>(accountId: string, operation: () => Promise<T>) => Promise<T>;
}

export function createInstagramConnectionProjector(options: InstagramConnectionProjectionOptions) {
  async function readProjectionWhileLocked(accountId: string): Promise<InstagramConnection> {
    const record = await options.connectionStore.get(accountId);
    if (!record) {
      return instagramConnectionSchema.parse({
        accountId,
        status: "disconnected",
        profile: null,
        connectedAt: null,
      });
    }
    let tokens = await options.credentialStore.load(accountId);
    const tokenIsUsable = Boolean(
      tokens?.accessToken.trim() &&
      (tokens.expiresAt === undefined || tokens.expiresAt > options.now()),
    );
    const lastIssuedAt = tokens?.refreshedAt ?? record.connectedAt;
    const shouldRefresh = Boolean(
      tokenIsUsable &&
      tokens?.expiresAt &&
      tokens.expiresAt - options.now() <= TOKEN_REFRESH_WINDOW_MS &&
      options.now() - lastIssuedAt >= MIN_TOKEN_AGE_MS &&
      options.tokenRefresher,
    );
    if (shouldRefresh && tokens && options.tokenRefresher) {
      try {
        const refreshed = await options.tokenRefresher.refresh(tokens.accessToken);
        if (
          !refreshed.accessToken.trim() ||
          refreshed.expiresAt === undefined ||
          refreshed.expiresAt <= options.now()
        ) {
          throw new Error("Instagram token refresh returned an unusable token");
        }
        const refreshedTokens = {
          ...tokens,
          ...refreshed,
          refreshedAt: Math.trunc(options.now()),
        };
        await options.credentialStore.store(accountId, refreshedTokens);
        tokens = refreshedTokens;
      } catch {
        logger.warn(undefined, "Instagram token refresh failed", {
          accountId,
          errorCode: "refresh-failed",
        });
      }
    }
    const tokenStillUsable = Boolean(
      tokens?.accessToken.trim() &&
      (tokens.expiresAt === undefined || tokens.expiresAt > options.now()),
    );
    return instagramConnectionSchema.parse({
      accountId,
      status: tokenStillUsable ? "connected" : "reauth-required",
      profile: record.profile,
      connectedAt: record.connectedAt,
    });
  }

  const readPersistedProjection = Object.assign(
    (accountId: string) =>
      options.withAccountLock(accountId, () => readProjectionWhileLocked(accountId)),
    { readWhileAccountLocked: readProjectionWhileLocked },
  );
  return readPersistedProjection;
}
