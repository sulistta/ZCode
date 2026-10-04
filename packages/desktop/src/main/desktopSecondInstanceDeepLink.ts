import {
  extractDeepLinkUrlFromArgs,
  extractDeepLinkUrlFromSingleInstanceData,
} from "./desktopDeepLinkUrl.js";

interface SecondInstanceDeepLinkDeps {
  additionalData: unknown;
  argv: readonly string[];
  handleDeepLink: (url: string) => boolean;
}

export function handleSecondInstanceDeepLink(deps: SecondInstanceDeepLinkDeps): boolean {
  const url =
    // Linux 的 second-instance argv 可能被桌面环境重排或追加参数。
    // Electron 官方建议精确参数走 additionalData，这里优先读取第二实例预解析出的 deep link。
    extractDeepLinkUrlFromSingleInstanceData(deps.additionalData) ??
    extractDeepLinkUrlFromArgs(deps.argv);
  return Boolean(url && deps.handleDeepLink(url));
}
