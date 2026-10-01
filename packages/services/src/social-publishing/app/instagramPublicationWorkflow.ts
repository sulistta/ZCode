import { randomUUID } from "node:crypto";
import type {
  ApproveInstagramPublicationRequest,
  InstagramMedia,
  InstagramPublication,
  ResolveInstagramPublicationRequest,
  ApproveInstagramPublicationProposalRequest,
  RequestAutomatedInstagramPublicationRequest,
} from "@social-harness/shared";
import {
  approveInstagramPublicationProposalRequestSchema,
  approveInstagramPublicationRequestSchema,
  instagramPublicationSchema,
  requestAutomatedInstagramPublicationRequestSchema,
  resolveInstagramPublicationRequestSchema,
} from "@social-harness/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { SocialPublishingError } from "./socialPublishingError.js";
import { createInstagramPublicationRunner } from "./instagramPublicationRunner.js";
import { createInstagramPublicationRequestWorkflow } from "./instagramPublicationRequestWorkflow.js";
import type { InstagramPublicationWorkflowOptions } from "./instagramPublicationWorkflowOptions.js";
import { safeInstagramPermalink } from "./socialPublishingPermalink.js";

const logger = createServiceLogger("social-publishing-publication");
const MAX_REEL_BYTES = 1_073_741_824;
const MIN_REEL_DURATION_MS = 3_000;
const MAX_REEL_DURATION_MS = 900_000;
const MAX_REEL_FRAME_DIMENSION = 1920;
const MIN_REEL_FRAME_RATE = 23;
const MAX_REEL_FRAME_RATE = 60;
const ACTIVE_STATUSES = new Set<InstagramPublication["status"]>([
  "preparing-media",
  "creating-container",
  "processing-container",
  "publishing",
]);

export function createInstagramPublicationWorkflow(options: InstagramPublicationWorkflowOptions) {
  const createPublicationId = options.createPublicationId ?? randomUUID;
  const activeByAccount = new Set<string>();
  const wait =
    options.wait ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const maxPollAttempts = options.maxPollAttempts ?? 60;

  async function update(
    accountId: string,
    publicationId: string,
    patch: Partial<InstagramPublication>,
    guard?: (current: InstagramPublication) => boolean,
  ): Promise<InstagramPublication> {
    const updated = await options.store.update(accountId, publicationId, (current) => {
      if (guard && !guard(current)) {
        throw new SocialPublishingError(
          "publication-unavailable",
          "Publication was resolved by another request.",
        );
      }
      return instagramPublicationSchema.parse({
        ...current,
        ...patch,
        updatedAt: Math.max(current.updatedAt + 1, Math.trunc(options.now())),
      });
    });
    if (!updated)
      throw new SocialPublishingError("publication-unavailable", "Publication is unavailable.");
    options.onChanged(updated);
    return updated;
  }

  async function requireConnectedTokens(accountId: string, readConnection = options.getConnection) {
    const connection = await readConnection(accountId);
    if (!connection?.profile || connection.status !== "connected") {
      throw new SocialPublishingError(
        "instagram-not-connected",
        "Connect Instagram before publishing.",
      );
    }
    const tokens = await options.credentialStore.load(accountId);
    if (
      !tokens?.accessToken.trim() ||
      (tokens.expiresAt !== undefined && tokens.expiresAt <= options.now())
    ) {
      throw new SocialPublishingError(
        "authorization-expired",
        "Reconnect Instagram before publishing.",
      );
    }
    return { connection, tokens };
  }

  async function requireConnectedTokensWhileAccountLocked(accountId: string) {
    // 已持有账号锁时改用无锁内层读取，避免同一把非重入锁再次等待自身释放。
    return requireConnectedTokens(
      accountId,
      options.getConnectionWhileAccountLocked ?? options.getConnection,
    );
  }

  async function requireCurrentExport(accountId: string, exportId: string) {
    const job = await options.projectService.getExport(accountId, exportId);
    if (
      !job ||
      job.status !== "completed" ||
      job.accountId !== accountId ||
      !job.sha256 ||
      !job.fileSizeBytes ||
      !job.durationMs
    ) {
      throw new SocialPublishingError(
        "publication-export-unavailable",
        "Completed export is unavailable.",
      );
    }
    if (
      job.fileSizeBytes > MAX_REEL_BYTES ||
      job.durationMs < MIN_REEL_DURATION_MS ||
      job.durationMs > MAX_REEL_DURATION_MS
    ) {
      throw new SocialPublishingError(
        "publication-video-unsupported",
        "Export does not meet Instagram Reel limits.",
      );
    }
    const readModel = await options.projectService.get(accountId, job.projectId);
    if (!readModel || readModel.project.revision !== job.projectRevision) {
      throw new SocialPublishingError(
        "publication-project-changed",
        "Project changed after this export was created.",
      );
    }
    const settings = readModel.project.settings;
    const frameRate = settings.frameRate.numerator / settings.frameRate.denominator;
    if (
      settings.width > MAX_REEL_FRAME_DIMENSION ||
      settings.height > MAX_REEL_FRAME_DIMENSION ||
      frameRate < MIN_REEL_FRAME_RATE ||
      frameRate > MAX_REEL_FRAME_RATE
    ) {
      throw new SocialPublishingError(
        "publication-video-unsupported",
        "Project dimensions or frame rate do not meet Instagram Reel limits.",
      );
    }
    return job;
  }

  async function cleanupLease(publication: InstagramPublication): Promise<void> {
    if (!publication.mediaLeaseId || !options.authBridge?.deleteTemporaryMedia) return;
    try {
      const tokens = await options.credentialStore.load(publication.accountId);
      if (!tokens?.mediaUploadCredential) return;
      await options.authBridge.deleteTemporaryMedia({
        accountId: publication.accountId,
        credential: tokens.mediaUploadCredential,
        leaseId: publication.mediaLeaseId,
      });
    } catch {
      logger.warn(undefined, "Temporary Instagram media cleanup failed", {
        accountId: publication.accountId,
        publicationId: publication.publicationId,
        errorCode: "media-cleanup-failed",
      });
    }
  }

  async function markFailed(
    publication: InstagramPublication,
    errorCode: NonNullable<InstagramPublication["errorCode"]>,
  ): Promise<void> {
    const failed = await update(publication.accountId, publication.publicationId, {
      status: "failed",
      errorCode,
    });
    await cleanupLease(failed);
  }

  async function reconcile(
    publication: InstagramPublication,
    reason: NonNullable<InstagramPublication["reconciliationReason"]>,
  ): Promise<void> {
    await update(publication.accountId, publication.publicationId, {
      status: "reconciliation-required",
      errorCode: "remote-outcome-unknown",
      reconciliationReason: reason,
    });
  }

  const processPublication = createInstagramPublicationRunner({
    dependencies: options,
    activeByAccount,
    wait,
    pollIntervalMs,
    maxPollAttempts,
    requireConnectedTokens,
    update,
    markFailed,
    reconcile,
    cleanupLease,
    store: options.store,
    artifactReader: options.artifactReader,
    publisher: options.publisher,
  });
  const createPublicationRequest = createInstagramPublicationRequestWorkflow({
    workflow: options,
    activeByAccount,
    createPublicationId,
    processPublication,
    requireConnectedTokens: requireConnectedTokensWhileAccountLocked,
    requireCurrentExport,
  });

  async function approveAndPublishInstagramReel(
    input: ApproveInstagramPublicationRequest,
  ): Promise<InstagramPublication> {
    const request = approveInstagramPublicationRequestSchema.parse(input);
    return createPublicationRequest(request, "manual");
  }

  async function requestAutomatedInstagramPublication(
    input: RequestAutomatedInstagramPublicationRequest,
  ): Promise<InstagramPublication> {
    const request = requestAutomatedInstagramPublicationRequestSchema.parse(input);
    return createPublicationRequest(request, "automation");
  }

  async function approveInstagramPublicationProposal(
    input: ApproveInstagramPublicationProposalRequest,
  ): Promise<InstagramPublication> {
    const request = approveInstagramPublicationProposalRequestSchema.parse(input);
    await options.requireAccount(request.accountId);
    const publication = await options.withAccountLock(request.accountId, async () => {
      const current = await options.store.get(request.accountId, request.publicationId);
      if (!current || current.status !== "approval-required") {
        throw new SocialPublishingError(
          "publication-unavailable",
          "Publication proposal is unavailable for approval.",
        );
      }
      await requireConnectedTokensWhileAccountLocked(request.accountId);
      await requireCurrentExport(request.accountId, current.exportId);
      const active = (await options.store.list(request.accountId)).find((candidate) =>
        ACTIVE_STATUSES.has(candidate.status),
      );
      if (active) {
        throw new SocialPublishingError(
          "publication-already-active",
          "Another Instagram publication is still in progress.",
        );
      }
      return update(
        request.accountId,
        request.publicationId,
        {
          status: "preparing-media",
          approvedAt: Math.max(0, Math.trunc(options.now())),
        },
        (candidate) => candidate.status === "approval-required",
      );
    });
    if (!activeByAccount.has(request.accountId)) {
      void processPublication(
        publication.publicationId,
        publication.accountId,
        options.currentGeneration(request.accountId),
      );
    }
    return publication;
  }

  async function listInstagramPublications(accountId: string): Promise<InstagramPublication[]> {
    await options.requireAccount(accountId);
    return options.store.list(accountId);
  }

  async function resolveInstagramPublication(
    input: ResolveInstagramPublicationRequest,
  ): Promise<InstagramPublication> {
    const request = resolveInstagramPublicationRequestSchema.parse(input);
    await options.requireAccount(request.accountId);
    const current = await options.store.get(request.accountId, request.publicationId);
    if (!current || current.status !== "reconciliation-required") {
      throw new SocialPublishingError(
        "publication-unavailable",
        "Publication does not need reconciliation.",
      );
    }
    const reconciledAt = Math.max(0, Math.trunc(options.now()));
    if (request.outcome === "not-published") {
      const publication = await update(
        request.accountId,
        request.publicationId,
        {
          status: "not-published",
          reconciliationOutcome: "not-published",
          reconciledAt,
          errorCode: undefined,
          reconciliationReason: undefined,
        },
        (candidate) => candidate.status === "reconciliation-required",
      );
      await cleanupLease(publication);
      return publication;
    }
    const permalink = safeInstagramPermalink(request.permalink);
    if (!permalink || !options.mediaReader) {
      throw new SocialPublishingError(
        "publication-media-not-found",
        "That Instagram post could not be verified for this account.",
      );
    }
    const { connection, tokens } = await requireConnectedTokens(request.accountId);
    let media: InstagramMedia[];
    try {
      media = await options.mediaReader.list({
        instagramUserId: connection.profile!.instagramUserId,
        accessToken: tokens.accessToken,
        limit: 25,
      });
    } catch {
      throw new SocialPublishingError(
        "publication-media-not-found",
        "That Instagram post could not be verified for this account.",
      );
    }
    const verified = media.find(
      (item) => item.permalink && safeInstagramPermalink(item.permalink) === permalink,
    );
    if (!verified) {
      throw new SocialPublishingError(
        "publication-media-not-found",
        "That Instagram post could not be verified for this account.",
      );
    }
    const publication = await update(
      request.accountId,
      request.publicationId,
      {
        status: "published",
        mediaId: verified.mediaId,
        permalink,
        reconciliationOutcome: "published",
        reconciledAt,
        errorCode: undefined,
        reconciliationReason: undefined,
      },
      (candidate) => candidate.status === "reconciliation-required",
    );
    await cleanupLease(publication);
    return publication;
  }

  async function recoverPublications(): Promise<void> {
    const publications = await options.store.listAll();
    for (const publication of publications) {
      if (publication.status === "creating-container" || publication.status === "publishing") {
        await reconcile(publication, "host-restarted");
      } else if (
        publication.status === "preparing-media" ||
        publication.status === "processing-container"
      ) {
        void processPublication(
          publication.publicationId,
          publication.accountId,
          options.currentGeneration(publication.accountId),
        );
      }
    }
  }

  return {
    approveAndPublishInstagramReel,
    requestAutomatedInstagramPublication,
    approveInstagramPublicationProposal,
    listInstagramPublications,
    resolveInstagramPublication,
    recoverPublications,
  };
}
