import type { InstagramPublication } from "@social-harness/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { InstagramAuthTokenSet } from "./ports/instagramAuthBridge.js";
import type { InstagramPublicationStore } from "./ports/instagramPublicationStore.js";
import type { SocialProjectExportArtifactReader } from "./ports/socialProjectExportArtifactReader.js";
import {
  InstagramReelRemoteError,
  type InstagramReelPublisher,
} from "./ports/instagramReelPublisher.js";
import { SocialPublishingError } from "./socialPublishingError.js";
import type { InstagramPublicationWorkflowOptions } from "./instagramPublicationWorkflowOptions.js";
import { safeInstagramPermalink } from "./socialPublishingPermalink.js";

const logger = createServiceLogger("social-publishing-publication");

interface InstagramPublicationRunnerOptions {
  dependencies: InstagramPublicationWorkflowOptions;
  activeByAccount: Set<string>;
  wait: (milliseconds: number) => Promise<void>;
  pollIntervalMs: number;
  maxPollAttempts: number;
  requireConnectedTokens: (accountId: string) => Promise<{
    connection: NonNullable<
      Awaited<ReturnType<InstagramPublicationWorkflowOptions["getConnection"]>>
    >;
    tokens: InstagramAuthTokenSet;
  }>;
  update: (
    accountId: string,
    publicationId: string,
    patch: Partial<InstagramPublication>,
  ) => Promise<InstagramPublication>;
  markFailed: (
    publication: InstagramPublication,
    errorCode: NonNullable<InstagramPublication["errorCode"]>,
  ) => Promise<void>;
  reconcile: (
    publication: InstagramPublication,
    reason: NonNullable<InstagramPublication["reconciliationReason"]>,
  ) => Promise<void>;
  cleanupLease: (publication: InstagramPublication) => Promise<void>;
  store: InstagramPublicationStore;
  artifactReader: SocialProjectExportArtifactReader;
  publisher?: InstagramReelPublisher;
}

export function createInstagramPublicationRunner(options: InstagramPublicationRunnerOptions) {
  const { dependencies, activeByAccount } = options;

  return async function processPublication(
    publicationId: string,
    accountId: string,
    generation: number,
  ): Promise<void> {
    if (activeByAccount.has(accountId)) return;
    activeByAccount.add(accountId);
    try {
      await options.store.withRunnerLock(accountId, async () => {
        let publication = await options.store.get(accountId, publicationId);
        if (!publication || !ACTIVE_STATUSES.has(publication.status)) return;
        if (publication.status === "preparing-media") {
          const { tokens } = await options.requireConnectedTokens(accountId);
          if (dependencies.currentGeneration(accountId) !== generation) {
            await options.markFailed(publication, "account-not-connected");
            return;
          }
          if (!tokens.mediaUploadCredential || !dependencies.authBridge?.uploadTemporaryMedia) {
            await options.markFailed(publication, "media-upload-failed");
            return;
          }
          let media: Blob;
          try {
            media = await options.artifactReader.open({
              exportId: publication.exportId,
              expectedSha256: publication.exportSha256,
              expectedFileSizeBytes: publication.fileSizeBytes,
            });
            if (media.size !== publication.fileSizeBytes) throw new Error("Export size changed");
          } catch {
            await options.markFailed(publication, "export-unavailable");
            return;
          }
          let lease: { leaseId: string; mediaUrl: string; expiresAt: number };
          try {
            lease = await dependencies.authBridge.uploadTemporaryMedia({
              accountId,
              credential: tokens.mediaUploadCredential,
              file: media,
              idempotencyKey: publication.publicationId,
              sha256: publication.exportSha256,
            });
            const mediaUrl = new URL(lease.mediaUrl);
            if (mediaUrl.protocol !== "https:" || lease.expiresAt <= dependencies.now()) {
              throw new Error("Temporary media capability is invalid");
            }
          } catch {
            await options.markFailed(publication, "media-upload-failed");
            return;
          }
          publication = await options.update(accountId, publicationId, {
            status: "creating-container",
            mediaLeaseId: lease.leaseId,
          });
          if (!options.publisher) {
            await options.markFailed(publication, "container-rejected");
            return;
          }
          if (dependencies.currentGeneration(accountId) !== generation) {
            await options.markFailed(publication, "account-not-connected");
            return;
          }
          try {
            const { connection, tokens: latestTokens } =
              await options.requireConnectedTokens(accountId);
            if (dependencies.currentGeneration(accountId) !== generation) {
              await options.markFailed(publication, "account-not-connected");
              return;
            }
            const created = await options.publisher.createReelContainer({
              instagramUserId: connection.profile!.instagramUserId,
              accessToken: latestTokens.accessToken,
              videoUrl: lease.mediaUrl,
              caption: publication.caption,
            });
            publication = await options.update(accountId, publicationId, {
              status: "processing-container",
              containerId: created.containerId,
            });
          } catch (error) {
            if (error instanceof InstagramReelRemoteError && error.kind === "rejected") {
              await options.markFailed(publication, "container-rejected");
            } else {
              await options.reconcile(publication, "container-create-outcome-unknown");
            }
            return;
          }
        }

        if (publication.status !== "processing-container" || !publication.containerId) return;
        const containerId = publication.containerId;
        if (!options.publisher) {
          await options.markFailed(publication, "media-processing-failed");
          return;
        }
        let containerFinished = false;
        for (let attempt = 0; attempt < options.maxPollAttempts; attempt += 1) {
          try {
            const { tokens } = await options.requireConnectedTokens(accountId);
            const result = await options.publisher.getContainerStatus({
              containerId,
              accessToken: tokens.accessToken,
            });
            const status = result.statusCode.toUpperCase();
            publication = await options.update(accountId, publicationId, {
              status: "processing-container",
              containerStatus: status,
            });
            if (status === "FINISHED") {
              containerFinished = true;
              break;
            }
            if (status === "ERROR" || status === "EXPIRED") {
              await options.markFailed(publication, "media-processing-failed");
              return;
            }
          } catch (error) {
            if (error instanceof InstagramReelRemoteError && error.kind === "rejected") {
              await options.markFailed(publication, "media-processing-failed");
              return;
            }
            if (error instanceof SocialPublishingError) {
              await options.markFailed(publication, "account-not-connected");
              return;
            }
            // Status is a read-only Meta request and is safe to retry within the polling budget.
          }
          await options.wait(options.pollIntervalMs);
        }
        if (!containerFinished) return;
        publication = await options.update(accountId, publicationId, { status: "publishing" });
        if (dependencies.currentGeneration(accountId) !== generation) {
          await options.markFailed(publication, "account-not-connected");
          return;
        }
        try {
          const { connection, tokens } = await options.requireConnectedTokens(accountId);
          if (dependencies.currentGeneration(accountId) !== generation) {
            await options.markFailed(publication, "account-not-connected");
            return;
          }
          const result = await options.publisher.publishReel({
            instagramUserId: connection.profile!.instagramUserId,
            containerId,
            accessToken: tokens.accessToken,
          });
          publication = await options.update(accountId, publicationId, {
            status: "published",
            mediaId: result.mediaId,
            errorCode: undefined,
            reconciliationReason: undefined,
          });
          await options.cleanupLease(publication);
          if (dependencies.mediaReader) {
            try {
              const recentMedia = await dependencies.mediaReader.list({
                instagramUserId: connection.profile!.instagramUserId,
                accessToken: tokens.accessToken,
                limit: 25,
              });
              const permalink = safeInstagramPermalink(
                recentMedia.find((item) => item.mediaId === result.mediaId)?.permalink ?? null,
              );
              if (permalink) {
                publication = await options.update(accountId, publicationId, { permalink });
              }
            } catch {
              // The confirmed media ID remains durable even if the permalink read is temporarily unavailable.
            }
          }
        } catch (error) {
          if (error instanceof InstagramReelRemoteError && error.kind === "rejected") {
            await options.markFailed(publication, "publish-rejected");
          } else {
            await options.reconcile(publication, "publish-outcome-unknown");
          }
        }
      });
    } catch {
      const publication = await options.store.get(accountId, publicationId);
      if (publication && ACTIVE_STATUSES.has(publication.status)) {
        if (publication.status === "creating-container" || publication.status === "publishing") {
          try {
            await options.reconcile(
              publication,
              publication.status === "creating-container"
                ? "container-create-outcome-unknown"
                : "publish-outcome-unknown",
            );
          } catch {
            // The durable stage remains conservative and will be quarantined during next startup.
          }
        }
        logger.warn(undefined, "Instagram publication worker stopped", {
          accountId,
          publicationId,
          errorCode: "publication-worker-failed",
        });
      }
    } finally {
      activeByAccount.delete(accountId);
    }
  };
}

const ACTIVE_STATUSES = new Set<InstagramPublication["status"]>([
  "preparing-media",
  "creating-container",
  "processing-container",
  "publishing",
]);
