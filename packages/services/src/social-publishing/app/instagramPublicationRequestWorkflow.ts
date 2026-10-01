import type {
  ApproveInstagramPublicationRequest,
  InstagramPublication,
  RequestAutomatedInstagramPublicationRequest,
  SocialProjectExportJob,
} from "@social-harness/shared";
import { instagramPublicationSchema } from "@social-harness/shared";
import type { InstagramPublicationWorkflowOptions } from "./instagramPublicationWorkflowOptions.js";
import {
  assertAutomationPublicationLimit,
  requireAllowedAutomationSources,
} from "./instagramAutomationPublicationPolicy.js";
import { InstagramPublicationActiveConflictError } from "./ports/instagramPublicationStore.js";
import { SocialPublishingError } from "./socialPublishingError.js";

const ACTIVE_STATUSES = new Set<InstagramPublication["status"]>([
  "preparing-media",
  "creating-container",
  "processing-container",
  "publishing",
]);

function sameRequest(
  left: InstagramPublication,
  right: ApproveInstagramPublicationRequest | RequestAutomatedInstagramPublicationRequest,
): boolean {
  return (
    left.accountId === right.accountId &&
    left.exportId === right.exportId &&
    left.caption === right.caption
  );
}

export function createInstagramPublicationRequestWorkflow(options: {
  workflow: InstagramPublicationWorkflowOptions;
  activeByAccount: Set<string>;
  createPublicationId: () => string;
  processPublication: (
    publicationId: string,
    accountId: string,
    generation: number,
  ) => Promise<void>;
  requireConnectedTokens: (accountId: string) => Promise<unknown>;
  requireCurrentExport: (accountId: string, exportId: string) => Promise<SocialProjectExportJob>;
}) {
  const {
    workflow,
    activeByAccount,
    createPublicationId,
    processPublication,
    requireConnectedTokens,
    requireCurrentExport,
  } = options;

  return async function createPublicationRequest(
    request: ApproveInstagramPublicationRequest | RequestAutomatedInstagramPublicationRequest,
    trigger: "manual" | "automation",
  ): Promise<InstagramPublication> {
    await workflow.requireAccount(request.accountId);
    const priorAttempt = (await workflow.store.list(request.accountId)).find(
      (candidate) => candidate.requestId === request.requestId,
    );
    if (priorAttempt) {
      if (!sameRequest(priorAttempt, request)) {
        throw new SocialPublishingError(
          "publication-idempotency-conflict",
          "Request ID was already used for another publication.",
        );
      }
      if (ACTIVE_STATUSES.has(priorAttempt.status) && !activeByAccount.has(request.accountId)) {
        void processPublication(
          priorAttempt.publicationId,
          priorAttempt.accountId,
          workflow.currentGeneration(request.accountId),
        );
      }
      return priorAttempt;
    }
    const { publication, created } = await workflow.withAccountLock(request.accountId, async () => {
      const previous = (await workflow.store.list(request.accountId)).find(
        (candidate) => candidate.requestId === request.requestId,
      );
      if (previous) {
        if (!sameRequest(previous, request)) {
          throw new SocialPublishingError(
            "publication-idempotency-conflict",
            "Request ID was already used for another publication.",
          );
        }
        return { publication: previous, created: false };
      }
      const active = (await workflow.store.list(request.accountId)).find((candidate) =>
        ACTIVE_STATUSES.has(candidate.status),
      );
      if (active) {
        throw new SocialPublishingError(
          "publication-already-active",
          "Another Instagram publication is still in progress.",
        );
      }
      const job = await requireCurrentExport(request.accountId, request.exportId);
      const timestamp = Math.max(0, Math.trunc(workflow.now()));
      let status: InstagramPublication["status"] = "preparing-media";
      let approvedAt: number | undefined;
      let automationAuthorizedAt: number | undefined;
      if (trigger === "manual") {
        await requireConnectedTokens(request.accountId);
        approvedAt = timestamp;
      } else {
        const account = await workflow.getAccount(request.accountId);
        if (!account) {
          throw new SocialPublishingError("account-not-found", "Social account not found.");
        }
        const policy = account.automationPolicy;
        if (!policy.autonomyEnabled) {
          status = "approval-required";
        } else {
          await requireAllowedAutomationSources(workflow, request.accountId, job, policy);
          assertAutomationPublicationLimit(
            await workflow.store.list(request.accountId),
            policy,
            timestamp,
          );
          await requireConnectedTokens(request.accountId);
          automationAuthorizedAt = timestamp;
        }
      }
      const nextPublication = instagramPublicationSchema.parse({
        publicationId: createPublicationId(),
        requestId: request.requestId,
        accountId: request.accountId,
        projectId: job.projectId,
        projectRevision: job.projectRevision,
        exportId: job.exportId,
        exportSha256: job.sha256,
        fileSizeBytes: job.fileSizeBytes,
        durationMs: job.durationMs,
        caption: request.caption,
        status,
        trigger,
        ...(approvedAt !== undefined ? { approvedAt } : {}),
        ...(automationAuthorizedAt !== undefined ? { automationAuthorizedAt } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      try {
        return await workflow.store.createIfAbsent(nextPublication);
      } catch (error) {
        if (error instanceof InstagramPublicationActiveConflictError) {
          throw new SocialPublishingError(
            "publication-already-active",
            "Another Instagram publication is still in progress.",
          );
        }
        throw error;
      }
    });
    if (!sameRequest(publication, request)) {
      throw new SocialPublishingError(
        "publication-idempotency-conflict",
        "Request ID was already used for another publication.",
      );
    }
    if (created) workflow.onChanged(publication);
    if (ACTIVE_STATUSES.has(publication.status) && !activeByAccount.has(request.accountId)) {
      void processPublication(
        publication.publicationId,
        publication.accountId,
        workflow.currentGeneration(request.accountId),
      );
    }
    return publication;
  };
}
