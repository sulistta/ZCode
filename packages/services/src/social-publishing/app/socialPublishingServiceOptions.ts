import type { InstagramConnectionProfile } from "@social-harness/shared";
import type { ISocialAccountService } from "../../social-account/contract.js";
import type { ISocialMediaService } from "../../social-media/contract.js";
import type { ISocialInstagramSetupService } from "../setupContract.js";
import type { InstagramBridgeSetup } from "./ports/instagramBridgeSetup.js";
import type { InstagramAuthBridge } from "./ports/instagramAuthBridge.js";
import type { InstagramConnectionStore } from "./ports/instagramConnectionStore.js";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import type { InstagramTokenRefresher } from "./ports/instagramTokenRefresher.js";
import type { InstagramMediaReader } from "./ports/instagramMediaReader.js";
import type { InstagramPublicationStore } from "./ports/instagramPublicationStore.js";
import type { InstagramReelPublisher } from "./ports/instagramReelPublisher.js";
import type { SocialProjectExportArtifactReader } from "./ports/socialProjectExportArtifactReader.js";
import type { ISocialProjectService } from "../../social-project/contract.js";

export interface SocialPublishingServiceOptions {
  accountService: Pick<ISocialAccountService, "get" | "list">;
  authBridge?: InstagramAuthBridge;
  bridgeSetup?: InstagramBridgeSetup;
  registerBridgeSetup?: (service: ISocialInstagramSetupService) => void;
  credentialStore: InstagramCredentialStore;
  tokenRefresher?: InstagramTokenRefresher;
  mediaReader?: InstagramMediaReader;
  socialMediaService?: Pick<ISocialMediaService, "list">;
  connectionStore: InstagramConnectionStore;
  publication?: {
    store: InstagramPublicationStore;
    projectService: Pick<ISocialProjectService, "get" | "getExport">;
    artifactReader: SocialProjectExportArtifactReader;
    publisher?: InstagramReelPublisher;
  };
  verifyProfile: (accessToken: string) => Promise<InstagramConnectionProfile>;
  now?: () => number;
  createNonce?: () => string;
}
