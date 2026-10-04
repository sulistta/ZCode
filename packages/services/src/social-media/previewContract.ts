import type {
  SocialMediaJob,
  SocialMediaPreview,
  SocialMediaPreviewRequest,
} from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";

export type { SocialMediaPreview, SocialMediaPreviewRequest } from "@social-harness/shared";

export interface ISocialMediaPreviewService {
  prepare(request: SocialMediaPreviewRequest): Promise<SocialMediaPreview>;
  requestProxy(request: SocialMediaPreviewRequest): Promise<SocialMediaJob>;
}

export const ISocialMediaPreviewService = createServiceDescriptor<ISocialMediaPreviewService>(
  ServiceChannels.SocialMediaPreview,
);
