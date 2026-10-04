import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LEGACY_FINDER_WORKFLOW_NAME = "Open in ZCode.workflow";
const LEGACY_FINDER_BUNDLE_ID = "dev.zcode.app.finder-open-workflow";
const LEGACY_WINDOWS_MENU_KEYS = [
  "HKCU\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode",
  "HKCU\\Software\\Classes\\Drive\\shell\\ZCode.OpenInZCode",
] as const;

type RegistryResult = { exitCode: number; stdout: string };
type RegistryRunner = (args: readonly string[]) => Promise<RegistryResult>;
type CleanupLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

function runRegistry(args: readonly string[]): Promise<RegistryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("reg.exe", [...args], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}

function refreshMacServicesIndex(): void {
  const child = spawn("/System/Library/CoreServices/pbs", ["-update"], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}

async function removeLegacyFinderWorkflow(options: {
  homeDir: string;
  logger: CleanupLogger;
  refreshServicesIndex: () => void;
}): Promise<void> {
  const workflowDir = join(options.homeDir, "Library", "Services", LEGACY_FINDER_WORKFLOW_NAME);
  const infoPlistPath = join(workflowDir, "Contents", "Info.plist");

  try {
    const infoPlist = await readFile(infoPlistPath, "utf8");
    const ownsLegacyWorkflow = new RegExp(
      `<key>CFBundleIdentifier</key>\\s*<string>${LEGACY_FINDER_BUNDLE_ID}</string>`,
      "u",
    ).test(infoPlist);
    if (!ownsLegacyWorkflow) return;

    await rm(workflowDir, { recursive: true });
    options.refreshServicesIndex();
    options.logger.info("[legacy-open-folder] removed the app-owned Finder workflow", {
      workflowPath: workflowDir,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    options.logger.warn("[legacy-open-folder] failed to remove the Finder workflow", {
      error: error instanceof Error ? error.message : String(error),
      workflowPath: workflowDir,
    });
  }
}

async function removeLegacyWindowsMenuKey(
  key: string,
  runner: RegistryRunner,
  logger: CleanupLogger,
): Promise<void> {
  try {
    const command = await runner(["query", `${key}\\command`, "/ve"]);
    if (command.exitCode !== 0 || !command.stdout.includes("--open-workspace")) return;

    // 命令值是旧安装器写入的所有权标记。命令被用户替换后保留整个键，避免误删自定义菜单。
    const removed = await runner(["delete", key, "/f"]);
    if (removed.exitCode !== 0) {
      throw new Error(`reg.exe exited with code ${removed.exitCode}`);
    }
    logger.info("[legacy-open-folder] removed the app-owned Explorer menu", { key });
  } catch (error) {
    logger.warn("[legacy-open-folder] failed to remove the Explorer menu", {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
  }
}

/** Removes only the exact Finder/Explorer folder actions installed by older Desktop builds. */
export async function cleanupLegacyOpenFolderActions(options: {
  platform: NodeJS.Platform;
  homeDir?: string;
  logger: CleanupLogger;
  registryRunner?: RegistryRunner;
  refreshServicesIndex?: () => void;
}): Promise<void> {
  if (options.platform === "darwin") {
    await removeLegacyFinderWorkflow({
      homeDir: options.homeDir ?? homedir(),
      logger: options.logger,
      refreshServicesIndex: options.refreshServicesIndex ?? refreshMacServicesIndex,
    });
    return;
  }

  if (options.platform === "win32") {
    const registryRunner = options.registryRunner ?? runRegistry;
    await Promise.all(
      LEGACY_WINDOWS_MENU_KEYS.map((key) =>
        removeLegacyWindowsMenuKey(key, registryRunner, options.logger),
      ),
    );
  }
}
