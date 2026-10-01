import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWritePrivateTextFile } from "@social-harness/shared/node";
import { socialAccountIdSchema } from "@social-harness/shared";

const tokenSetSchema = z
  .object({
    accessToken: z.string().trim().min(1),
    expiresAt: z.number().int().nonnegative().optional(),
    refreshedAt: z.number().int().nonnegative().optional(),
    mediaUploadCredential: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43,128}$/u)
      .optional(),
  })
  .strict();

const encryptedEntrySchema = z
  .object({
    version: z.literal(1),
    encryptedTokenSet: z.string().min(1),
  })
  .strict();

export interface DesktopInstagramCredentialVault {
  get(accountId: string): Promise<string | null>;
  set(accountId: string, serializedTokenSet: string): Promise<void>;
  delete(accountId: string): Promise<void>;
}

interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface InstagramCredentialVaultOptions {
  rootDir: string;
  platform: NodeJS.Platform;
  safeStorage: SafeStoragePort;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

function credentialPath(rootDir: string, accountId: string): string {
  return join(
    rootDir,
    "social-publishing",
    "credentials",
    `${socialAccountIdSchema.parse(accountId)}.json`,
  );
}

export function createDesktopInstagramCredentialVault(
  options: InstagramCredentialVaultOptions,
): DesktopInstagramCredentialVault {
  function assertSecureStorageAvailable(): void {
    if (!options.safeStorage.isEncryptionAvailable()) {
      throw new Error("OS secure storage is unavailable");
    }
    if (
      options.platform === "linux" &&
      ["basic_text", "unknown"].includes(options.safeStorage.getSelectedStorageBackend())
    ) {
      throw new Error("OS secure storage backend is not protected");
    }
  }

  return {
    async get(accountId) {
      assertSecureStorageAvailable();
      const path = credentialPath(options.rootDir, accountId);
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw new Error("OS secure credential could not be read");
      }
      try {
        const entry = encryptedEntrySchema.parse(JSON.parse(content) as unknown);
        const decrypted = options.safeStorage.decryptString(
          Buffer.from(entry.encryptedTokenSet, "base64"),
        );
        const tokens = tokenSetSchema.parse(JSON.parse(decrypted) as unknown);
        return JSON.stringify(tokens);
      } catch {
        throw new Error("OS secure credential could not be decrypted");
      }
    },
    async set(accountId, serializedTokenSet) {
      assertSecureStorageAvailable();
      const path = credentialPath(options.rootDir, accountId);
      try {
        const tokens = tokenSetSchema.parse(JSON.parse(serializedTokenSet) as unknown);
        const encryptedTokenSet = options.safeStorage
          .encryptString(JSON.stringify(tokens))
          .toString("base64");
        const entry = encryptedEntrySchema.parse({ version: 1, encryptedTokenSet });
        await atomicWritePrivateTextFile(path, `${JSON.stringify(entry)}\n`);
      } catch {
        throw new Error("OS secure credential could not be saved");
      }
    },
    async delete(accountId) {
      const path = credentialPath(options.rootDir, accountId);
      try {
        await unlink(path);
      } catch (error) {
        if (!isMissingFile(error)) throw new Error("OS secure credential could not be removed");
      }
    },
  };
}
