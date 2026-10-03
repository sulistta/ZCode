import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { _electron as electron } from "playwright-core";

// 此隔离 Electron fixture 验证实际组件交互；不冒充真实 Convex/Meta 验证。
const root = resolve(import.meta.dirname, "../../..");
const directory = await mkdtemp(join(tmpdir(), "social-instagram-setup-e2e-"));
const result = await build({
  entryPoints: [join(import.meta.dirname, "fixtures/socialInstagramSetupFixture.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@": join(root, "packages/ui/src") },
  define: { "process.env.NODE_ENV": '"test"' },
});
const server = createServer((request, response) => {
  response.setHeader(
    "content-type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? result.outputFiles[0].contents
      : '<div id="root"></div><script src="/fixture.js"></script>',
  );
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const main = join(directory, "main.cjs");
const preload = join(directory, "preload.cjs");
const preloadBuild = await build({
  stdin: {
    contents: `import { contextBridge, ipcRenderer } from "electron";
      import { PlatformChannels } from "@social-harness/shared";
      import { createOAuthCallbackHandler } from ${JSON.stringify(join(root, "packages/desktop/src/preload/oauthCallbackBridge.ts"))};
      contextBridge.exposeInMainWorld("oauthFixturePlatform", {
        registerOAuthState: payload => ipcRenderer.send(PlatformChannels.OAuthRegisterState, payload),
        notifyRendererReady: () => ipcRenderer.send(PlatformChannels.RendererReady),
        onOAuthCallback: callback => {
          const handler = createOAuthCallbackHandler(callback, () => ipcRenderer.send(PlatformChannels.OAuthCallbackHandled));
          ipcRenderer.on(PlatformChannels.OAuthCallback, handler);
          return () => ipcRenderer.removeListener(PlatformChannels.OAuthCallback, handler);
        },
      });`,
    resolveDir: join(root, "packages/desktop"),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await writeFile(preload, preloadBuild.outputFiles[0].contents);
const mainBuild = await build({
  stdin: {
    contents: `import { app, BrowserWindow, ipcMain } from "electron";
      import { PlatformChannels } from "@social-harness/shared";
      import { registerOAuthState, deliverPendingDeepLink, handleDeepLink } from ${JSON.stringify(join(root, "packages/desktop/src/main/desktopOAuthDeepLink.ts"))};
      const logger = { info() {}, warn() {} };
      globalThis.oauthFixtureRoute = url => handleDeepLink(url, logger);
      ipcMain.on(PlatformChannels.OAuthRegisterState, (event, payload) => registerOAuthState(event.sender.id, payload));
      ipcMain.on(PlatformChannels.RendererReady, event => deliverPendingDeepLink(event.sender));
      app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
      app.whenReady().then(() => {
        const window = new BrowserWindow({show:false,width:1100,height:1400,
          webPreferences:{contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(preload)},sandbox:false}});
        window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.address().port}/`)});
      });`,
    resolveDir: join(root, "packages/desktop"),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await writeFile(main, mainBuild.outputFiles[0].contents);
let app;
try {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [main, "--no-sandbox"],
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assistant = page.getByTestId("instagram-infrastructure-assistant");
  await assistant.locator("summary").click();
  await page.getByText(/Only Social Harness is installed/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Continue with Instagram Login" }).count(),
    0,
  );
  await page.getByLabel("Production deployment URL").fill("https://fixture-123.convex.cloud/");
  const project = page.getByRole("region", {
    name: "1. Connect and deploy a dedicated Convex project",
  });
  await project.getByLabel("Temporary production deploy key").fill("invalid-temporary-fixture-key");
  await project.getByRole("button", { name: "Deploy the bundled bridge" }).click();
  await page.getByRole("alert").filter({ hasText: "invalid, expired, revoked" }).waitFor();
  assert.equal(await project.getByLabel("Temporary production deploy key").inputValue(), "");
  assert.equal(
    await page.getByLabel("Production deployment URL").inputValue(),
    "https://fixture-123.convex.cloud/",
  );
  await page.getByRole("button", { name: "Create through Convex API" }).click();
  await page.getByLabel("Dedicated project name").fill("Dedicated fixture project");
  await page.getByLabel("Temporary Convex team token").fill("quota-temporary-fixture-token");
  await project.getByRole("button", { name: "Deploy the bundled bridge" }).click();
  await page.getByRole("alert").filter({ hasText: "capacity is unavailable" }).waitFor();
  assert.equal(await page.getByLabel("Temporary Convex team token").inputValue(), "");
  await page.getByLabel("Temporary Convex team token").fill("quota-temporary-fixture-token");
  await project.getByRole("button", { name: "Deploy the bundled bridge" }).click();
  const callback = "https://fixture-123.convex.site/v1/instagram/callback";
  await page.getByRole("button", { name: `Copy ${callback}`, exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.setupFixture.copied), [callback]);
  await page.getByRole("button", { name: "Open Meta applications" }).click();
  assert.deepEqual(await page.evaluate(() => window.setupFixture.opened), [
    "https://developers.facebook.com/apps/",
  ]);
  await page.getByRole("button", { name: "Validate project configuration" }).click();
  await page
    .getByText("The backend is reachable; the Meta App ID or App Secret is still missing.")
    .waitFor();
  const meta = page.getByRole("region", {
    name: "3. Save your Meta app credentials in Convex",
  });
  await meta.getByLabel("Instagram App ID").fill("123456789");
  await meta.getByLabel("Instagram App Secret").fill("meta-fixture-secret-for-test");
  await meta
    .getByLabel("Temporary production deploy key")
    .fill("prod:fixture-123|temporary-fixture-key");
  await meta.getByRole("button", { name: "Save credentials in my Convex project" }).click();
  await page.waitForFunction(() => window.setupFixture.configs === 1);
  assert.equal(await meta.getByLabel("Instagram App Secret").inputValue(), "");
  assert.equal(await meta.getByLabel("Temporary production deploy key").inputValue(), "");
  assert.equal(await meta.getByLabel("Instagram App ID").inputValue(), "123456789");
  await page.getByRole("button", { name: "Validate project configuration" }).click();
  await page.waitForFunction(() => typeof window.setupFixture.releaseReady === "function");
  assert.equal(
    await page.getByRole("button", { name: "Continue with Instagram Login" }).count(),
    0,
  );
  await page.evaluate(() => window.setupFixture.releaseReady());
  await page
    .getByText(
      "Bridge configuration is ready. Complete Instagram Login to verify the app and account.",
    )
    .waitFor();
  assert.equal(
    await page.getByText("Instagram account authenticated and saved securely.").count(),
    0,
  );
  await page.getByRole("button", { name: "Continue with Instagram Login" }).click();
  await page.waitForFunction(() =>
    window.setupFixture.opened.some((url) => url.includes("oauth/authorize")),
  );
  assert.equal(
    await app.evaluate(() =>
      globalThis.oauthFixtureRoute(
        "social-harness://oauth/callback?state=unknown-state&code=fixture-ticket",
      ),
    ),
    false,
  );
  assert.equal(await page.evaluate(() => window.setupFixture.completions), 0);
  assert.equal(
    await app.evaluate(() =>
      globalThis.oauthFixtureRoute(
        "social-harness://oauth/callback?state=setup-fixture-state&code=fixture-ticket",
      ),
    ),
    true,
    "The Social Accounts listener must announce readiness before the real Main callback router delivers the ticket",
  );
  await page.getByText("Instagram account authenticated and saved securely.").waitFor();
  assert.equal(
    await app.evaluate(() =>
      globalThis.oauthFixtureRoute(
        "social-harness://oauth/callback?state=setup-fixture-state&code=fixture-ticket",
      ),
    ),
    false,
  );
  assert.equal(await page.evaluate(() => window.setupFixture.completions), 1);
  const persistence = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  assert.doesNotMatch(persistence, /fixture-secret|fixture-key|fixture-token/);
  assert.deepEqual(errors, []);
  console.log(
    "Instagram setup Electron E2E passed: invalid-key retry, creation quota/retry, callback copy, Meta instructions, cleared secret fields, readiness ordering and actual Main/preload/hook OAuth handoff with unknown-state and replay rejection (fixture services).",
  );
} finally {
  await app?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
