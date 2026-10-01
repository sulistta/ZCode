import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { MediaCredentialStore } from "../app/ports/mediaCredentialStore.js";

const MAX_ACCOUNTS = 20_000;
const MAX_CREDENTIALS_PER_ACCOUNT = 4;
const indexSchema = z
  .object({
    version: z.literal(1),
    accounts: z.array(
      z
        .object({
          accountHash: z.string().regex(/^[a-f0-9]{64}$/u),
          credentialHash: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
  })
  .strict();

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

/** Stores only hashes of opaque credentials and local account identifiers. */
export class FileMediaCredentialStore implements MediaCredentialStore {
  private readonly credentialsByAccount = new Map<string, Set<string>>();
  private readonly accountsByCredential = new Map<string, string>();
  private initialized: Promise<void> | null = null;
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async issue(accountId: string): Promise<string> {
    await this.ensureInitialized();
    return this.withLock(async () => {
      const accountHash = digest(accountId);
      const currentCredentials = this.credentialsByAccount.get(accountHash);
      if (!currentCredentials && this.credentialsByAccount.size >= MAX_ACCOUNTS) {
        throw new Error("Media credential capacity reached");
      }
      if (currentCredentials && currentCredentials.size >= MAX_CREDENTIALS_PER_ACCOUNT) {
        throw new Error("Media credentials per-account capacity reached");
      }
      // 重连校验可能失败；并存旧 key，直到 Host 成功提交新连接后再撤销旧 key。
      const credential = randomBytes(32).toString("base64url");
      const next = this.cloneCredentials();
      const nextAccountCredentials = next.get(accountHash) ?? new Set<string>();
      nextAccountCredentials.add(digest(credential));
      next.set(accountHash, nextAccountCredentials);
      await this.persist(next);
      this.replace(next);
      return credential;
    });
  }

  async authenticate(credential: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(credential)) return null;
    await this.ensureInitialized();
    return this.accountsByCredential.get(digest(credential)) ?? null;
  }

  async revoke(
    credential: string,
  ): Promise<{ accountHash: string; remainingCredentials: number } | null> {
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(credential)) return null;
    await this.ensureInitialized();
    return this.withLock(async () => {
      const credentialHash = digest(credential);
      const accountHash = this.accountsByCredential.get(credentialHash) ?? null;
      if (!accountHash) return null;
      const next = this.cloneCredentials();
      const accountCredentials = next.get(accountHash);
      accountCredentials?.delete(credentialHash);
      const remainingCredentials = accountCredentials?.size ?? 0;
      if (!remainingCredentials) next.delete(accountHash);
      await this.persist(next);
      this.replace(next);
      return { accountHash, remainingCredentials };
    });
  }

  async revokeAll(credential: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(credential)) return null;
    await this.ensureInitialized();
    return this.withLock(async () => {
      const accountHash = this.accountsByCredential.get(digest(credential)) ?? null;
      if (!accountHash) return null;
      const next = this.cloneCredentials();
      next.delete(accountHash);
      await this.persist(next);
      this.replace(next);
      return accountHash;
    });
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= this.load();
    return this.initialized;
  }

  private async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700);
    const path = join(this.dataDir, "media-credentials.json");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return;
      throw new Error("Media credential index could not be read");
    }
    let parsed: z.infer<typeof indexSchema>;
    try {
      parsed = indexSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      throw new Error("Media credential index is invalid");
    }
    if (parsed.accounts.length > MAX_ACCOUNTS * MAX_CREDENTIALS_PER_ACCOUNT) {
      throw new Error("Media credential index exceeds capacity");
    }
    for (const entry of parsed.accounts) {
      if (this.accountsByCredential.has(entry.credentialHash)) {
        throw new Error("Media credential index contains duplicate credentials");
      }
      const accountCredentials = this.credentialsByAccount.get(entry.accountHash);
      if (accountCredentials && accountCredentials.size >= MAX_CREDENTIALS_PER_ACCOUNT) {
        throw new Error("Media credential index exceeds per-account capacity");
      }
      if (!accountCredentials && this.credentialsByAccount.size >= MAX_ACCOUNTS) {
        throw new Error("Media credential index exceeds account capacity");
      }
      const nextAccountCredentials = accountCredentials ?? new Set<string>();
      nextAccountCredentials.add(entry.credentialHash);
      this.credentialsByAccount.set(entry.accountHash, nextAccountCredentials);
      this.accountsByCredential.set(entry.credentialHash, entry.accountHash);
    }
  }

  private async persist(next: Map<string, Set<string>>): Promise<void> {
    const accounts = [...next].flatMap(([accountHash, credentialHashes]) =>
      [...credentialHashes].map((credentialHash) => ({ accountHash, credentialHash })),
    );
    await writePrivateTextFile(
      join(this.dataDir, "media-credentials.json"),
      `${JSON.stringify({ version: 1, accounts })}\n`,
    );
  }

  private cloneCredentials(): Map<string, Set<string>> {
    return new Map(
      [...this.credentialsByAccount].map(([accountHash, credentialHashes]) => [
        accountHash,
        new Set(credentialHashes),
      ]),
    );
  }

  private replace(next: Map<string, Set<string>>): void {
    this.credentialsByAccount.clear();
    this.accountsByCredential.clear();
    for (const [accountHash, credentialHashes] of next) {
      this.credentialsByAccount.set(accountHash, credentialHashes);
      for (const credentialHash of credentialHashes) {
        this.accountsByCredential.set(credentialHash, accountHash);
      }
    }
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
