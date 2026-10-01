import type { OAuthProviderId } from "@social-harness/shared";

/** Provider 运行时配置（仅 host process 可见） */
export interface OAuthProviderRuntimeConfig {
  id: OAuthProviderId;
  displayName: string;
  enabled: boolean;
  order: number;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  appId: string;
  redirectUri: string;
  businessLoginUrl?: string;
  appSecret?: string;
}

/** OAuth 全局运行时配置 */
export interface OAuthRuntimeConfig {
  providers: OAuthProviderRuntimeConfig[];
}

/**
 * 从运行时环境变量生成 OAuth 配置。
 *
 * 注意：这里只能在 host process 使用，避免把敏感配置暴露给 renderer。
 */
export function createOAuthRuntimeConfig(
  _env: NodeJS.ProcessEnv = process.env,
): OAuthRuntimeConfig {
  // 保留 env 参数兼容现有装配签名；Social Harness 的模型连接使用个人 API Key，不再构造 ZCode OAuth。
  return { providers: [] };
}
