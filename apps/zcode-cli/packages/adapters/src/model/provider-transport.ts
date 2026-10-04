import { createOfficialCodingPlanGatewayFetch } from "./official-coding-plan-gateway.js";

interface ProviderTransportOptions {
  accessType: string;
  env?: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
}

export function createProviderTransportFetch(
  options: ProviderTransportOptions,
): typeof globalThis.fetch {
  if (options.accessType !== "zhipu-account") {
    return options.fetch;
  }

  // 按凭据类型选择网关，避免个人 API Key 因供应商 hostname 相同而被改道到 Social Harness 服务。
  return createOfficialCodingPlanGatewayFetch({
    env: options.env,
    fetch: options.fetch,
    requireGateway: true,
  });
}
