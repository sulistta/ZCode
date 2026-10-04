import { realpath as fsRealpath } from "node:fs/promises";
import { realpathSync as fsRealpathSync, statSync as fsStatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  LOCAL_MEDIA_PREVIEW_SCHEME,
  SOCIAL_MEDIA_PREVIEW_CAPABILITY_TTL_MS,
  buildLocalMediaPreviewCapabilityUrl,
  buildLocalMediaPreviewUrl,
} from "@social-harness/shared";

interface LocalMediaPreviewSchemeRegistrar {
  registerSchemesAsPrivileged(
    schemes: Array<{
      scheme: string;
      privileges: { standard: boolean; secure: boolean; stream: boolean };
    }>,
  ): void;
}

interface LocalMediaPreviewProtocolRequest {
  url: string;
}

type LocalMediaPreviewProtocolResponse = string | { error: number };

interface LocalMediaPreviewProtocol {
  registerFileProtocol(
    scheme: string,
    handler: (
      request: LocalMediaPreviewProtocolRequest,
      callback: (response: LocalMediaPreviewProtocolResponse) => void,
    ) => void,
  ): boolean;
}

const installedProtocols = new WeakSet<object>();
const NET_ERR_INVALID_URL = -300;

interface LocalMediaPreviewPathRegistry {
  authorize(path: string): Promise<string>;
  createPreviewUrl(path: string): Promise<{ url: string; expiresAt: number }>;
  isAuthorized(path: string): boolean;
  resolveCapabilityToken(token: string): string | null;
  clear(): void;
}

const LOCAL_MEDIA_AUTHORIZATION_MAX_ENTRIES = 256;

/**
 * Main 只登记 Host 已经通过 workspace/session/message/attachment 校验的精确文件。
 * 旧协议直接信任 renderer URL 中的绝对 path，导致任何 renderer 脚本都能读取任意文件。
 */
export function createLocalMediaPreviewPathRegistry(
  dependencies: {
    isAbsolutePath?: (path: string) => boolean;
    realpath?: (path: string) => Promise<string>;
    realpathSync?: (path: string) => string;
    isRegularFileSync?: (path: string) => boolean;
    now?: () => number;
    createToken?: () => string;
    ttlMs?: number;
    maxEntries?: number;
  } = {},
): LocalMediaPreviewPathRegistry {
  const authorizedPaths = new Map<
    string,
    { canonicalPath: string; expiresAt: number; lastUsedAt: number }
  >();
  // 永久 Set 会无界增长，且路径被替换为 symlink 后仍继续获得 file loader 权限。
  const isAbsolutePath = dependencies.isAbsolutePath ?? isAbsolute;
  const realpath = dependencies.realpath ?? fsRealpath;
  const realpathSync = dependencies.realpathSync ?? fsRealpathSync;
  const isRegularFileSync =
    dependencies.isRegularFileSync ?? ((path: string) => fsStatSync(path).isFile());
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? SOCIAL_MEDIA_PREVIEW_CAPABILITY_TTL_MS;
  const createToken = dependencies.createToken ?? randomUUID;
  const maxEntries = dependencies.maxEntries ?? LOCAL_MEDIA_AUTHORIZATION_MAX_ENTRIES;
  const previewCapabilities = new Map<
    string,
    { canonicalPath: string; expiresAt: number; lastUsedAt: number }
  >();

  const pruneExpired = (observedAt: number) => {
    for (const [path, entry] of authorizedPaths) {
      if (entry.expiresAt <= observedAt) authorizedPaths.delete(path);
    }
    for (const [token, entry] of previewCapabilities) {
      if (entry.expiresAt <= observedAt) previewCapabilities.delete(token);
    }
  };

  const evictLeastRecentlyUsed = <T extends { lastUsedAt: number }>(entries: Map<string, T>) => {
    while (entries.size > maxEntries) {
      let oldestKey: string | undefined;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [key, entry] of entries) {
        if (entry.lastUsedAt < oldestAccess) {
          oldestAccess = entry.lastUsedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      entries.delete(oldestKey);
    }
  };

  const canonicalizePath = async (path: string): Promise<string> => {
    if (!isAbsolutePath(path)) {
      throw new Error("Local media preview path must be absolute");
    }
    return realpath(path);
  };

  const authorizePath = async (path: string): Promise<string> => {
    const canonicalPath = await canonicalizePath(path);
    const observedAt = now();
    pruneExpired(observedAt);
    authorizedPaths.set(canonicalPath, {
      canonicalPath,
      expiresAt: observedAt + ttlMs,
      lastUsedAt: observedAt,
    });
    evictLeastRecentlyUsed(authorizedPaths);
    return canonicalPath;
  };

  return {
    authorize: authorizePath,
    async createPreviewUrl(path) {
      // 新 token 只应授予 token 路由；不能顺带开放旧的 ?path= 授权入口。
      const canonicalPath = await canonicalizePath(path);
      const observedAt = now();
      pruneExpired(observedAt);
      const token = createToken();
      const expiresAt = observedAt + ttlMs;
      previewCapabilities.set(token, { canonicalPath, expiresAt, lastUsedAt: observedAt });
      evictLeastRecentlyUsed(previewCapabilities);
      return { url: buildLocalMediaPreviewCapabilityUrl(token), expiresAt };
    },
    isAuthorized(path) {
      const observedAt = now();
      pruneExpired(observedAt);
      const entry = authorizedPaths.get(path);
      if (!entry) return false;
      try {
        if (realpathSync(path) !== entry.canonicalPath || !isRegularFileSync(path)) {
          authorizedPaths.delete(path);
          return false;
        }
      } catch {
        authorizedPaths.delete(path);
        return false;
      }
      entry.lastUsedAt = observedAt;
      return true;
    },
    resolveCapabilityToken(token) {
      const observedAt = now();
      pruneExpired(observedAt);
      const entry = previewCapabilities.get(token);
      if (!entry) return null;
      try {
        if (
          realpathSync(entry.canonicalPath) !== entry.canonicalPath ||
          !isRegularFileSync(entry.canonicalPath)
        ) {
          previewCapabilities.delete(token);
          return null;
        }
      } catch {
        previewCapabilities.delete(token);
        return null;
      }
      entry.lastUsedAt = observedAt;
      return entry.canonicalPath;
    },
    clear() {
      authorizedPaths.clear();
      previewCapabilities.clear();
    },
  };
}

/**
 * Electron 要求 privileged scheme 在 app ready 前注册。
 * 缺少 standard 时 Chromium 不会按标准 URL 处理文件尾读取，导致 moov 位于 mdat
 * 之后的 MP4 被误判为不可解码；standard 与 stream 共同保留本地视频的元数据读取和 seek。
 */
export function registerLocalMediaPreviewScheme(protocol: LocalMediaPreviewSchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_PREVIEW_SCHEME,
      privileges: { standard: true, secure: true, stream: true },
    },
  ]);
}

export function installLocalMediaPreviewProtocol(
  protocol: LocalMediaPreviewProtocol,
  options: {
    isPathAuthorized: (path: string) => boolean;
    resolveCapabilityToken?: (token: string) => string | null;
  },
): void {
  if (installedProtocols.has(protocol)) return;
  // protocol.handle(Response) 在 Electron 41 中无法为本地音视频提供稳定的
  // seekable range，手工返回 Range 还会被媒体栈判为不可播放。复用原生 file loader，
  // 让 Chromium 处理 Range，同时仍只把校验后的音视频绝对路径交给 loader。
  const registered = protocol.registerFileProtocol(
    LOCAL_MEDIA_PREVIEW_SCHEME,
    (request, callback) => {
      try {
        const url = new URL(request.url);
        const capabilityMatch = /^\/preview\/([0-9a-f-]{36})$/i.exec(url.pathname);
        if (url.hostname === "local" && capabilityMatch && url.search === "" && url.hash === "") {
          const path = options.resolveCapabilityToken?.(capabilityMatch[1]!);
          callback(path ? path : { error: NET_ERR_INVALID_URL });
          return;
        }
        const path = url.searchParams.get("path") ?? "";
        if (
          url.hostname !== "local" ||
          url.pathname !== "/preview" ||
          !options.isPathAuthorized(path)
        ) {
          callback({ error: NET_ERR_INVALID_URL });
          return;
        }
        callback(path);
      } catch {
        callback({ error: NET_ERR_INVALID_URL });
      }
    },
  );
  if (!registered) throw new Error("Failed to register local media preview protocol");
  installedProtocols.add(protocol);
}

export { buildLocalMediaPreviewUrl };
