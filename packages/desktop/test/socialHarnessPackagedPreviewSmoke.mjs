import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const packagedExecutable = process.env.SOCIAL_HARNESS_PACKAGED_EXECUTABLE?.trim();
if (!packagedExecutable) {
  throw new Error(
    "SOCIAL_HARNESS_PACKAGED_EXECUTABLE must point to the installed Preview executable",
  );
}
const executablePath = resolve(packagedExecutable);
await access(executablePath);

const launchTimeoutMs = 90_000;
const processStopTimeoutMs = 15_000;
const expectedSetupCopy = "No Instagram or AI provider connection is needed to prepare an account.";
const testRoot = await mkdtemp(join(tmpdir(), "social-harness-packaged-preview-smoke-"));
const homeDir = join(testRoot, "home");
const dataBaseDir = homeDir;
const accountName = `Packaged smoke ${Date.now()}`;
const legacySentinelPath = join(homeDir, ".zcode", "legacy-sentinel.txt");
const legacySentinel = Buffer.from("Packaged Social Harness smoke preserves legacy data.\n");
let runtime;
let browser;

function appendOutput(target, chunk) {
  target.output = `${target.output}${chunk.toString()}`.slice(-12_000);
}

async function reserveCdpPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve packaged E2E CDP port");
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

function startPackagedApp(port) {
  const args =
    process.platform === "linux" ? ["--appimage-extract-and-run", "--ozone-platform=x11"] : [];
  const environment = {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    HOME: homeDir,
    USERPROFILE: homeDir,
    SOCIAL_HARNESS_ENV: "production",
    SOCIAL_HARNESS_PREVIEW_IDENTITY: "1",
    SOCIAL_HARNESS_E2E_PACKAGED_PREVIEW: "1",
    SOCIAL_HARNESS_E2E_CDP_PORT: String(port),
    SOCIAL_HARNESS_DESKTOP_HOME_DIR: homeDir,
    SOCIAL_HARNESS_DESKTOP_USER_DATA_DIR: join(testRoot, "electron-user-data"),
    SOCIAL_HARNESS_DESKTOP_SESSION_DATA_DIR: join(testRoot, "electron-session-data"),
    SOCIAL_HARNESS_DATA_BASE_DIR: dataBaseDir,
    SOCIAL_HARNESS_E2E_RUN_ID: `packaged-${Date.now()}`,
  };
  if (process.platform === "linux") {
    environment.XDG_CONFIG_HOME = join(homeDir, ".config");
    environment.XDG_DATA_HOME = join(homeDir, ".local", "share");
    environment.XDG_CACHE_HOME = join(homeDir, ".cache");
    environment.XDG_STATE_HOME = join(homeDir, ".local", "state");
    delete environment.WAYLAND_DISPLAY;
  }
  const child = spawn(executablePath, args, {
    cwd: dirname(executablePath),
    detached: process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const current = { child, output: "" };
  child.stdout.on("data", (chunk) => appendOutput(current, chunk));
  child.stderr.on("data", (chunk) => appendOutput(current, chunk));
  return current;
}

function waitForExit(current, timeoutMs) {
  if (current.child.exitCode !== null || current.child.signalCode !== null)
    return Promise.resolve(true);
  return Promise.race([
    new Promise((resolveExit) => current.child.once("exit", () => resolveExit(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopPackagedApp(current) {
  if (!current || current.child.exitCode !== null || current.child.signalCode !== null) return;

  if (process.platform === "win32" && current.child.pid) {
    await new Promise((resolveKill) => {
      const taskkill = spawn("taskkill", ["/PID", String(current.child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.once("error", () => resolveKill());
      taskkill.once("close", () => resolveKill());
    });
  } else {
    try {
      if (current.child.pid) process.kill(-current.child.pid, "SIGTERM");
    } catch {
      current.child.kill("SIGTERM");
    }
  }

  if (await waitForExit(current, processStopTimeoutMs)) return;
  try {
    if (process.platform === "win32" && current.child.pid) {
      const taskkill = spawn("taskkill", ["/PID", String(current.child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.once("error", () => current.child.kill("SIGKILL"));
    } else if (current.child.pid) {
      process.kill(-current.child.pid, "SIGKILL");
    }
  } catch {
    current.child.kill("SIGKILL");
  }
  await waitForExit(current, 5_000);
}

async function waitForDevTools(current, port) {
  const deadline = Date.now() + launchTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (current.child.exitCode !== null || current.child.signalCode !== null) {
      throw new Error(`Installed Preview exited before DevTools was ready.\n${current.output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        await response.json();
        return;
      }
      lastError = new Error(`DevTools returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Installed Preview did not expose its opted-in DevTools endpoint: ${String(lastError)}\n${current.output}`,
  );
}

async function connectToPackagedPage(port) {
  const connected = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const page of connected.contexts().flatMap((context) => context.pages())) {
      try {
        await page.getByText(expectedSetupCopy, { exact: true }).waitFor({
          state: "visible",
          timeout: 1_000,
        });
        return { browser: connected, page };
      } catch {
        // The packaged renderer may create its initial page before the local UI is ready.
      }
    }
    await delay(250);
  }
  const urls = connected
    .contexts()
    .flatMap((context) => context.pages())
    .map((page) => page.url());
  await connected.close();
  throw new Error(`Installed Preview did not render account setup; pages=${JSON.stringify(urls)}`);
}

async function launchAndInspect() {
  const port = await reserveCdpPort();
  runtime = startPackagedApp(port);
  await waitForDevTools(runtime, port);
  const connected = await connectToPackagedPage(port);
  browser = connected.browser;
  assert.equal(await connected.page.title(), "Social Harness");
  return connected.page;
}

async function closeCurrentApp() {
  await browser?.close().catch(() => undefined);
  browser = undefined;
  await stopPackagedApp(runtime);
  runtime = undefined;
}

async function inspectInstagramAssistant(page) {
  const assistant = page.getByTestId("instagram-infrastructure-assistant");
  await assistant.locator("summary").click();
  await assistant.getByLabel("Production deployment URL").waitFor();
  await assistant.getByRole("button", { name: "Deploy the bundled bridge" }).waitFor();
  await assistant.locator("summary").click();
}

try {
  await mkdir(dirname(legacySentinelPath), { recursive: true });
  await writeFile(legacySentinelPath, legacySentinel);
  const sentinelBefore = await stat(legacySentinelPath);

  let page = await launchAndInspect();
  await page.getByRole("button", { name: "Create your first account" }).click();
  await page.getByLabel("Account name").fill(accountName);
  await page.getByLabel("Niche").fill("Podcast and music clips");
  await page.getByLabel("Audience").fill("Social Harness preview smoke");
  await page.getByLabel("Visual style").fill("Clear captions with restrained motion");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("heading", { level: 1, name: accountName, exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Changes saved." }).waitFor();
  await page
    .getByRole("region", { name: "Instagram connection" })
    .getByText("Instagram not connected", { exact: true })
    .waitFor();
  await inspectInstagramAssistant(page);
  await closeCurrentApp();

  page = await launchAndInspect();
  await page.getByRole("heading", { level: 1, name: accountName, exact: true }).waitFor();
  assert.equal(await page.getByLabel("Niche").inputValue(), "Podcast and music clips");
  assert.equal(await page.getByLabel("Audience").inputValue(), "Social Harness preview smoke");
  assert.equal(
    await page.getByLabel("Visual style").inputValue(),
    "Clear captions with restrained motion",
  );
  await inspectInstagramAssistant(page);
  await closeCurrentApp();

  const [sentinelAfter, sentinelAfterInfo] = await Promise.all([
    readFile(legacySentinelPath),
    stat(legacySentinelPath),
  ]);
  assert.deepEqual(sentinelAfter, legacySentinel);
  assert.equal(sentinelAfterInfo.mtimeMs, sentinelBefore.mtimeMs);
  console.log(
    "Installed Social Harness Preview smoke passed: account UI, Convex assistant, disconnected state, create/relaunch persistence, and unchanged legacy data.",
  );
} finally {
  await closeCurrentApp();
  await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
