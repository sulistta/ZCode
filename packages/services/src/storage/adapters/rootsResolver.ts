/**
 * 数据根解析：R1 = 家目录下的 Social Harness v1 数据根，R2 = 自定义数据存储路径下的对应数据根。
 * 路径来源由调用方注入（desktop host 传 homedir 与 getDataBaseDir），模块内不读环境变量。
 */
import { join, resolve } from "node:path";
import type { RootsResolverPort } from "../app/ports.js";
import type { StorageRootSpec } from "@social-harness/shared";

const SOCIAL_HARNESS_DATA_DIR_SEGMENTS = [".social-harness", "v1"] as const;

export function resolveStorageRoots(params: {
  homeDir: string;
  dataBaseDir: string;
}): StorageRootSpec[] {
  const home = resolve(params.homeDir);
  const dataBase = resolve(params.dataBaseDir);
  const hasCustomDataBaseDir = dataBase !== home;
  // 只扫描 Social Harness 自有数据，避免存储管理读取或清理用户保留的旧 ZCode 目录。
  const roots: StorageRootSpec[] = [
    { id: "home", path: join(home, ...SOCIAL_HARNESS_DATA_DIR_SEGMENTS), hasCustomDataBaseDir },
  ];
  if (hasCustomDataBaseDir) {
    roots.push({
      id: "dataBaseDir",
      path: join(dataBase, ...SOCIAL_HARNESS_DATA_DIR_SEGMENTS),
      hasCustomDataBaseDir,
    });
  }
  return roots;
}

export function createStorageRootsResolver(params: {
  getHomeDir: () => string;
  getDataBaseDir: () => string;
}): RootsResolverPort {
  return {
    resolveRoots: async () =>
      resolveStorageRoots({ homeDir: params.getHomeDir(), dataBaseDir: params.getDataBaseDir() }),
  };
}
