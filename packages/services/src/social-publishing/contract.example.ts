import type {
  ApproveInstagramPublicationRequest,
  ISocialPublishingService,
  ResolveInstagramPublicationRequest,
} from "./contract.js";

/** Read whether the user-owned bridge is ready. */
export function isInstagramAuthorizationAvailable(service: ISocialPublishingService) {
  return service.isInstagramAuthorizationAvailable();
}

/** Complete an OAuth callback using only the opaque ticket returned by the bridge. */
export async function completeInstagramOAuthCallback(
  service: ISocialPublishingService,
  state: string,
  handoffTicket: string,
) {
  return service.completeInstagramConnection({
    state,
    handoffTicket,
  });
}

/** A button press is the approval; the Host binds it to an immutable completed export. */
export function approveInstagramReel(
  service: ISocialPublishingService,
  request: ApproveInstagramPublicationRequest,
) {
  return service.approveAndPublishInstagramReel(request);
}

/** Resolve an uncertain remote outcome only after checking the connected Instagram account. */
export function resolveInstagramReel(
  service: ISocialPublishingService,
  request: ResolveInstagramPublicationRequest,
) {
  return service.resolveInstagramPublication(request);
}

/** Open the assistant with safe project configuration; credentials never appear in the projection. */
export function readInstagramBridgeSetup(
  service: import("./setupContract.js").ISocialInstagramSetupService,
) {
  return service.getInstagramBridgeSetup();
}
