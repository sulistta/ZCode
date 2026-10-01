import type { ClientConfigSnapshot } from "@social-harness/shared";
import type { IClientConfigService } from "./clientConfig.js";

/** 插件商店排序保留内置顺序；Social Harness 不请求已退役的产品配置 API。 */
export function createClientConfigService(): IClientConfigService {
  return {
    async getSnapshot() {
      return { pluginStoreOrder: null } satisfies ClientConfigSnapshot;
    },
  };
}
