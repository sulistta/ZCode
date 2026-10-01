import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@social-harness/shared/node";
import { socialAccountSchema, type SocialAccount } from "@social-harness/shared";
import type { SocialAccountStore } from "../app/ports/socialAccountStore.js";

interface SocialAccountFileStoreOptions {
  filePath: string;
}

function parseStoredAccounts(value: unknown): SocialAccount[] {
  if (!Array.isArray(value)) throw new Error("Social account store must contain an array");
  return value.map((record) => socialAccountSchema.parse(record));
}

export function createSocialAccountFileStore(
  options: SocialAccountFileStoreOptions,
): SocialAccountStore {
  const storePath = options.filePath;

  async function readAll(): Promise<SocialAccount[]> {
    try {
      const content = await readFile(storePath, "utf8");
      return parseStoredAccounts(JSON.parse(content) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeAll(accounts: SocialAccount[]): Promise<void> {
    await atomicWritePrivateTextFile(storePath, `${JSON.stringify(accounts, null, 2)}\n`);
  }

  return {
    async list() {
      return readAll();
    },
    async get(accountId) {
      return (await readAll()).find((account) => account.accountId === accountId) ?? null;
    },
    async create(account) {
      return withFileLock(storePath, async () => {
        const accounts = await readAll();
        if (accounts.some((candidate) => candidate.accountId === account.accountId)) {
          throw new Error(`Social account already exists: ${account.accountId}`);
        }
        accounts.push(account);
        await writeAll(accounts);
        return account;
      });
    },
    async update(accountId, transform) {
      return withFileLock(storePath, async () => {
        const accounts = await readAll();
        const index = accounts.findIndex((candidate) => candidate.accountId === accountId);
        if (index < 0) return null;
        const updated = transform(accounts[index]!);
        accounts[index] = updated;
        await writeAll(accounts);
        return updated;
      });
    },
  };
}
