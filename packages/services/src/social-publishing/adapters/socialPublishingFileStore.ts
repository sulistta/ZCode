import { readFile } from "node:fs/promises";
import {
  instagramConnectionProfileSchema,
  socialAccountIdSchema,
  type InstagramConnectionProfile,
} from "@social-harness/shared";
import { atomicWritePrivateTextFile, withFileLock } from "@social-harness/shared/node";
import type {
  InstagramConnectionRecord,
  InstagramConnectionStore,
} from "../app/ports/instagramConnectionStore.js";

interface SocialPublishingFileStoreOptions {
  filePath: string;
}

function parseConnectedAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Social publishing connection timestamp is invalid");
  }
  return value;
}

function parseRecords(value: unknown): Record<string, InstagramConnectionRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Social publishing store must contain an object");
  }
  const records: Record<string, InstagramConnectionRecord> = {};
  for (const [rawAccountId, rawRecord] of Object.entries(value)) {
    const accountId = socialAccountIdSchema.parse(rawAccountId);
    if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
      throw new Error("Social publishing profile record must be an object");
    }
    const record = rawRecord as { profile?: unknown; connectedAt?: unknown };
    records[accountId] = {
      profile: instagramConnectionProfileSchema.parse(record.profile),
      connectedAt: parseConnectedAt(record.connectedAt),
    };
  }
  return records;
}

export function createSocialPublishingFileStore(
  options: SocialPublishingFileStoreOptions,
): InstagramConnectionStore {
  async function readAll(): Promise<Record<string, InstagramConnectionRecord>> {
    try {
      const content = await readFile(options.filePath, "utf8");
      return parseRecords(JSON.parse(content) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  async function writeAll(records: Record<string, InstagramConnectionRecord>): Promise<void> {
    await atomicWritePrivateTextFile(options.filePath, `${JSON.stringify(records, null, 2)}\n`);
  }

  return {
    async get(accountId) {
      const parsedAccountId = socialAccountIdSchema.parse(accountId);
      return (await readAll())[parsedAccountId] ?? null;
    },
    async put(accountId, record) {
      const parsedAccountId = socialAccountIdSchema.parse(accountId);
      const normalized: InstagramConnectionRecord = {
        profile: instagramConnectionProfileSchema.parse(
          record.profile,
        ) as InstagramConnectionProfile,
        connectedAt: parseConnectedAt(record.connectedAt),
      };
      await withFileLock(options.filePath, async () => {
        const records = await readAll();
        records[parsedAccountId] = normalized;
        await writeAll(records);
      });
    },
    async delete(accountId) {
      const parsedAccountId = socialAccountIdSchema.parse(accountId);
      await withFileLock(options.filePath, async () => {
        const records = await readAll();
        if (!(parsedAccountId in records)) return;
        delete records[parsedAccountId];
        await writeAll(records);
      });
    },
  };
}
