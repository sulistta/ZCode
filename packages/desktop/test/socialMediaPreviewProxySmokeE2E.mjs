import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSocialHarnessE2ERuntime } from "./socialHarnessElectronRuntimeE2E.mjs";
import {
  createIsolatedAccountE2EEnvironment,
  reserveVitePort,
  resolveE2EMediaTools,
} from "./socialHarnessAccountE2EUtils.mjs";
import {
  createAndEditAccount,
  verifyAccountAfterRelaunch,
} from "./socialHarnessAccountIsolationE2E.mjs";
import { prepareSocialHarnessMediaIntakeFixtures } from "./socialHarnessMediaIntakeE2E.mjs";
import {
  verifyOnDemandPreviewProxyInElectron,
  verifyPreviewProxyAfterRelaunch,
} from "./socialMediaPreviewProxyE2E.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const vitePort = await reserveVitePort();
const support = createSocialHarnessE2ERuntime({ repoRoot, vitePort });
const testRoot = await mkdtemp(join(tmpdir(), "social-harness-proxy-e2e-"));
const dataBaseDir = join(testRoot, "home");
const runId = `proxy-${Date.now()}`;
const accountName = `Proxy fixture ${runId}`;
const editedName = `Proxy edited ${runId}`;
let runtime;
let browser;
let succeeded = false;
try {
  const fixtures = await prepareSocialHarnessMediaIntakeFixtures(testRoot);
  const settingsDir = join(dataBaseDir, ".social-harness", "v1", "config");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    join(settingsDir, "setting.json"),
    JSON.stringify({ locale: "en-US", localePreference: "en-US", dataBaseDir }),
  );
  const environment = createIsolatedAccountE2EEnvironment({
    homeDir: dataBaseDir,
    dataBaseDir,
    testRoot,
    runId,
    vitePort,
    fixtures,
  });
  runtime = support.startDesktopRuntime(environment);
  let port = await support.waitForDevTools(runtime);
  let page;
  ({ browser, page } = await support.connectToPage(port));
  await createAndEditAccount(page, runtime, accountName, editedName);
  await page.getByRole("button", { name: "Player", exact: true }).click();
  const existingName = `Existing selected project ${runId}`;
  await page.getByPlaceholder("New Reel", { exact: true }).fill(existingName);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByTestId("social-project-editor").waitFor({ state: "visible" });
  await page
    .getByTestId("social-project-editor")
    .getByLabel("Project name", { exact: true })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await verifyOnDemandPreviewProxyInElectron(page, {
    dataBaseDir,
    firstAccountName: editedName,
    runId,
    ...resolveE2EMediaTools(),
  });
  await browser.close();
  browser = undefined;
  await support.stopDesktopRuntime(runtime);
  await support.waitForEndpointClosed(`http://127.0.0.1:${port}/json/version`, "Electron DevTools");
  await support.waitForEndpointClosed(`http://127.0.0.1:${vitePort}/`, "Desktop Vite");
  runtime = support.startDesktopRuntime(environment);
  port = await support.waitForDevTools(runtime);
  ({ browser, page } = await support.connectToPage(port));
  await verifyAccountAfterRelaunch(page, editedName);
  await verifyPreviewProxyAfterRelaunch(page);
  await browser.close();
  browser = undefined;
  await support.stopDesktopRuntime(runtime);
  await support.waitForEndpointClosed(`http://127.0.0.1:${port}/json/version`, "Electron DevTools");
  await support.waitForEndpointClosed(`http://127.0.0.1:${vitePort}/`, "Desktop Vite");
  runtime = undefined;
  succeeded = true;
  console.log("Social Harness focused preview proxy Electron E2E passed.");
} finally {
  await browser?.close().catch(() => undefined);
  await support.stopDesktopRuntime(runtime);
  if (succeeded)
    await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  else {
    console.error(`Proxy E2E diagnostics retained at ${testRoot}`);
    if (runtime?.output) console.error(runtime.output);
  }
}
