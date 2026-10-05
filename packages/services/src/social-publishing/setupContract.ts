import type {
  InstagramBridgeSetup,
  ProvisionInstagramBridgeRequest,
  ConfigureInstagramBridgeMetaRequest,
} from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";
/** Desktop-only provisioning surface. Input secrets are ephemeral; projections contain none. */
export interface ISocialInstagramSetupService {
  getInstagramBridgeSetup(): Promise<InstagramBridgeSetup>;
  provisionInstagramBridge(request: ProvisionInstagramBridgeRequest): Promise<InstagramBridgeSetup>;
  configureInstagramBridgeMeta(
    request: ConfigureInstagramBridgeMetaRequest,
  ): Promise<InstagramBridgeSetup>;
  validateInstagramBridgeSetup(): Promise<InstagramBridgeSetup>;
}
export const ISocialInstagramSetupService = createServiceDescriptor<ISocialInstagramSetupService>(
  ServiceChannels.SocialInstagramSetup,
);
