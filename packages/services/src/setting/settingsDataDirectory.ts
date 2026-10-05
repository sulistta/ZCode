import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appSettingsSchema, type AppSettings } from "@social-harness/shared";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import {
  copyDataDirectory,
  getDataBaseDir,
  getDataBaseDirBootstrapFilePath,
  setDataBaseDir,
  validateDataBaseDirTarget,
} from "../paths.js";

type SettingsWriteUpdate = (
  shouldCommit: () => boolean,
  enterCommitPhase: () => void,
) => Promise<void>;

interface DataBaseDirUpdateDependencies {
  enqueueSettingsWrite: (runUpdate: SettingsWriteUpdate) => Promise<void>;
  readSettings: () => Promise<AppSettings>;
  persistSettings: (
    settings: AppSettings,
    shouldCommit: () => boolean,
    enterCommitPhase: () => void,
    destinationBaseDir: string,
    sourceBaseDir: string,
  ) => Promise<void>;
  logLegacyMirrorFailure: (error: unknown) => void;
}

function resolveUserHomeDir(): string {
  const envHome =
    process.env.SOCIAL_HARNESS_DESKTOP_HOME_DIR?.trim() ||
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

export function getSettingsFile(dataBaseDir: string = getDataBaseDir()): string {
  return join(dataBaseDir, ".social-harness", "v1", "config", "setting.json");
}

export function getLegacyHomeSettingsFile(): string {
  return join(resolveUserHomeDir(), ".social-harness", "v1", "config", "setting.json");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function readSettingsFileWithLegacyFallback(
  settingsFile: string,
  legacyHomeSettingsFile: string,
): Promise<{ raw: string; sourceFile: string; needsRootMigration: boolean }> {
  try {
    return {
      raw: await readFile(settingsFile, "utf-8"),
      sourceFile: settingsFile,
      needsRootMigration: false,
    };
  } catch (error) {
    if (!isMissingFile(error) || resolve(settingsFile) === resolve(legacyHomeSettingsFile)) {
      throw error;
    }
  }

  const legacyRaw = await readFile(legacyHomeSettingsFile, "utf-8");
  try {
    const currentRaw = await readFile(settingsFile, "utf-8");
    return {
      raw: currentRaw,
      sourceFile: settingsFile,
      needsRootMigration: false,
    };
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return {
      raw: legacyRaw,
      sourceFile: legacyHomeSettingsFile,
      needsRootMigration: true,
    };
  }
}

export async function persistDataBaseDirBootstrapPointer(
  dataBaseDir: string,
  onLegacyMirrorFailure?: (error: unknown) => void,
): Promise<void> {
  const homeDir = resolveUserHomeDir();
  const pointerFile = getDataBaseDirBootstrapFilePath(homeDir);
  await mkdir(dirname(pointerFile), { recursive: true });
  await atomicWriteText(pointerFile, JSON.stringify({ dataBaseDir }, null, 2));

  const homeSettingsFile = getLegacyHomeSettingsFile();
  if (resolve(homeSettingsFile) === resolve(getSettingsFile(dataBaseDir))) return;

  // 旧版通过 home 下的 setting.json 找数据根；完整设置已落到新目录，这里只保留启动指针。
  try {
    await atomicWriteText(homeSettingsFile, JSON.stringify({ dataBaseDir }, null, 2));
  } catch (error) {
    onLegacyMirrorFailure?.(error);
  }
}

export async function updateSettingsDataBaseDir(
  newDir: string | undefined,
  dependencies: DataBaseDirUpdateDependencies,
): Promise<void> {
  const targetBaseDir = newDir?.trim() || homedir();
  const validation = validateDataBaseDirTarget(targetBaseDir);
  if (!validation.ok) {
    // 安装目录由安装器和自动更新管理；拒绝把用户数据迁入其中，避免升级时被覆盖。
    const error = new Error(`${validation.code}: ${validation.forbiddenDir}`);
    (error as Error & { code: string }).code = validation.code;
    throw error;
  }

  await dependencies.enqueueSettingsWrite(async (shouldCommit, enterCommitPhase) => {
    const currentBaseDir = getDataBaseDir();
    const currentSettings = await dependencies.readSettings();
    if (currentBaseDir !== targetBaseDir) {
      await copyDataDirectory(currentBaseDir, targetBaseDir);
    }

    const updatedSettings = appSettingsSchema.parse({
      ...currentSettings,
      dataBaseDir: newDir,
    });
    if (updatedSettings.recentProjects) {
      updatedSettings.recentProjects = [...new Set(updatedSettings.recentProjects)].slice(0, 10);
    }

    await dependencies.persistSettings(
      updatedSettings,
      shouldCommit,
      enterCommitPhase,
      targetBaseDir,
      currentBaseDir,
    );
    if (!shouldCommit()) return;
    await persistDataBaseDirBootstrapPointer(targetBaseDir, dependencies.logLegacyMirrorFailure);
    setDataBaseDir(targetBaseDir);
  });
}
