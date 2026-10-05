import { buildRuntimeZCodeApiUrl, resolveZaiBusinessBaseUrl } from "@social-harness/shared";

export const SOCIAL_HARNESS_CLIENT_SCENES_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
