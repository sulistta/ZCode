import { createHash } from "node:crypto";
import { Emitter } from "@social-harness/rpc";
import type {
  CompleteInstagramConnectionRequest,
  DisconnectInstagramRequest,
  InstagramConnection,
  StartInstagramConnectionRequest,
  StartInstagramConnectionResult,
  SocialMediaAsset,
} from "@social-harness/shared";
import {
  completeInstagramConnectionRequestSchema,
  disconnectInstagramRequestSchema,
  instagramConnectionProfileSchema,
  instagramConnectionSchema,
  socialAccountIdSchema,
  startInstagramConnectionRequestSchema,
} from "@social-harness/shared";
import type { ISocialPublishingService, SocialPublishingConnectionChange } from "../contract.js";
import { createSocialPublishingSetupService } from "./socialPublishingSetupService.js";
import { createInstagramConnectionProjector } from "./instagramConnectionProjection.js";
import { createInstagramMediaLister } from "./instagramMediaListService.js";
import { persistInstagramConnection } from "./instagramConnectionPersistence.js";
import { SocialPublishingError } from "./socialPublishingError.js";
export { SocialPublishingError } from "./socialPublishingError.js";
import {
  createSocialPublishingRuntimeState,
  defaultNonce,
  isSecureAuthorizationUrl,
  OAUTH_FLOW_TTL_MS,
} from "./socialPublishingRuntimeState.js";
import type { PendingAuthorization } from "./socialPublishingRuntimeState.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { createSocialPublishingPublicationService } from "./socialPublishingPublicationService.js";
import {
  requireInstagramMediaUploadCredential,
  revokeInstagramMediaCredentialBestEffort,
} from "./instagramMediaCredentialCleanup.js";

import type { SocialPublishingServiceOptions } from "./socialPublishingServiceOptions.js";

const logger = createServiceLogger("social-publishing");

export function createSocialPublishingService(
  options: SocialPublishingServiceOptions,
): ISocialPublishingService {
  let setupBusy = false;
  let authorizationAdmissions = 0;
  async function admitAuthorization<T>(operation: () => Promise<T>): Promise<T> {
    if (setupBusy)
      throw new SocialPublishingError("bridge-setup-busy", "Wait for bridge setup to finish.");
    authorizationAdmissions++;
    try {
      return await operation();
    } finally {
      authorizationAdmissions--;
    }
  }
  const now = options.now ?? Date.now;
  const createNonce = options.createNonce ?? defaultNonce;
  const changed = new Emitter<SocialPublishingConnectionChange>();
  const {
    pendingByState,
    pendingStateByAccount,
    withAccountLock,
    currentGeneration,
    advanceGeneration,
    removePendingForAccount,
    isPending,
  } = createSocialPublishingRuntimeState(now);

  const readPersistedProjection = createInstagramConnectionProjector({
    now,
    credentialStore: options.credentialStore,
    connectionStore: options.connectionStore,
    tokenRefresher: options.tokenRefresher,
    withAccountLock,
    acceptsCredential: options.authBridge?.acceptsCredential,
  });

  function notify(accountId: string, status: InstagramConnection["status"]): void {
    const event: SocialPublishingConnectionChange = { accountId, status };
    changed.fire(event);
  }

  async function requireAccount(accountId: string): Promise<void> {
    if (!(await options.accountService.get(accountId))) {
      throw new SocialPublishingError("account-not-found", "Social account not found.");
    }
  }

  async function project(accountId: string): Promise<InstagramConnection | null> {
    const normalizedAccountId = socialAccountIdSchema.parse(accountId);
    if (!(await options.accountService.get(normalizedAccountId))) return null;

    const pendingState = pendingStateByAccount.get(normalizedAccountId);
    const pending = pendingState ? pendingByState.get(pendingState) : undefined;
    if (isPending(pending)) {
      return instagramConnectionSchema.parse({
        accountId: normalizedAccountId,
        status: "connecting",
        profile: null,
        connectedAt: null,
      });
    }
    if (pending) removePendingForAccount(normalizedAccountId);

    return readPersistedProjection(normalizedAccountId);
  }

  const getConnection = (accountId: string) => project(accountId);

  const listInstagramMedia = createInstagramMediaLister({
    credentialStore: options.credentialStore,
    mediaReader: options.mediaReader,
    now,
    requireAccount,
    getConnection,
  });

  const publicationOperations = createSocialPublishingPublicationService({
    isSetupBusy: () => setupBusy,
    now,
    publication: options.publication,
    credentialStore: options.credentialStore,
    authBridge: options.authBridge,
    mediaReader: options.mediaReader,
    getAccount: (accountId) => options.accountService.get(accountId),
    listMedia: options.socialMediaService
      ? (accountId) => options.socialMediaService!.list(accountId)
      : async () => [] as SocialMediaAsset[],
    requireAccount,
    getConnection,
    getConnectionWhileAccountLocked: readPersistedProjection.readWhileAccountLocked,
    currentGeneration,
    withAccountLock,
  });

  async function startInstagramConnection(
    request: StartInstagramConnectionRequest,
  ): Promise<StartInstagramConnectionResult> {
    if (setupBusy)
      throw new SocialPublishingError("bridge-setup-busy", "Wait for project setup to finish.");
    const input = startInstagramConnectionRequestSchema.parse(request);
    await requireAccount(input.accountId);
    if (!options.authBridge) {
      throw new SocialPublishingError(
        "authorization-unavailable",
        "Instagram authorization is not configured on this installation.",
      );
    }
    const previous = await readPersistedProjection(input.accountId);
    const generation = advanceGeneration(input.accountId);
    removePendingForAccount(input.accountId);
    const state = createNonce();
    const codeVerifier = createNonce();
    const expiresAt = now() + OAUTH_FLOW_TTL_MS;
    const pending: PendingAuthorization = {
      accountId: input.accountId,
      generation,
      state,
      codeVerifier,
      expiresAt,
    };
    pendingByState.set(state, pending);
    pendingStateByAccount.set(input.accountId, state);
    notify(input.accountId, "connecting");

    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    try {
      const authorizeUrl = await options.authBridge.createAuthorization({
        accountId: input.accountId,
        state,
        codeChallenge,
      });
      if (currentGeneration(input.accountId) !== generation) {
        throw new SocialPublishingError(
          "authorization-invalid",
          "Instagram authorization was superseded. Start a new connection.",
        );
      }
      if (!isSecureAuthorizationUrl(authorizeUrl, state)) {
        throw new Error("Invalid Instagram authorization URL");
      }
      return { state, authorizeUrl, expiresAt };
    } catch (error) {
      if (pendingByState.get(state) === pending) {
        pendingByState.delete(state);
        if (pendingStateByAccount.get(input.accountId) === state) {
          pendingStateByAccount.delete(input.accountId);
        }
      }
      if (currentGeneration(input.accountId) === generation) {
        notify(input.accountId, previous.status);
      }
      if (error instanceof SocialPublishingError && error.code === "capacity-unavailable")
        throw error;
      throw new SocialPublishingError(
        "authorization-unavailable",
        "Could not start Instagram authorization. Try again.",
      );
    }
  }

  async function completeInstagramConnection(
    request: CompleteInstagramConnectionRequest,
  ): Promise<InstagramConnection> {
    const input = completeInstagramConnectionRequestSchema.parse(request);
    const authBridge = options.authBridge;
    if (!authBridge) {
      throw new SocialPublishingError(
        "authorization-unavailable",
        "Instagram authorization is not configured on this installation.",
      );
    }
    const pending = pendingByState.get(input.state);
    if (!pending) {
      throw new SocialPublishingError(
        "authorization-invalid",
        "Instagram authorization is invalid. Start a new connection.",
      );
    }
    const accountId = pending.accountId;
    const generation = pending.generation;
    if (currentGeneration(accountId) !== generation) {
      throw new SocialPublishingError(
        "authorization-invalid",
        "Instagram authorization was superseded. Start a new connection.",
      );
    }
    if (!isPending(pending)) {
      removePendingForAccount(accountId);
      const previous = await readPersistedProjection(accountId);
      notify(accountId, previous.status);
      throw new SocialPublishingError(
        "authorization-expired",
        "Instagram authorization expired. Start a new connection.",
      );
    }

    // Consume the pending state before any await so concurrent callbacks cannot race redemption.
    removePendingForAccount(accountId);
    await requireAccount(accountId);
    if (currentGeneration(accountId) !== generation) {
      throw new SocialPublishingError(
        "authorization-invalid",
        "Instagram authorization was superseded. Start a new connection.",
      );
    }
    const previous = await readPersistedProjection(accountId);
    let redeemedMediaUploadCredential: string | null = null;
    try {
      const tokens = await authBridge.redeemHandoff({
        handoffTicket: input.handoffTicket,
        codeVerifier: pending.codeVerifier,
      });
      redeemedMediaUploadCredential = requireInstagramMediaUploadCredential(
        tokens.mediaUploadCredential,
      );
      if (!tokens.accessToken.trim()) throw new Error("Instagram token is missing");
      const profile = instagramConnectionProfileSchema.parse(
        await options.verifyProfile(tokens.accessToken),
      );
      const connectedAt = Math.max(0, Math.trunc(now()));
      const connection = instagramConnectionSchema.parse({
        accountId,
        status: "connected",
        profile,
        connectedAt,
      });
      const previousTokens = await persistInstagramConnection({
        accountId,
        connectedAt,
        currentGeneration,
        credentialStore: options.credentialStore,
        connectionStore: options.connectionStore,
        generation,
        now,
        previousConnection: previous,
        profile,
        tokens,
        withAccountLock,
      });
      notify(accountId, "connected");
      if (
        previousTokens?.mediaUploadCredential &&
        previousTokens.mediaUploadCredential !== redeemedMediaUploadCredential
      ) {
        // 本地新连接已持久化，旧 key 可异步清理；不让网络延迟拖住重连成功状态。
        void revokeInstagramMediaCredentialBestEffort({
          accountId,
          authBridge,
          credential: previousTokens.mediaUploadCredential,
          reason: "replaced-after-reconnect",
        });
      }
      return connection;
    } catch (error) {
      // 验证或本地提交失败时撤销刚兑换的上传凭据，避免 Bridge 留下 Host 无法使用的权限。
      await revokeInstagramMediaCredentialBestEffort({
        accountId,
        authBridge,
        credential: redeemedMediaUploadCredential,
        reason: "rejected-connection",
      });
      if (currentGeneration(accountId) === generation) notify(accountId, previous.status);
      if (
        error instanceof SocialPublishingError &&
        ["authorization-invalid", "capacity-unavailable"].includes(error.code)
      ) {
        throw error;
      }
      throw new SocialPublishingError(
        "connection-failed",
        "Instagram could not be verified. Start a new connection and try again.",
      );
    }
  }

  async function disconnectInstagram(
    request: DisconnectInstagramRequest,
  ): Promise<InstagramConnection> {
    const input = disconnectInstagramRequestSchema.parse(request);
    await requireAccount(input.accountId);
    advanceGeneration(input.accountId);
    removePendingForAccount(input.accountId);
    const connection = await withAccountLock(input.accountId, async () => {
      const tokens = await options.credentialStore.load(input.accountId);
      await options.credentialStore.delete(input.accountId);
      await options.connectionStore.delete(input.accountId);
      if (tokens?.mediaUploadCredential && options.authBridge) {
        try {
          if (options.authBridge.revokeAllMediaUploadCredentials) {
            await options.authBridge.revokeAllMediaUploadCredentials(tokens.mediaUploadCredential);
          } else if (options.authBridge.revokeMediaUploadCredential) {
            await options.authBridge.revokeMediaUploadCredential(tokens.mediaUploadCredential);
          }
        } catch {
          logger.warn(
            undefined,
            "Instagram media credential revocation failed after local disconnect",
          );
        }
      }
      return instagramConnectionSchema.parse({
        accountId: input.accountId,
        status: "disconnected",
        profile: null,
        connectedAt: null,
      });
    });
    notify(input.accountId, "disconnected");
    return connection;
  }

  if (options.bridgeSetup && options.registerBridgeSetup) {
    options.registerBridgeSetup(
      createSocialPublishingSetupService({
        setup: options.bridgeSetup,
        isBusy: () =>
          setupBusy ||
          authorizationAdmissions > 0 ||
          [...pendingByState.values()].some(isPending) ||
          publicationOperations.isBusy(),
        setBusy: (busy) => {
          setupBusy = busy;
        },
        listConnections: async () =>
          Promise.all(
            (await options.accountService.list()).map((account) => project(account.accountId)),
          ),
      }),
    );
  }

  return {
    async isInstagramAuthorizationAvailable() {
      return options.authBridge?.isAvailable
        ? options.authBridge.isAvailable()
        : Boolean(options.authBridge);
    },
    async listConnections() {
      const accounts = await options.accountService.list();
      const connections = await Promise.all(accounts.map((account) => project(account.accountId)));
      return connections.filter(
        (connection): connection is InstagramConnection => connection != null,
      );
    },
    getConnection,
    startInstagramConnection: (request) =>
      admitAuthorization(() => startInstagramConnection(request)),
    completeInstagramConnection: (request) =>
      admitAuthorization(() => completeInstagramConnection(request)),
    disconnectInstagram: (request) => admitAuthorization(() => disconnectInstagram(request)),
    listInstagramMedia,
    ...publicationOperations.operations,
    onConnectionChanged: changed.event,
  };
}
