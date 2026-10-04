/* Product data paths are centralized here; the legacy ZCode root is exposed read-only for migration guards. */
import { lstatSync } from "node:fs";
import { cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { homedir } from "node:os";
import {
  DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
  socialAccountIdSchema,
} from "@social-harness/shared";

let _dataBaseDir: string | null = null;
export const SOCIAL_HARNESS_WINDOWS_APP_INSTALL_DIR_ENV = "SOCIAL_HARNESS_WINDOWS_APP_INSTALL_DIR";
const envDataBaseDir = process.env.SOCIAL_HARNESS_DATA_BASE_DIR?.trim() || null;
const defaultDataBaseDir = process.env.HOME?.trim() || homedir();

interface DataBaseDirTargetValidationOptions {
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  appInstallDir?: string | null;
}

type DataBaseDirTargetValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE;
      forbiddenDir: string;
    };

/** Set the base directory for app data (replaces homedir() prefix). */
export function setDataBaseDir(dir: string | null): void {
  _dataBaseDir = dir?.trim() || null;
}

/** Get the current base directory. Priority: setDataBaseDir() > Social Harness env > homedir(). */
export function getDataBaseDir(): string {
  if (_dataBaseDir) return _dataBaseDir;
  if (envDataBaseDir) return envDataBaseDir;
  // 服务实例会启动后台刷新任务；若每次调用都动态读取 HOME，
  // 测试或宿主切换环境变量后，旧实例可能把数据写到新实例目录。
  return defaultDataBaseDir;
}

/** Legacy ZCode data root. Social Harness runtime paths must use getSocialHarnessDataRootDir(). */
export function getZCodeDataRootDir(): string {
  return join(getDataBaseDir(), ".zcode");
}

/** Social Harness v1 data root; intentionally separate from the legacy ZCode directory. */
export function getSocialHarnessDataRootDir(): string {
  return join(getDataBaseDir(), ".social-harness", "v1");
}

/** Non-project conversation workspace under the new Social Harness data root. */
export function getConversationWorkspaceDir(): string {
  return join(getSocialHarnessDataRootDir(), "workspace", "default");
}

/** Account-specific conversation cwd; account ID validation prevents path traversal. */
export function getSocialAccountConversationWorkspacePath(accountId: string): string {
  return join(
    getSocialAccountConversationWorkspaceRootDir(),
    socialAccountIdSchema.parse(accountId),
  );
}

export function getSocialAccountConversationWorkspaceRootDir(): string {
  return join(getSocialHarnessDataRootDir(), "social-accounts", "workspaces");
}

/** Used by the Host to reject a generic workspace request that targets account conversation data. */
export function isSocialAccountConversationWorkspacePath(workspacePath: string): boolean {
  const path = workspacePath.trim();
  if (!path) return false;
  const root = resolve(getSocialAccountConversationWorkspaceRootDir());
  const target = resolve(path);
  const relativePath = relative(root, target);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

/** Social Harness application configuration directory. */
export function getAppConfigDir(): string {
  return join(getSocialHarnessDataRootDir(), "config");
}

/** Minimal home-level pointer used before Desktop can open the selected data root. */
export function getDataBaseDirBootstrapFilePath(homeDir: string): string {
  return join(homeDir, ".social-harness", "v1", "config", "data-base-dir.json");
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const direct = env[key]?.trim();
  if (direct) {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(env)) {
    if (candidateKey.toLowerCase() !== lowerKey) {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeWindowsComparablePath(pathValue: string): string | null {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = win32.normalize(trimmed).replace(/[\\/]+$/, "");
  if (!normalized) {
    return null;
  }

  return win32
    .resolve(normalized)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isWindowsPathEqualOrInside(pathValue: string, rootValue: string): boolean {
  const normalizedPath = normalizeWindowsComparablePath(pathValue);
  const normalizedRoot = normalizeWindowsComparablePath(rootValue);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

function collectWindowsForbiddenAppInstallDirs(
  options: Required<Pick<DataBaseDirTargetValidationOptions, "env">> &
    Pick<DataBaseDirTargetValidationOptions, "appInstallDir">,
): string[] {
  const env = options.env;
  const programFiles = readEnvValue(env, "ProgramFiles");
  const programFilesX86 = readEnvValue(env, "ProgramFiles(x86)");
  const programW6432 = readEnvValue(env, "ProgramW6432");
  const localAppData = readEnvValue(env, "LOCALAPPDATA");
  const candidates = [
    options.appInstallDir,
    readEnvValue(env, SOCIAL_HARNESS_WINDOWS_APP_INSTALL_DIR_ENV),
    programFiles ? win32.join(programFiles, "ZCode") : null,
    programFilesX86 ? win32.join(programFilesX86, "ZCode") : null,
    programW6432 ? win32.join(programW6432, "ZCode") : null,
    localAppData ? win32.join(localAppData, "Programs", "ZCode") : null,
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized =
      typeof candidate === "string" ? normalizeWindowsComparablePath(candidate) : null;
    if (!candidate || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(candidate);
  }

  return result;
}

export function validateDataBaseDirTarget(
  targetBaseDir: string,
  options: DataBaseDirTargetValidationOptions = {},
): DataBaseDirTargetValidationResult {
  if ((options.platform ?? process.platform) !== "win32") {
    return { ok: true };
  }

  for (const forbiddenDir of collectWindowsForbiddenAppInstallDirs({
    env: options.env ?? process.env,
    appInstallDir: options.appInstallDir ?? null,
  })) {
    if (isWindowsPathEqualOrInside(targetBaseDir, forbiddenDir)) {
      return {
        ok: false,
        code: DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
        forbiddenDir,
      };
    }
  }

  return { ok: true };
}

export function getExportLogStageDir(): string {
  return join(getSocialHarnessDataRootDir(), "export-log-stage");
}

export function getExportLogDir(): string {
  return join(getSocialHarnessDataRootDir(), "export-log");
}

export function getFeedbackRootDir(): string {
  return join(getSocialHarnessDataRootDir(), "feedback");
}

export function getFeedbackAttachmentDir(): string {
  return join(getFeedbackRootDir(), "attachments");
}

export function getFeedbackLogArchiveDir(): string {
  return join(getFeedbackRootDir(), "logs");
}

export function getGitCheckpointIndexRootDir(): string {
  return join(getSocialHarnessDataRootDir(), "git-checkpoint-index");
}

/** Social Harness Host task index database. */
export function getTasksIndexDatabasePath(): string {
  return join(getAppConfigDir(), "tasks-index.sqlite");
}

/** workspace 级身份键：远程优先使用 workspaceIdentity，本地回退 workspacePath。 */
function getWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

/** Use workspaceIdentity when present to isolate remote and account-scoped sessions. */
export function getWorkspaceHash(workspacePath: string, workspaceIdentity?: string): string {
  return createHash("sha256")
    .update(getWorkspaceKey(workspacePath, workspaceIdentity))
    .digest("hex")
    .slice(0, 12);
}

/** Social Harness workspace session directory. */
function getTaskSessionDir(workspacePath: string, workspaceIdentity?: string): string {
  return join(getAppConfigDir(), "sessions", getWorkspaceHash(workspacePath, workspaceIdentity));
}

/** Social Harness task snapshot path. */
export function getLegacyTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.json`);
}

/** Social Harness deleted-task marker path. */
export function getLegacyDeletedTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.deleted.json`);
}

/**
 * Copy Social Harness-owned state to another base directory. Settings are
 * written separately at the destination, and their bootstrap pointer stays
 * anchored to the user's default home.
 */
export async function copyDataDirectory(oldBaseDir: string, newBaseDir: string): Promise<void> {
  const oldDir = join(oldBaseDir, ".social-harness", "v1");
  const newDir = join(newBaseDir, ".social-harness", "v1");
  await cp(oldDir, newDir, {
    recursive: true,
    force: false,
    filter: (source) => {
      const sourceName = basename(source);
      if (
        sourceName === "setting.json" ||
        sourceName.startsWith("setting.json.") ||
        sourceName === "data-base-dir.json" ||
        sourceName.startsWith("data-base-dir.json.")
      ) {
        // 设置与 bootstrap pointer 由迁移事务分别写入目标；原子写入 lock/tmp
        // 可能在扫描过程中消失，不能随通用数据树复制。
        return false;
      }
      // Windows 非提权环境下 fs.cp 无法复制符号链接（EPERM）。
      // 跳过符号链接可避免 Windows 非提权环境下 fs.cp 报 EPERM。
      try {
        if (lstatSync(source).isSymbolicLink()) return false;
      } catch {
        // lstat 失败时放行，让 cp 自行处理
      }
      return true;
    },
  });
}
