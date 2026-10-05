import type {
  InstagramConnection,
  InstagramPublication,
  SocialAccount,
  SocialMediaAsset,
} from "@social-harness/shared";
import type { ISocialProjectService } from "../../social-project/contract.js";
import type { InstagramAuthBridge } from "./ports/instagramAuthBridge.js";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import type { InstagramMediaReader } from "./ports/instagramMediaReader.js";
import type { InstagramPublicationStore } from "./ports/instagramPublicationStore.js";
import type { InstagramReelPublisher } from "./ports/instagramReelPublisher.js";
import type { SocialProjectExportArtifactReader } from "./ports/socialProjectExportArtifactReader.js";

export interface InstagramPublicationWorkflowOptions {
  now: () => number;
  createPublicationId?: () => string;
  store: InstagramPublicationStore;
  projectService: Pick<ISocialProjectService, "get" | "getExport">;
  artifactReader: SocialProjectExportArtifactReader;
  credentialStore: InstagramCredentialStore;
  authBridge?: InstagramAuthBridge;
  mediaReader?: InstagramMediaReader;
  publisher?: InstagramReelPublisher;
  requireAccount: (accountId: string) => Promise<void>;
  getAccount: (accountId: string) => Promise<SocialAccount | null>;
  listMedia: (accountId: string) => Promise<SocialMediaAsset[]>;
  getConnection: (accountId: string) => Promise<InstagramConnection | null>;
  getConnectionWhileAccountLocked?: (accountId: string) => Promise<InstagramConnection | null>;
  currentGeneration: (accountId: string) => number;
  withAccountLock: <T>(accountId: string, action: () => Promise<T>) => Promise<T>;
  onChanged: (publication: InstagramPublication) => void;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}
