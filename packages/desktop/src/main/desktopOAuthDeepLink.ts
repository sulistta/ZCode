/* oxlint-disable eslint(max-lines) -- Deep Link 路由必须在同一模块内保持协议校验和投递原子性。 */
import { resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import type { WebContents } from "electron";
import { type OAuthStateRegistration, PlatformChannels } from "@social-harness/shared";
import { isOAuthCallbackUrl } from "./desktopDeepLinkUrl.js";
import { registerLinuxDeepLinkProtocol } from "./desktopLinuxDeepLinkRegistration.js";
import { createOAuthCallbackRouter } from "./desktopOAuthCallbackRouter.js";

const oauthCallbackRouter = createOAuthCallbackRouter();
const rendererReadyWebContentsIds = new Set<number>();

export function parseOAuthStateRegistration(payload: unknown): OAuthStateRegistration | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as {
    state?: unknown;
    provider?: unknown;
  };

  if (typeof candidate.state !== "string" || candidate.state.trim() === "") {
    return null;
  }

  if (candidate.provider != null && typeof candidate.provider !== "string") {
    return null;
  }

  return {
    state: candidate.state.trim(),
    ...(typeof candidate.provider === "string" ? { provider: candidate.provider } : {}),
  };
}

function focusDeepLinkTargetWindow(targetWindow: BrowserWindow): void {
  // macOS 的 open-url 回调只会把 URL 投递给当前实例，不会自动把窗口带回前台。
  // 之前这里只做了 IPC 转发，用户完成 OAuth 后仍停留在外部应用。
  // 这里在路由成功后显式激活并聚焦目标窗口，统一多平台回跳体验。
  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  if (!targetWindow.isVisible()) {
    targetWindow.show();
  }

  if (process.platform === "darwin") {
    app.show();
  }

  targetWindow.focus();
}

function hasOAuthAuthorizationCode(parsedUrl: URL): boolean {
  return parsedUrl.searchParams.has("code") || parsedUrl.searchParams.has("authCode");
}

export function handleDeepLink(
  url: string,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    logger.warn("[deep-link] 无法解析 URL:", url);
    return false;
  }

  if (!isOAuthCallbackUrl(parsedUrl)) {
    return false;
  }

  const state = parsedUrl.searchParams.get("state");
  if (!state) {
    logger.warn("[deep-link] OAuth 回调缺少 state，忽略此次回调", {
      protocol: parsedUrl.protocol,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
    });
    return false;
  }

  const shouldCompleteOAuthRoute = hasOAuthAuthorizationCode(parsedUrl);
  const route = oauthCallbackRouter.resolve(state, url, shouldCompleteOAuthRoute);
  if (!route) {
    logger.warn("[deep-link] OAuth 回调 state 未注册、已过期或已处理，忽略此次回调", {
      state,
    });
    return false;
  }
  const targetWindow = BrowserWindow.getAllWindows().find(
    (window) => window.webContents.id === route.webContentsId,
  );
  if (!targetWindow) {
    oauthCallbackRouter.complete(route);
    logger.warn("[deep-link] OAuth 回调目标窗口已关闭，忽略此次回调", {
      state,
      webContentsId: route.webContentsId,
    });
    return false;
  }

  if (!rendererReadyWebContentsIds.has(route.webContentsId)) {
    // Bug 原因：全局 pending URL 会把不匹配的 opaque ticket 转发给下一个 renderer。
    // 按 state 绑定 WebContents，仅等待发起该 OAuth 流程的 renderer 就绪。
    if (!oauthCallbackRouter.queue(route)) return false;
    focusDeepLinkTargetWindow(targetWindow);
    logger.warn("[deep-link] OAuth 回调等待其注册窗口的 renderer ready", {
      state,
      webContentsId: route.webContentsId,
    });
    return false;
  }

  targetWindow.webContents.send(PlatformChannels.OAuthCallback, route.url);
  oauthCallbackRouter.acknowledgeDelivery(route);
  focusDeepLinkTargetWindow(targetWindow);
  logger.info("[deep-link] OAuth 回调路由成功", {
    state,
    windowId: targetWindow.webContents.id,
    completed: shouldCompleteOAuthRoute,
  });
  return true;
}

export function registerDeepLinkProtocol(
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  },
  options: { iconPath?: string } = {},
) {
  const scheme = "social-harness";

  if (process.defaultApp && process.argv.length >= 2) {
    const entry = resolve(process.argv[1]!);
    const ok = app.setAsDefaultProtocolClient(scheme, process.execPath, [entry]);
    if (!ok) {
      logger.warn("[deep-link] 注册协议失败（defaultApp）", {
        scheme,
        execPath: process.execPath,
        entry: process.argv[1],
      });
    } else {
      logger.info("[deep-link] 注册协议成功（defaultApp）", {
        scheme,
        execPath: process.execPath,
        entry: process.argv[1],
      });
    }
    return;
  }

  const ok = app.setAsDefaultProtocolClient(scheme);
  if (!ok) {
    logger.warn("[deep-link] 注册协议失败", { scheme });
  } else {
    logger.info("[deep-link] 注册协议成功", { scheme });
  }

  if (process.platform === "linux" && app.isPackaged) {
    registerLinuxDeepLinkProtocol({
      executablePath: process.execPath,
      homeDir: app.getPath("home"),
      productName: app.name,
      iconSourcePath: options.iconPath,
      env: process.env,
      argv: process.argv,
      logger,
    });
  }
}

export function registerOAuthState(windowId: number, registration: OAuthStateRegistration): void {
  oauthCallbackRouter.register(windowId, registration);

  setTimeout(() => oauthCallbackRouter.expire(registration.state, windowId), 5 * 60 * 1000);
}

export function deliverPendingDeepLink(webContents: WebContents): boolean {
  rendererReadyWebContentsIds.add(webContents.id);

  const pendingOAuthCallbacks = oauthCallbackRouter.pendingForWebContents(webContents.id);
  for (const route of pendingOAuthCallbacks) {
    webContents.send(PlatformChannels.OAuthCallback, route.url);
    oauthCallbackRouter.acknowledgeDelivery(route);
  }
  return pendingOAuthCallbacks.length > 0;
}

export function clearOAuthRoutesForWindow(windowId: number): void {
  rendererReadyWebContentsIds.delete(windowId);
  oauthCallbackRouter.clearWebContents(windowId);
}
