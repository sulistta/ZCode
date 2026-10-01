import type { Event } from "@social-harness/rpc";
import type {
  CompleteInstagramConnectionRequest,
  DisconnectInstagramRequest,
  InstagramConnection,
  InstagramMedia,
  InstagramPublication,
  ApproveInstagramPublicationProposalRequest,
  ApproveInstagramPublicationRequest,
  RequestAutomatedInstagramPublicationRequest,
  ResolveInstagramPublicationRequest,
  ListInstagramMediaRequest,
  StartInstagramConnectionRequest,
  StartInstagramConnectionResult,
} from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";

export type {
  CompleteInstagramConnectionRequest,
  DisconnectInstagramRequest,
  InstagramConnection,
  InstagramConnectionProfile,
  InstagramMedia,
  InstagramPublication,
  ApproveInstagramPublicationRequest,
  ApproveInstagramPublicationProposalRequest,
  RequestAutomatedInstagramPublicationRequest,
  ResolveInstagramPublicationRequest,
  ListInstagramMediaRequest,
  StartInstagramConnectionRequest,
  StartInstagramConnectionResult,
} from "@social-harness/shared";

export type SocialPublishingConnectionChange = {
  accountId: string;
  status: InstagramConnection["status"];
};

export type SocialPublishingPublicationChange = {
  accountId: string;
  publicationId: string;
  status: InstagramPublication["status"];
};

/** Connection contract: OAuth codes and credentials never appear in returned projections. */
export interface ISocialPublishingService {
  listConnections(): Promise<InstagramConnection[]>;
  getConnection(accountId: string): Promise<InstagramConnection | null>;
  /** Public configuration projection only; never returns the bridge URL or any credential. */
  isInstagramAuthorizationAvailable(): Promise<boolean>;
  startInstagramConnection(
    request: StartInstagramConnectionRequest,
  ): Promise<StartInstagramConnectionResult>;
  completeInstagramConnection(
    request: CompleteInstagramConnectionRequest,
  ): Promise<InstagramConnection>;
  disconnectInstagram(request: DisconnectInstagramRequest): Promise<InstagramConnection>;
  listInstagramMedia(request: ListInstagramMediaRequest): Promise<InstagramMedia[]>;
  approveAndPublishInstagramReel(
    request: ApproveInstagramPublicationRequest,
  ): Promise<InstagramPublication>;
  requestAutomatedInstagramPublication(
    request: RequestAutomatedInstagramPublicationRequest,
  ): Promise<InstagramPublication>;
  approveInstagramPublicationProposal(
    request: ApproveInstagramPublicationProposalRequest,
  ): Promise<InstagramPublication>;
  listInstagramPublications(accountId: string): Promise<InstagramPublication[]>;
  resolveInstagramPublication(
    request: ResolveInstagramPublicationRequest,
  ): Promise<InstagramPublication>;
  onConnectionChanged: Event<SocialPublishingConnectionChange>;
  onPublicationChanged: Event<SocialPublishingPublicationChange>;
}

export const ISocialPublishingService = createServiceDescriptor<ISocialPublishingService>(
  ServiceChannels.SocialPublishing,
);
