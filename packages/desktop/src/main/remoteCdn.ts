import { SOCIAL_HARNESS_VERSION, type ZCodeEnv } from "@social-harness/shared";

declare const __SOCIAL_HARNESS_CDN_BASE_URL__: string | undefined;

export interface ResolveRemoteCdnOptions {
  env?: ZCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl =
    process.env.SOCIAL_HARNESS_CDN_BASE_URL?.trim() ||
    (typeof __SOCIAL_HARNESS_CDN_BASE_URL__ === "undefined"
      ? ""
      : __SOCIAL_HARNESS_CDN_BASE_URL__) ||
    "";
  // 缺少 Social Harness CDN 配置时不能回退到旧 ZCode 地址，避免后台静默下载旧产品运行时。
  if (!baseUrl.trim()) return [];
  return [
    `${normalizeBaseUrl(baseUrl)}/social-harness/electron/releases/${options.version ?? SOCIAL_HARNESS_VERSION}`,
  ];
}
