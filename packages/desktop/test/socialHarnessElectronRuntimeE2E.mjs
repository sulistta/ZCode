import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const buildReadinessTimeoutMs = 300_000;
const electronReadinessTimeoutMs = 30_000;
const rendererLoadTimeoutMs = 60_000;
const rendererContentTimeoutMs = 30_000;
const processStopTimeoutMs = 15_000;
const maxCapturedOutputLength = 24_000;

export function createSocialHarnessE2ERuntime({ repoRoot, vitePort }) {
  const devEntrypoint = resolve(repoRoot, "scripts/dev-desktop-env.mjs");
  function appendOutput(runtime, chunk) {
    runtime.output = `${runtime.output}${chunk.toString()}`.slice(-maxCapturedOutputLength);
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
        throw new Error(
          `Desktop test runtime exited before DevTools was ready.\n${runtime.output}`,
        );
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
    throw new Error(
      `Social Harness account setup window did not open: ${JSON.stringify(pageUrls)}`,
    );
  }

  return {
    startDesktopRuntime,
    stopDesktopRuntime,
    waitForDevTools,
    waitForEndpointClosed,
    connectToPage,
  };
}
