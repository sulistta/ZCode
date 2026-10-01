import type {
  SocialMediaTranscriptionModelId,
  SocialMediaTranscriptionSetup,
} from "@social-harness/shared";

export interface SocialMediaTranscriptionModelManager {
  getSetup(): Promise<SocialMediaTranscriptionSetup>;
  getInstalledModelPath(modelId: SocialMediaTranscriptionModelId): Promise<string | null>;
  selectModel(modelId: SocialMediaTranscriptionModelId): Promise<SocialMediaTranscriptionSetup>;
  downloadModel(
    modelId: SocialMediaTranscriptionModelId,
    onChanged: () => void,
  ): Promise<SocialMediaTranscriptionSetup>;
  cancelDownload(
    modelId: SocialMediaTranscriptionModelId,
    onChanged: () => void,
  ): Promise<SocialMediaTranscriptionSetup>;
  disposeAll(): void;
  disposeAllAndWait(): Promise<void>;
}
