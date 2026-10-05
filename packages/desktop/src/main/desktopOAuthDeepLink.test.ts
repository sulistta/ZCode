import assert from "node:assert/strict";
import test from "node:test";
import { PlatformChannels } from "@social-harness/shared";

test("Main delivers only a registered OAuth callback to its renderer", async (t) => {
  const delivered: { webContentsId: number; channel: string; url: string }[] = [];
  const windows: ReturnType<typeof createWindow>[] = [];
  const logger = { info() {}, warn() {} };

  t.mock.module("electron", {
    namedExports: {
      app: { show() {} },
      BrowserWindow: { getAllWindows: () => windows },
    },
  });
  t.mock.method(globalThis, "setTimeout", (() => 0) as unknown as typeof setTimeout);
  const deepLink = await import("./desktopOAuthDeepLink.js");
  const targetWindow = createWindow(41, delivered);
  const otherWindow = createWindow(99, delivered);
  windows.push(targetWindow, otherWindow);

  const state = "social-account-state";
  const callbackUrl = `social-harness://oauth/callback?state=${state}&code=opaque-ticket`;
  assert.equal(
    deepLink.handleDeepLink("social-harness://workspace/open?path=%2Ftmp%2Fproject", logger),
    false,
  );
  assert.deepEqual(delivered, []);
  deepLink.registerOAuthState(41, { provider: "instagram", state });

  assert.equal(deepLink.handleDeepLink(callbackUrl, logger), false);
  assert.equal(
    deepLink.handleDeepLink(
      "social-harness://oauth/callback?state=unregistered&code=untrusted-ticket",
      logger,
    ),
    false,
  );
  assert.equal(deepLink.deliverPendingDeepLink(otherWindow.webContents), false);
  assert.deepEqual(delivered, []);

  assert.equal(deepLink.deliverPendingDeepLink(targetWindow.webContents), true);
  assert.deepEqual(delivered, [
    {
      webContentsId: 41,
      channel: PlatformChannels.OAuthCallback,
      url: `${callbackUrl}&_oauth_provider=instagram`,
    },
  ]);
  assert.equal(deepLink.handleDeepLink(callbackUrl, logger), false);
  assert.equal(deepLink.deliverPendingDeepLink(otherWindow.webContents), false);
  assert.equal(delivered.length, 1);

  deepLink.clearOAuthRoutesForWindow(41);
  deepLink.clearOAuthRoutesForWindow(99);
});

function createWindow(
  webContentsId: number,
  delivered: { webContentsId: number; channel: string; url: string }[],
) {
  return {
    webContents: {
      id: webContentsId,
      send(channel: string, url: string) {
        delivered.push({ webContentsId, channel, url });
      },
    },
    isMinimized: () => false,
    isVisible: () => true,
    restore() {},
    show() {},
    focus() {},
  };
}
