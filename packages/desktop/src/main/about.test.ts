import assert from "node:assert/strict";
import test from "node:test";

test("About uses the Social Harness identity in both supported locales", async (t) => {
  const windows: {
    options: Record<string, unknown>;
    html: string | null;
  }[] = [];

  class MockBrowserWindow {
    private readonly state: (typeof windows)[number];

    constructor(options: Record<string, unknown>) {
      this.state = { options, html: null };
      windows.push(this.state);
    }

    setMenuBarVisibility() {}
    once() {}
    loadURL(url: string) {
      this.state.html = url;
    }
  }

  t.mock.module("electron", {
    namedExports: {
      app: { getVersion: () => "1.2.3", isPackaged: false },
      BrowserWindow: MockBrowserWindow,
    },
  });
  const about = await import("./about.js");

  await about.showAboutDialog(undefined, "en-US");
  await about.showAboutDialog(undefined, "zh-CN");

  assert.equal(windows[0]?.options.title, "About Social Harness");
  assert.equal(windows[1]?.options.title, "关于 Social Harness");
  for (const window of windows) {
    assert.ok(window.html);
    const html = decodeURIComponent(window.html.split(",", 2)[1] ?? "");
    assert.match(html, /Social Harness/u);
    assert.doesNotMatch(html, /ZCode/u);
  }
});
