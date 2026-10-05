import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSocialHarnessE2ERuntime } from "./socialHarnessElectronRuntimeE2E.mjs";
import {
  createIsolatedAccountE2EEnvironment,
  reserveVitePort,
} from "./socialHarnessAccountE2EUtils.mjs";
import { createAndEditAccount } from "./socialHarnessAccountIsolationE2E.mjs";
import { prepareSocialHarnessMediaIntakeFixtures } from "./socialHarnessMediaIntakeE2E.mjs";
import {
  configureLocalMockProvider,
  startLocalOpenAiMock,
} from "./socialHarnessLocalModelProviderE2E.mjs";
import {
  createAndRunAccountRecipe,
  verifyAccountRecipeAfterRelaunch,
} from "./socialAccountRecipesE2E.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const vitePort = await reserveVitePort();
const support = createSocialHarnessE2ERuntime({ repoRoot, vitePort });
const testRoot = await mkdtemp(join(tmpdir(), "social-harness-recipes-e2e-"));
const dataBaseDir = join(testRoot, "home");
const runId = `recipes-${Date.now()}`;
const accountName = `Recipe fixture ${runId}`;
let runtime;
let browser;
let page;
let port;
let succeeded = false;
const mock = await startLocalOpenAiMock();
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
  const stop = async () => {
    await browser?.close();
    browser = undefined;
    await support.stopDesktopRuntime(runtime);
    await support.waitForEndpointClosed(
      `http://127.0.0.1:${port}/json/version`,
      "Electron DevTools",
    );
    await support.waitForEndpointClosed(`http://127.0.0.1:${vitePort}/`, "Desktop Vite");
    runtime = undefined;
  };
  const start = async () => {
    runtime = support.startDesktopRuntime(environment);
    port = await support.waitForDevTools(runtime);
    ({ browser, page } = await support.connectToPage(port));
  };
  await start();
  await createAndEditAccount(page, runtime, `Initial ${runId}`, accountName);
  await stop();
  await configureLocalMockProvider(settingsDir, mock.baseUrl);
  await start();
  await createAndRunAccountRecipe(page);
  await stop();
  await start();
  await verifyAccountRecipeAfterRelaunch(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Account name").fill(`Second ${runId}`);
  await page.getByLabel("Niche").fill("Second isolated recipe account");
  await page.getByLabel("Audience").fill("Second account fixture audience");
  await page.getByLabel("Visual style").fill("Second account fixture style");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("heading", { name: `Second ${runId}`, exact: true }).waitFor();
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  const recipes = page.getByRole("region", { name: "Saved script recipes", exact: true });
  await recipes
    .getByText("No saved script recipes in this account yet.", { exact: true })
    .waitFor();
  assert.equal(await recipes.getByRole("heading", { name: "reviewed-daily" }).count(), 0);
  await stop();
  succeeded = true;
  console.log(
    "Social Harness account recipe editor, runtime, history, relaunch and isolation Electron E2E passed.",
  );
} finally {
  await browser?.close().catch(() => undefined);
  await support.stopDesktopRuntime(runtime);
  await mock.close();
  if (succeeded)
    await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  else {
    console.error(`Recipe E2E diagnostics retained at ${testRoot}`);
    if (runtime?.output) console.error(runtime.output);
  }
}
