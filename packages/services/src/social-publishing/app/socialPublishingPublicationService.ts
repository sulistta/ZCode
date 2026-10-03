import { Emitter } from "@social-harness/rpc";
import type {
  ApproveInstagramPublicationRequest,
  ApproveInstagramPublicationProposalRequest,
  InstagramConnection,
  InstagramPublication,
  SocialAccount,
  SocialMediaAsset,
  ResolveInstagramPublicationRequest,
  RequestAutomatedInstagramPublicationRequest,
} from "@social-harness/shared";
import type { ISocialProjectService } from "../../social-project/contract.js";
import type { SocialPublishingPublicationChange } from "../contract.js";
import type { InstagramAuthBridge } from "./ports/instagramAuthBridge.js";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import type { InstagramMediaReader } from "./ports/instagramMediaReader.js";
import type { InstagramPublicationStore } from "./ports/instagramPublicationStore.js";
import type { InstagramReelPublisher } from "./ports/instagramReelPublisher.js";
import type { SocialProjectExportArtifactReader } from "./ports/socialProjectExportArtifactReader.js";
import { SocialPublishingError } from "./socialPublishingError.js";
import { createInstagramPublicationWorkflow } from "./instagramPublicationWorkflow.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";

const logger = createServiceLogger("social-publishing-publication");

interface SocialPublishingPublicationServiceOptions {
  isSetupBusy?: () => boolean;
  now: () => number;
  credentialStore: InstagramCredentialStore;
  authBridge?: InstagramAuthBridge;
  mediaReader?: InstagramMediaReader;
  requireAccount: (accountId: string) => Promise<void>;
  getAccount: (accountId: string) => Promise<SocialAccount | null>;
  listMedia: (accountId: string) => Promise<SocialMediaAsset[]>;
  getConnection: (accountId: string) => Promise<InstagramConnection | null>;
  getConnectionWhileAccountLocked: (accountId: string) => Promise<InstagramConnection | null>;
  currentGeneration: (accountId: string) => number;
  withAccountLock: <T>(accountId: string, action: () => Promise<T>) => Promise<T>;
  publication?: {
    store: InstagramPublicationStore;
    projectService: Pick<ISocialProjectService, "get" | "getExport">;
    artifactReader: SocialProjectExportArtifactReader;
    publisher?: InstagramReelPublisher;
  };
}

export function createSocialPublishingPublicationService(
  options: SocialPublishingPublicationServiceOptions,
) {
  const changed = new Emitter<SocialPublishingPublicationChange>();
  let admissions = 0;
  const workflow = options.publication
    ? createInstagramPublicationWorkflow({
        now: options.now,
        store: options.publication.store,
        projectService: options.publication.projectService,
        artifactReader: options.publication.artifactReader,
        credentialStore: options.credentialStore,
        authBridge: options.authBridge,
        mediaReader: options.mediaReader,
        publisher: options.publication.publisher,
        requireAccount: options.requireAccount,
        getAccount: options.getAccount,
        listMedia: options.listMedia,
        getConnection: options.getConnection,
        getConnectionWhileAccountLocked: options.getConnectionWhileAccountLocked,
        currentGeneration: options.currentGeneration,
        withAccountLock: options.withAccountLock,
        onChanged: (publication) => {
          changed.fire({
            accountId: publication.accountId,
            publicationId: publication.publicationId,
            status: publication.status,
          });
        },
      })
    : undefined;

  if (workflow) {
    admissions++;
    void workflow
      .recoverPublications()
      .catch(() => {
        logger.warn(undefined, "Instagram publication recovery did not finish", {
          errorCode: "publication-recovery-failed",
        });
      })
      .finally(() => {
        admissions--;
      });
  }

  async function admit<T>(operation: () => Promise<T>): Promise<T> {
    if (options.isSetupBusy?.())
      throw new SocialPublishingError("bridge-setup-busy", "Wait for bridge setup to finish.");
    admissions++;
    try {
      return await operation();
    } finally {
      admissions--;
    }
  }

  async function unavailable(): Promise<never> {
    throw new SocialPublishingError(
      "publication-unavailable",
      "Instagram publishing is unavailable on this installation.",
    );
  }

  return {
    isBusy: () => admissions > 0 || Boolean(workflow?.isRunnerActive()),
    operations: {
      async approveAndPublishInstagramReel(
        request: ApproveInstagramPublicationRequest,
      ): Promise<InstagramPublication> {
        return admit(() =>
          workflow ? workflow.approveAndPublishInstagramReel(request) : unavailable(),
        );
      },
      async requestAutomatedInstagramPublication(
        request: RequestAutomatedInstagramPublicationRequest,
      ): Promise<InstagramPublication> {
        return admit(() =>
          workflow ? workflow.requestAutomatedInstagramPublication(request) : unavailable(),
        );
      },
      async approveInstagramPublicationProposal(
        request: ApproveInstagramPublicationProposalRequest,
      ): Promise<InstagramPublication> {
        return admit(() =>
          workflow ? workflow.approveInstagramPublicationProposal(request) : unavailable(),
        );
      },
      async listInstagramPublications(accountId: string): Promise<InstagramPublication[]> {
        return workflow ? workflow.listInstagramPublications(accountId) : unavailable();
      },
      async resolveInstagramPublication(
        request: ResolveInstagramPublicationRequest,
      ): Promise<InstagramPublication> {
        return admit(() =>
          workflow ? workflow.resolveInstagramPublication(request) : unavailable(),
        );
      },
      onPublicationChanged: changed.event,
    },
  };
}
