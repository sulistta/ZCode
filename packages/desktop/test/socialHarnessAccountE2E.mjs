import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { AutomationRepo } from "@social-harness/services/node";
import {
  assertNoRetiredZCodeProductApiRequests,
  resolveE2EMediaTools,
  reserveVitePort,
} from "./socialHarnessAccountE2EUtils.mjs";
import {
  exerciseSocialHarnessMediaIntake,
  prepareSocialHarnessMediaIntakeFixtures,
} from "./socialHarnessMediaIntakeE2E.mjs";
import {
  createAndEditAccount,
  createSecondAccountAndVerifyIsolation,
  verifyAccountConversationShell,
  verifyAccountAfterRelaunch,
} from "./socialHarnessAccountIsolationE2E.mjs";
import {
  configureLocalMockProvider,
  createSocialProjectEditScenario,
  startLocalOpenAiMock,
} from "./socialHarnessLocalModelProviderE2E.mjs";
import {
  createAndExerciseAccountAutomation,
  createAndVerifyScheduledHostRejection,
  createAndVerifyScheduledHostSuccess,
  verifyAccountAutomationAfterRelaunch,
} from "./socialHarnessAccountAutomationsE2E.mjs";
import {
  createProjectMotionInElectron,
  seedSocialProjectVideoAsset,
  verifyProjectMotionAfterRelaunch,
} from "./socialProjectEffectsE2E.mjs";
import { verifySocialAgentProjectEditInElectron } from "./socialProjectAgentEditingE2E.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");
const devEntrypoint = resolve(repoRoot, "scripts/dev-desktop-env.mjs");
const { ffmpegExecutable, ffprobeExecutable } = resolveE2EMediaTools();
const buildReadinessTimeoutMs = 300_000;
const electronReadinessTimeoutMs = 30_000;
const rendererLoadTimeoutMs = 60_000;
const rendererContentTimeoutMs = 30_000;
const processStopTimeoutMs = 15_000;
const maxCapturedOutputLength = 24_000;

const vitePort =
  Number.parseInt(process.env.SOCIAL_HARNESS_E2E_VITE_PORT ?? "", 10) || (await reserveVitePort());

function appendOutput(runtime, chunk) {
  runtime.output = `${runtime.output}${chunk.toString()}`.slice(-maxCapturedOutputLength);
}

async function assertVitePortAvailable() {
  const server = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(vitePort, "127.0.0.1", resolveListen);
  }).catch((error) => {
    throw new Error(`Desktop E2E needs port ${vitePort} free for Vite: ${error.message}`);
  });
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

function startDesktopRuntime(environment) {
  const child = spawn(process.execPath, [devEntrypoint, "test"], {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const runtime = { child, output: "" };
  child.stdout.on("data", (chunk) => appendOutput(runtime, chunk));
  child.stderr.on("data", (chunk) => appendOutput(runtime, chunk));
  return runtime;
}

async function waitForExit(runtime, timeoutMs) {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return true;
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    runtime.child.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

async function stopDesktopRuntime(runtime) {
  if (!runtime || runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;

  try {
    if (process.platform === "win32") {
      const taskkill = spawn("taskkill", ["/PID", String(runtime.child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.on("error", () => runtime.child.kill());
    } else if (runtime.child.pid) {
      process.kill(-runtime.child.pid, "SIGINT");
    }
  } catch {
    runtime.child.kill("SIGINT");
  }

  if (await waitForExit(runtime, processStopTimeoutMs)) return;
  try {
    if (process.platform === "win32" && runtime.child.pid) {
      const taskkill = spawn("taskkill", ["/PID", String(runtime.child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.on("error", () => runtime.child.kill("SIGKILL"));
    } else if (runtime.child.pid) {
      process.kill(-runtime.child.pid, "SIGKILL");
    }
  } catch {
    runtime.child.kill("SIGKILL");
  }
  await waitForExit(runtime, 5_000);
}

async function waitForDevTools(runtime) {
  const buildDeadline = Date.now() + buildReadinessTimeoutMs;
  let electronDeadline;
  let lastError;
  while (Date.now() < (electronDeadline ?? buildDeadline)) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      throw new Error(`Desktop test runtime exited before DevTools was ready.\n${runtime.output}`);
    }
    const portMatch = runtime.output.match(/\[dev\] Social Harness E2E CDP port: (\d+)/u);
    if (portMatch) {
      electronDeadline ??= Date.now() + electronReadinessTimeoutMs;
      const port = Number(portMatch[1]);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          await response.json();
          return port;
        }
        lastError = new Error(`DevTools returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    await delay(500);
  }
  // Node fetch 会把 socket 错误包在 cause 里；保留它以区分端口未监听与连接超时。
  const lastErrorMessage =
    lastError instanceof Error
      ? `${lastError.name}: ${lastError.message}${lastError.cause instanceof Error ? ` (${lastError.cause.name}: ${lastError.cause.message})` : ""}`
      : String(lastError);
  throw new Error(
    `Desktop test runtime did not expose DevTools: ${lastErrorMessage}\n${runtime.output}`,
  );
}

async function waitForEndpointClosed(url, label) {
  const deadline = Date.now() + processStopTimeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await delay(200);
  }
  throw new Error(`${label} did not release its E2E port: ${url}`);
}

async function connectToPage(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => {
        try {
          const url = new URL(candidate.url());
          return (
            url.port === String(vitePort) &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          );
        } catch {
          return false;
        }
      });
    if (page) {
      const rendererStart = Date.now();
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: rendererLoadTimeoutMs });
        await page.getByText(/No Instagram/).waitFor({ timeout: rendererContentTimeoutMs });
      } catch (error) {
        const pageState = await page
          .locator("body")
          .innerText()
          .catch(() => "unavailable");
        throw new Error(
          `Social Harness renderer did not become ready after ${Date.now() - rendererStart}ms; url=${page.url()}, state=${JSON.stringify(pageState)}`,
          { cause: error },
        );
      }
      console.log(`[social-e2e] renderer ready in ${Date.now() - rendererStart}ms`);
      return { browser, page };
    }
    await delay(250);
  }
  const pageUrls = browser
    .contexts()
    .flatMap((context) => context.pages())
    .map((candidate) => candidate.url());
  await browser.close();
  throw new Error(`Social Harness account setup window did not open: ${JSON.stringify(pageUrls)}`);
}

const testRoot = await mkdtemp(join(tmpdir(), "social-harness-account-e2e-"));
const homeDir = join(testRoot, "home");
const dataBaseDir = homeDir;
const runId = `account-${Date.now()}`;
const legacySentinelPath = join(homeDir, ".zcode", "legacy-sentinel.txt");
const legacySentinel = Buffer.from("Social Harness E2E must preserve legacy ZCode data.\n");
let runtime;
let browser;
let page;
let mockProvider;
let succeeded = false;

try {
  const mediaIntakeFixtures = await prepareSocialHarnessMediaIntakeFixtures(testRoot);
  await assertVitePortAvailable();
  await mkdir(dirname(legacySentinelPath), { recursive: true });
  await writeFile(legacySentinelPath, legacySentinel);
  const settingsDir = join(homeDir, ".social-harness", "v1", "config");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    join(settingsDir, "setting.json"),
    JSON.stringify({ locale: "en-US", localePreference: "en-US", dataBaseDir }),
  );
  const sentinelBefore = await stat(legacySentinelPath);

  const environment = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    SOCIAL_HARNESS_DESKTOP_HOME_DIR: homeDir,
    SOCIAL_HARNESS_DESKTOP_USER_DATA_DIR: join(testRoot, "electron-user-data"),
    SOCIAL_HARNESS_DESKTOP_SESSION_DATA_DIR: join(testRoot, "electron-session-data"),
    SOCIAL_HARNESS_E2E_RUN_ID: runId,
    SOCIAL_HARNESS_E2E_VITE_PORT: String(vitePort),
    SOCIAL_HARNESS_DATA_BASE_DIR: dataBaseDir,
    SOCIAL_HARNESS_E2E_FORCE_X11: "1",
    SOCIAL_HARNESS_E2E_CDP_PORT: "auto",
    SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES: mediaIntakeFixtures.pickerResponses,
    SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE: "cancel",
    SOCIAL_HARNESS_YT_DLP_PATH: mediaIntakeFixtures.ytDlpPath,
  };

  console.log("[social-e2e] starting first isolated Electron instance");
  runtime = startDesktopRuntime(environment);
  let cdpPort = await waitForDevTools(runtime);
  console.log("[social-e2e] first Electron instance is ready");
  ({ browser, page } = await connectToPage(cdpPort));

  const accountName = `Podcast pilot ${runId}`;
  const editedName = `Social Harness pilot ${runId}`;
  const projectName = `Motion smoke ${runId}`;
  const projectAgentScenario = createSocialProjectEditScenario(runId, projectName);
  const automationTitle = `Weekly source research ${runId}`;
  const editedAutomationTitle = `Weekly account research ${runId}`;
  const automationWeekday = (new Date().getDay() + 2) % 7;
  await createAndEditAccount(page, runtime, accountName, editedName);
  const mediaIntakeResult = await exerciseSocialHarnessMediaIntake(
    page,
    dataBaseDir,
    editedName,
    mediaIntakeFixtures,
  );
  const mediaFixture = await seedSocialProjectVideoAsset(dataBaseDir, editedName, ffmpegExecutable);
  await createAndExerciseAccountAutomation(
    page,
    automationTitle,
    editedAutomationTitle,
    automationWeekday,
  );
  const automationRepo = new AutomationRepo(join(settingsDir, "tasks-index.sqlite"));
  await automationRepo.ensureReady();
  try {
    await createAndVerifyScheduledHostRejection(
      page,
      `Near-future scheduled route ${runId}`,
      automationRepo,
    );
    mockProvider = await startLocalOpenAiMock({
      projectEdits: projectAgentScenario.projectEdits,
    });
    await configureLocalMockProvider(settingsDir, mockProvider.baseUrl);
    const positiveAutomationTitle = `Near-future scheduled success ${runId}`;
    const positiveAutomationPrompt = `For ${positiveAutomationTitle}, prepare one concise source research plan.`;
    await createAndVerifyScheduledHostSuccess(
      page,
      positiveAutomationTitle,
      positiveAutomationPrompt,
      automationRepo,
      mockProvider.requests,
    );
    await verifyAccountConversationShell(page);
  } finally {
    automationRepo.close();
  }
  console.log(
    "[social-e2e] relaunching with the persisted local model provider for conversation coverage",
  );
  await browser.close();
  browser = undefined;
  await stopDesktopRuntime(runtime);
  runtime = undefined;
  await waitForEndpointClosed(`http://127.0.0.1:${cdpPort}/json/version`, "Electron DevTools");
  await waitForEndpointClosed(`http://127.0.0.1:${vitePort}/`, "Desktop Vite");
  runtime = startDesktopRuntime(environment);
  cdpPort = await waitForDevTools(runtime);
  ({ browser, page } = await connectToPage(cdpPort));
  await page.getByRole("heading", { level: 1, name: editedName, exact: true }).waitFor();
  const clipIds = await createProjectMotionInElectron(page, runId, mediaFixture);
  await createSecondAccountAndVerifyIsolation(
    page,
    editedName,
    projectName,
    [
      mediaIntakeResult.localOriginalName,
      mediaIntakeResult.youtubeOriginalName,
      mediaIntakeResult.remoteOriginalName,
      mediaFixture.originalName,
    ],
    runId,
  );

  await verifySocialAgentProjectEditInElectron(page, {
    runId,
    mockProvider,
    clipIds,
    ...projectAgentScenario,
    dataBaseDir,
    ffmpegExecutable,
    ffprobeExecutable,
  });
  assertNoRetiredZCodeProductApiRequests(runtime);
  console.log(
    "[social-e2e] account policy, second-account library/project isolation, manual automation management, scheduled Scheduler/Main/Host rejection and successful local-model settlement, Social Agent project-tool editing, and same-timestamp preview/export parity verified",
  );
  await browser.close();
  browser = undefined;
  await stopDesktopRuntime(runtime);
  runtime = undefined;
  await waitForEndpointClosed(`http://127.0.0.1:${cdpPort}/json/version`, "Electron DevTools");
  await waitForEndpointClosed(`http://127.0.0.1:${vitePort}/`, "Desktop Vite");

  const sentinelAfterFirstRun = await readFile(legacySentinelPath);
  const sentinelAfterFirstStat = await stat(legacySentinelPath);
  assert.deepEqual(sentinelAfterFirstRun, legacySentinel);
  assert.equal(sentinelAfterFirstStat.mtimeMs, sentinelBefore.mtimeMs);
  assert.deepEqual(
    (await readdir(dirname(legacySentinelPath))).sort(),
    ["legacy-sentinel.txt"],
    "Social Harness startup must not create runtime files in the legacy ZCode data root",
  );

  console.log("[social-e2e] relaunching Electron to verify durable state");
  runtime = startDesktopRuntime(environment);
  cdpPort = await waitForDevTools(runtime);
  console.log("[social-e2e] relaunched Electron instance is ready");
  ({ browser, page } = await connectToPage(cdpPort));
  await verifyAccountAfterRelaunch(page, editedName);
  await verifyAccountAutomationAfterRelaunch(page, editedAutomationTitle, automationWeekday);
  await verifyProjectMotionAfterRelaunch(page, runId, clipIds, projectAgentScenario.captionText);
  assertNoRetiredZCodeProductApiRequests(runtime);

  await browser.close();
  browser = undefined;
  await stopDesktopRuntime(runtime);
  runtime = undefined;
  // Chromium 可能在开发包装进程退出后才完成会话目录写入，等端口释放后再清理临时目录。
  await waitForEndpointClosed(`http://127.0.0.1:${cdpPort}/json/version`, "Electron DevTools");
  await waitForEndpointClosed(`http://127.0.0.1:${vitePort}/`, "Desktop Vite");

  const sentinelAfterRelaunch = await readFile(legacySentinelPath);
  const sentinelAfterRelaunchStat = await stat(legacySentinelPath);
  assert.deepEqual(sentinelAfterRelaunch, legacySentinel);
  assert.equal(sentinelAfterRelaunchStat.mtimeMs, sentinelBefore.mtimeMs);
  assert.deepEqual(
    (await readdir(dirname(legacySentinelPath))).sort(),
    ["legacy-sentinel.txt"],
    "Social Harness relaunch must not create runtime files in the legacy ZCode data root",
  );
  succeeded = true;
  console.log(
    "Social Harness Electron E2E passed: account/profile/policy and second-account library/project isolation, account automation management and scheduled Host rejection/success, local model-provider endpoint, Social Agent project-tool editing, text and media timeline trims with cancel, ruler viewport virtualization, project motion effects, and matching-time Player/export rendering verified; durable state survived a full app relaunch and the isolated legacy sentinel stayed unchanged.",
  );
} finally {
  await browser?.close().catch(() => undefined);
  await mockProvider?.close().catch(() => undefined);
  await stopDesktopRuntime(runtime);
  if (succeeded) {
    await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  } else {
    console.error(`E2E diagnostics retained at ${testRoot}`);
    if (runtime?.output) console.error(runtime.output);
  }
}
