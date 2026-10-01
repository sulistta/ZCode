import type {
  SocialMediaTranscriptionModelId,
  SocialMediaTranscriptionSetup,
} from "@social-harness/shared";
import type { SocialMediaTranscriptionModelManager } from "../../src/social-media/app/ports/socialMediaTranscriptionModelManager.js";
import type { SocialMediaTranscriber } from "../../src/social-media/app/ports/socialMediaTranscriber.js";

const modelSizes = {
  tiny: 77_691_713,
  base: 147_951_465,
  small: 487_601_967,
  "large-v3-turbo": 1_624_555_275,
} satisfies Record<SocialMediaTranscriptionModelId, number>;

export function createTestTranscriptionModelManager(): SocialMediaTranscriptionModelManager {
  let selectedModelId: SocialMediaTranscriptionModelId = "small";
  const getSetup = async (): Promise<SocialMediaTranscriptionSetup> => ({
    selectedModelId,
    models: (Object.keys(modelSizes) as SocialMediaTranscriptionModelId[]).map((modelId) => ({
      modelId,
      sizeBytes: modelSizes[modelId],
      installed: false,
      downloading: false,
      downloadedBytes: 0,
      errorCode: null,
    })),
    updatedAt: 100,
  });
  return {
    getSetup,
    async getInstalledModelPath() {
      return "/private/models/ggml-small.bin";
    },
    async selectModel(modelId) {
      selectedModelId = modelId;
      return getSetup();
    },
    async downloadModel(_modelId, onChanged) {
      onChanged();
      return getSetup();
    },
    async cancelDownload(_modelId, onChanged) {
      onChanged();
      return getSetup();
    },
    disposeAll() {},
    async disposeAllAndWait() {},
  };
}

export function createTestTranscriber(): SocialMediaTranscriber {
  return {
    start(input) {
      return {
        completion: Promise.resolve({
          method: "whisper-local",
          languageCode: input.languageCode,
          modelId: input.modelId,
          segments: [{ startSeconds: 0, endSeconds: 1, text: "Local transcript" }],
          createdAt: input.createdAt,
        }),
        async cancel() {},
      };
    },
  };
}
