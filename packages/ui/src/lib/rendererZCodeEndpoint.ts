import {
  buildRuntimeZCodeEndpointUrls,
  SOCIAL_HARNESS_ENV,
  type RuntimeZCodeEndpointEnv,
} from "@social-harness/shared";

interface RendererImportMetaEnv {
  VITE_SOCIAL_HARNESS_BASE_URL?: string;
  VITE_SOCIAL_HARNESS_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererZCodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeZCodeEndpointEnv {
  return {
    SOCIAL_HARNESS_ENV,
    // UI 侧的 zcode-plan 占位 provider 以前只看 SOCIAL_HARNESS_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    SOCIAL_HARNESS_BASE_URL: env.VITE_SOCIAL_HARNESS_BASE_URL,
    SOCIAL_HARNESS_ENDPOINT_ORIGIN: env.VITE_SOCIAL_HARNESS_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_SOCIAL_HARNESS_ENDPOINT_URLS = buildRuntimeZCodeEndpointUrls(
  createRendererZCodeEndpointEnv(),
);
