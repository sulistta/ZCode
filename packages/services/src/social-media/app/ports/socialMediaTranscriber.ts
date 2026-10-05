import type {
  SocialMediaTranscript,
  SocialMediaTranscriptionModelId,
} from "@social-harness/shared";

export interface SocialMediaTranscriptionTask {
  completion: Promise<Extract<SocialMediaTranscript, { method: "whisper-local" }>>;
  cancel(): Promise<void>;
}

export interface SocialMediaTranscriber {
  start(input: {
    mediaPath: string;
    workingDirectory: string;
    modelPath: string;
    modelId: SocialMediaTranscriptionModelId;
    languageCode: string;
    createdAt: number;
  }): SocialMediaTranscriptionTask;
}
