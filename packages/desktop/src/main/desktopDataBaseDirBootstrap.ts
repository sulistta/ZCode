import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDataBaseDirBootstrapFilePath, setDataBaseDir } from "@social-harness/services/node";

function resolveBootstrapHomePath(): string {
  return (
    process.env.SOCIAL_HARNESS_DESKTOP_HOME_DIR?.trim() || process.env.HOME?.trim() || homedir()
  );
}

function resolveBootstrapSettingsFile(homePath: string): string {
  return join(homePath, ".social-harness", "v1", "config", "setting.json");
}

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(homePath: string): string | null {
  const pointerFile = getDataBaseDirBootstrapFilePath(homePath);
  for (const settingsFile of [pointerFile, resolveBootstrapSettingsFile(homePath)]) {
    if (!existsSync(settingsFile)) continue;
    try {
      const raw = readFileSync(settingsFile, "utf-8");
      const dataBaseDir = extractBootstrapDataBaseDir(JSON.parse(raw));
      if (dataBaseDir) return dataBaseDir;
    } catch {
      // A broken pointer falls back to the previous home setting format.
    }
  }
  return null;
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  const homePath = resolveBootstrapHomePath();
  const dataBaseDir = readBootstrapDataBaseDirFromDisk(homePath);
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
  }
  return dataBaseDir;
}
