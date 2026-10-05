import { createSocialHarnessE2ERuntime } from "./socialHarnessElectronRuntimeE2E.mjs";
import { describeFixtureModelRequests } from "./socialHarnessModelRequestShapesE2E.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationRepo } from "@social-harness/services/node";
import {
  assertNoRetiredZCodeProductApiRequests,
  resolveE2EMediaTools,
  reserveVitePort,
  createIsolatedAccountE2EEnvironment,
  assertVitePortAvailable,
} from "./socialHarnessAccountE2EUtils.mjs";
import { prepareSocialHarnessMediaIntakeFixtures } from "./socialHarnessMediaIntakeE2E.mjs";
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
  verifyProjectMotionAfterRelaunch,
} from "./socialProjectEffectsE2E.mjs";
import * as candidateHandoffE2E from "./socialProjectCandidateHandoffE2E.mjs";
import { verifySocialAgentProjectEditInElectron } from "./socialProjectAgentEditingE2E.mjs";
import {
  createAndRunAccountRecipe,
  verifyAccountRecipeAfterRelaunch,
} from "./socialAccountRecipesE2E.mjs";
import {
  createClipPreparationScenario,
  verifySocialProductionWorkflowsInElectron,
} from "./socialHarnessClipPreparationE2E.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");
const { ffmpegExecutable, ffprobeExecutable } = resolveE2EMediaTools();
const vitePort =
  Number.parseInt(process.env.SOCIAL_HARNESS_E2E_VITE_PORT ?? "", 10) || (await reserveVitePort());

const {
  startDesktopRuntime,
  stopDesktopRuntime,
  waitForDevTools,
  waitForEndpointClosed,
  connectToPage,
} = createSocialHarnessE2ERuntime({ repoRoot, vitePort });

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
  await assertVitePortAvailable(vitePort);
  await mkdir(dirname(legacySentinelPath), { recursive: true });
  await writeFile(legacySentinelPath, legacySentinel);
  const settingsDir = join(homeDir, ".social-harness", "v1", "config");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    join(settingsDir, "setting.json"),
    JSON.stringify({ locale: "en-US", localePreference: "en-US", dataBaseDir }),
  );
  const sentinelBefore = await stat(legacySentinelPath);

  const environment = createIsolatedAccountE2EEnvironment({
    homeDir,
    testRoot,
    dataBaseDir,
    runId,
    vitePort,
    fixtures: mediaIntakeFixtures,
  });

  console.log("[social-e2e] starting first isolated Electron instance");
  runtime = startDesktopRuntime(environment);
  let cdpPort = await waitForDevTools(runtime);
  console.log("[social-e2e] first Electron instance is ready");
  ({ browser, page } = await connectToPage(cdpPort));

  const accountName = `Podcast pilot ${runId}`;
  const editedName = `Social Harness pilot ${runId}`;
  const projectName = `Motion smoke ${runId}`;
  const projectAgentScenario = createSocialProjectEditScenario(runId, projectName);
  const productionScenario = {
    marker: `PRODUCTION_${runId}`,
    projectName: `Conversation Reel ${runId}`,
    finalResponseText: "E2E conversation Reel exported and awaiting approval.",
  };
  const clipPreparationScenario = createClipPreparationScenario(runId);
  const automationTitle = `Weekly source research ${runId}`;
  const editedAutomationTitle = `Weekly account research ${runId}`;
  const automationWeekday = (new Date().getDay() + 2) % 7;
  await createAndEditAccount(page, runtime, accountName, editedName);
  const candidateFixtures = await candidateHandoffE2E.prepareAccountFixtures({
    page,
    dataBaseDir,
    accountName: editedName,
    ffmpegExecutable,
    mediaIntakeFixtures,
    runId,
  });
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
      candidateHandoffs: candidateFixtures.candidateHandoffs,
      production: productionScenario,
      clipPreparation: clipPreparationScenario,
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
  await createAndRunAccountRecipe(page);
  const clipIds = await createProjectMotionInElectron(page, runId, candidateFixtures.mediaFixture);
  await createSecondAccountAndVerifyIsolation(
    page,
    editedName,
    projectName,
    [
      candidateFixtures.mediaIntakeResult.localOriginalName,
      candidateFixtures.mediaIntakeResult.youtubeOriginalName,
      candidateFixtures.mediaIntakeResult.remoteOriginalName,
      candidateFixtures.mediaFixture.originalName,
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
  await verifySocialProductionWorkflowsInElectron(page, {
    scenario: productionScenario,
    clipPreparationScenario,
    ffmpegExecutable,
    mockProvider,
    dataBaseDir,
    firstAccountName: editedName,
    runId,
  });
  console.log(
    "[social-e2e] account policy, second-account library/project isolation, manual automation management, scheduled Scheduler/Main/Host rejection and successful local-model settlement, Social Agent project-tool editing, podcast/music candidate timestamp handoff, and same-timestamp preview/export parity verified",
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
  await candidateHandoffE2E.verifyCandidateProjectsAfterRelaunch(page, mockProvider);
  await verifyAccountRecipeAfterRelaunch(page);
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
    "Social Harness Electron E2E passed: account/profile/policy and second-account library/project isolation, account automation management and scheduled Host rejection/success, local model-provider endpoint, Social Agent project-tool editing, podcast/music candidate timestamp handoff, text and media timeline trims with cancel, ruler viewport virtualization, project motion effects, and matching-time Player/export rendering verified; candidate clips and their measured source ranges survived a full app relaunch, and the isolated legacy sentinel stayed unchanged.",
  );
} finally {
  await browser?.close().catch(() => undefined);
  await mockProvider?.close().catch(() => undefined);
  await stopDesktopRuntime(runtime);
  if (succeeded) {
    await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  } else {
    if (mockProvider)
      await writeFile(
        join(testRoot, "model-request-shapes.json"),
        JSON.stringify(describeFixtureModelRequests(mockProvider.requests), null, 2),
      );
    console.error(`E2E diagnostics retained at ${testRoot}`);
    if (runtime?.output) console.error(runtime.output);
  }
}
