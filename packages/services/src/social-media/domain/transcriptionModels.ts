import type { SocialMediaTranscriptionModelId } from "@social-harness/shared";

export interface SocialMediaTranscriptionModelDefinition {
  modelId: SocialMediaTranscriptionModelId;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
}

const MODEL_REPOSITORY = "https://huggingface.co/ggerganov/whisper.cpp/resolve";

export const SOCIAL_MEDIA_TRANSCRIPTION_MODELS: Readonly<
  Record<SocialMediaTranscriptionModelId, SocialMediaTranscriptionModelDefinition>
> = {
  tiny: {
    modelId: "tiny",
    fileName: "ggml-tiny.bin",
    sizeBytes: 77_691_713,
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    downloadUrl: `${MODEL_REPOSITORY}/main/ggml-tiny.bin`,
  },
  base: {
    modelId: "base",
    fileName: "ggml-base.bin",
    sizeBytes: 147_951_465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    downloadUrl: `${MODEL_REPOSITORY}/main/ggml-base.bin`,
  },
  small: {
    modelId: "small",
    fileName: "ggml-small.bin",
    sizeBytes: 487_601_967,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    downloadUrl: `${MODEL_REPOSITORY}/main/ggml-small.bin`,
  },
  "large-v3-turbo": {
    modelId: "large-v3-turbo",
    fileName: "ggml-large-v3-turbo.bin",
    sizeBytes: 1_624_555_275,
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/98aa99a0a9db05ae2342309f5096248665f7cba3/ggml-large-v3-turbo.bin",
  },
};
