import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  TemporaryMediaRead,
  TemporaryMediaStore,
  TemporaryMediaUpload,
} from "../app/ports/temporaryMediaStore.js";
import {
  MAX_TEMPORARY_MEDIA_BYTES,
  TemporaryMediaStoreError,
} from "../app/ports/temporaryMediaStore.js";
import { manifestSchema, type MediaManifest } from "./fileTemporaryMediaManifest.js";
import { startTemporaryMediaExpiryWorker } from "./temporaryMediaExpiryWorker.js";

export const TEMPORARY_MEDIA_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_STORED_MEDIA_BYTES = 2 * MAX_TEMPORARY_MEDIA_BYTES;
const MAX_ACTIVE_MEDIA = 32;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

async function writePrivateTextFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export class FileTemporaryMediaStore implements TemporaryMediaStore {
  private readonly byLeaseId = new Map<string, MediaManifest>();
  private readonly byCapabilityHash = new Map<string, MediaManifest>();
  private readonly reservations = new Map<string, number>();
  private initialized: Promise<void> | null = null;
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = TEMPORARY_MEDIA_TTL_MS,
    private readonly maxStoredBytes = MAX_STORED_MEDIA_BYTES,
  ) {}

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async cleanupExpired(): Promise<void> {
    await this.ensureInitialized();
    await this.withLock(() => this.removeExpiredUnlocked());
  }

  // 空闲桥接不会触发媒体请求；只在启动/请求时清理会让过期文件无限期占盘，因此由存储所有者定时复用同一把锁回收。
  startCleanupWorker(
    options: {
      intervalMs?: number;
      onError?: (error: unknown) => void;
    } = {},
  ): () => void {
    return startTemporaryMediaExpiryWorker(this, () => this.cleanupExpired(), options);
  }

  async upload(input: {
    accountHash: string;
    body: ReadableStream<Uint8Array>;
    contentLength: number | null;
    idempotencyKey: string;
    expectedSha256: string;
  }): Promise<TemporaryMediaUpload> {
    await this.ensureInitialized();
    if (!/^[a-f0-9]{64}$/u.test(input.accountHash)) {
      throw new TemporaryMediaStoreError("invalid_media");
    }
    if (!/^[a-f0-9]{64}$/u.test(input.expectedSha256)) {
      throw new TemporaryMediaStoreError("invalid_media");
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/u.test(input.idempotencyKey)) {
      throw new TemporaryMediaStoreError("invalid_media");
    }
    if (
      input.contentLength !== null &&
      (!Number.isSafeInteger(input.contentLength) || input.contentLength < 1)
    ) {
      throw new TemporaryMediaStoreError("invalid_media");
    }
    if (input.contentLength !== null && input.contentLength > MAX_TEMPORARY_MEDIA_BYTES) {
      throw new TemporaryMediaStoreError("media_too_large");
    }

    const reservation = input.contentLength ?? MAX_TEMPORARY_MEDIA_BYTES;
    const leaseId = randomBytes(16).toString("base64url");
    const capability = randomBytes(32).toString("base64url");
    const partialPath = this.mediaPath(leaseId, ".uploading");
    const finalPath = this.mediaPath(leaseId, ".mp4");
    const existingOrReserved = await this.withLock(async () => {
      await this.removeExpiredUnlocked();
      const idempotencyHash = digest(input.idempotencyKey);
      const existing = [...this.byLeaseId.values()].find(
        (entry) =>
          entry.accountHash === input.accountHash && entry.idempotencyHash === idempotencyHash,
      );
      if (existing) {
        if (
          existing.sha256 !== input.expectedSha256 ||
          (input.contentLength !== null && existing.contentLength !== input.contentLength)
        ) {
          throw new TemporaryMediaStoreError("invalid_media");
        }
        return {
          existing: {
            leaseId: existing.leaseId,
            capability: existing.capability,
            expiresAt: existing.expiresAt,
          } satisfies TemporaryMediaUpload,
        };
      }
      if (
        this.reservations.has(input.accountHash) ||
        [...this.byLeaseId.values()].some((entry) => entry.accountHash === input.accountHash)
      ) {
        throw new TemporaryMediaStoreError("media_conflict");
      }
      if (this.byLeaseId.size + this.reservations.size >= MAX_ACTIVE_MEDIA) {
        throw new TemporaryMediaStoreError("media_capacity");
      }
      const storedBytes = [...this.byLeaseId.values()].reduce(
        (sum, entry) => sum + entry.contentLength,
        0,
      );
      const reservedBytes = [...this.reservations.values()].reduce((sum, size) => sum + size, 0);
      if (storedBytes + reservedBytes + reservation > this.maxStoredBytes) {
        throw new TemporaryMediaStoreError("media_capacity");
      }
      this.reservations.set(input.accountHash, reservation);
      return { existing: null };
    });
    if (existingOrReserved.existing) return existingOrReserved.existing;

    let finalFileCreated = false;
    try {
      const streamHash = createHash("sha256");
      let bytesWritten = 0;
      const verifyAndCount = new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesWritten += buffer.byteLength;
          if (bytesWritten > MAX_TEMPORARY_MEDIA_BYTES) {
            callback(new TemporaryMediaStoreError("media_too_large"));
            return;
          }
          streamHash.update(buffer);
          callback(null, buffer);
        },
      });
      const body = Readable.fromWeb(
        input.body as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      await pipeline(
        body,
        verifyAndCount,
        createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
      );
      if (
        bytesWritten < 1 ||
        (input.contentLength !== null && bytesWritten !== input.contentLength)
      ) {
        throw new TemporaryMediaStoreError("invalid_media");
      }
      const actualSha256 = streamHash.digest("hex");
      if (actualSha256 !== input.expectedSha256) {
        throw new TemporaryMediaStoreError("invalid_media");
      }

      return await this.withLock(async () => {
        if (!this.reservations.has(input.accountHash)) {
          throw new TemporaryMediaStoreError("media_store_unavailable");
        }
        const createdAt = Math.trunc(this.now());
        const manifest: MediaManifest = {
          version: 1,
          leaseId,
          accountHash: input.accountHash,
          capabilityHash: digest(capability),
          capability,
          idempotencyHash: digest(input.idempotencyKey),
          sha256: actualSha256,
          contentLength: bytesWritten,
          createdAt,
          expiresAt: createdAt + this.ttlMs,
        };
        await rename(partialPath, finalPath);
        finalFileCreated = true;
        await writePrivateTextFile(this.manifestPath(leaseId), `${JSON.stringify(manifest)}\n`);
        this.byLeaseId.set(leaseId, manifest);
        this.byCapabilityHash.set(manifest.capabilityHash, manifest);
        this.reservations.delete(input.accountHash);
        return { leaseId, capability, expiresAt: manifest.expiresAt };
      });
    } catch (error) {
      await Promise.all([
        unlink(partialPath).catch(() => undefined),
        finalFileCreated ? unlink(finalPath).catch(() => undefined) : Promise.resolve(),
        finalFileCreated
          ? unlink(this.manifestPath(leaseId)).catch(() => undefined)
          : Promise.resolve(),
      ]);
      if (error instanceof TemporaryMediaStoreError) throw error;
      throw new TemporaryMediaStoreError("media_store_unavailable", { cause: error });
    } finally {
      await this.withLock(async () => {
        this.reservations.delete(input.accountHash);
      });
    }
  }

  async read(capability: string): Promise<TemporaryMediaRead | null> {
    await this.ensureInitialized();
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(capability)) return null;
    return this.withLock(async () => {
      await this.removeExpiredUnlocked();
      const manifest = this.byCapabilityHash.get(digest(capability));
      if (!manifest) return null;
      try {
        const file = await open(this.mediaPath(manifest.leaseId, ".mp4"), "r");
        return {
          body: file.createReadStream({ autoClose: true }),
          contentLength: manifest.contentLength,
          expiresAt: manifest.expiresAt,
        };
      } catch {
        await this.removeManifestUnlocked(manifest);
        return null;
      }
    });
  }

  async delete(accountHash: string, leaseId: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.withLock(async () => {
      const manifest = this.byLeaseId.get(leaseId);
      if (!manifest || manifest.accountHash !== accountHash) return false;
      await this.removeManifestUnlocked(manifest);
      return true;
    });
  }

  async deleteAccount(accountHash: string): Promise<void> {
    await this.ensureInitialized();
    await this.withLock(async () => {
      for (const manifest of this.byLeaseId.values()) {
        if (manifest.accountHash === accountHash) await this.removeManifestUnlocked(manifest);
      }
    });
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= this.load();
    return this.initialized;
  }

  private async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700);
    const files = await readdir(this.dataDir);
    const manifests: MediaManifest[] = [];
    for (const fileName of files) {
      if (!fileName.endsWith(".json")) continue;
      const leaseId = fileName.slice(0, -5);
      if (!/^[A-Za-z0-9_-]{22}$/u.test(leaseId)) continue;
      const manifestPath = join(this.dataDir, fileName);
      try {
        const content = await readFile(manifestPath, "utf8");
        const manifest = manifestSchema.parse(JSON.parse(content) as unknown);
        const fileStat = await stat(this.mediaPath(leaseId, ".mp4"));
        if (
          manifest.leaseId !== leaseId ||
          digest(manifest.capability) !== manifest.capabilityHash ||
          manifest.expiresAt <= this.now() ||
          fileStat.size !== manifest.contentLength
        ) {
          await this.removeFilesUnlocked(leaseId);
          continue;
        }
        manifests.push(manifest);
      } catch {
        await this.removeFilesUnlocked(leaseId);
      }
    }
    manifests.sort((left, right) => right.createdAt - left.createdAt);
    let storedBytes = 0;
    for (const manifest of manifests) {
      if (
        this.byLeaseId.size >= MAX_ACTIVE_MEDIA ||
        storedBytes + manifest.contentLength > this.maxStoredBytes
      ) {
        await this.removeFilesUnlocked(manifest.leaseId);
        continue;
      }
      this.byLeaseId.set(manifest.leaseId, manifest);
      this.byCapabilityHash.set(manifest.capabilityHash, manifest);
      storedBytes += manifest.contentLength;
    }
    for (const fileName of files) {
      if (fileName.endsWith(".uploading") || fileName.endsWith(".tmp")) {
        await unlink(join(this.dataDir, fileName)).catch(() => undefined);
      }
    }
    const knownLeaseIds = new Set(this.byLeaseId.keys());
    for (const fileName of files) {
      if (!fileName.endsWith(".mp4")) continue;
      const leaseId = fileName.slice(0, -4);
      if (!knownLeaseIds.has(leaseId))
        await unlink(join(this.dataDir, fileName)).catch(() => undefined);
    }
  }

  private async removeExpiredUnlocked(): Promise<void> {
    for (const manifest of this.byLeaseId.values()) {
      if (manifest.expiresAt <= this.now()) await this.removeManifestUnlocked(manifest);
    }
  }

  private async removeManifestUnlocked(manifest: MediaManifest): Promise<void> {
    await this.removeFilesUnlocked(manifest.leaseId);
    this.byLeaseId.delete(manifest.leaseId);
    this.byCapabilityHash.delete(manifest.capabilityHash);
  }

  private async removeFilesUnlocked(leaseId: string): Promise<void> {
    for (const suffix of [".mp4", ".json", ".uploading"] as const) {
      try {
        const path =
          suffix === ".json" ? this.manifestPath(leaseId) : this.mediaPath(leaseId, suffix);
        await unlink(path);
      } catch (error) {
        if (!isMissingFile(error)) throw new TemporaryMediaStoreError("media_store_unavailable");
      }
    }
  }

  private mediaPath(leaseId: string, suffix: ".mp4" | ".uploading"): string {
    return join(this.dataDir, `${leaseId}${suffix}`);
  }

  private manifestPath(leaseId: string): string {
    return join(this.dataDir, `${leaseId}.json`);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const current = this.lock;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await current;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
