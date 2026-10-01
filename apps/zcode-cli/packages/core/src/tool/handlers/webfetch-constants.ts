export const WEBFETCH_TOOL_NAME = "WebFetch";
export const DEFAULT_WEBFETCH_TIMEOUT_MS = 60_000;
export const MAX_WEBFETCH_URL_CHARS = 2_000;
export const MAX_WEBFETCH_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_INPUT_CHARS = 100_000;
export const MAX_WEBFETCH_MODEL_BYTES = 100_000;
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

// 对外请求标识 Social Harness；不能继续发送已退役的 ZCode 域名或 CLI 产品名。
export const WEBFETCH_USER_AGENT = "Social-Harness-WebFetch/0.1";
