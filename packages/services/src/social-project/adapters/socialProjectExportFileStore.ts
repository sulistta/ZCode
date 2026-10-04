import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@social-harness/shared/node";
import { z } from "zod";
import {
  socialProjectExportRecordSchema,
  type SocialProjectExportRecord,
} from "../domain/projectExportRecord.js";
import type { SocialProjectExportStore } from "../app/ports/socialProjectExportStore.js";

const storedExportsSchema = z.object({
  version: z.literal(1),
  exports: z.array(socialProjectExportRecordSchema),
});

export function createSocialProjectExportFileStore(filePath: string): SocialProjectExportStore {
  async function readAll(): Promise<SocialProjectExportRecord[]> {
    try {
      const content = await readFile(filePath, "utf8");
      return storedExportsSchema.parse(JSON.parse(content) as unknown).exports;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeAll(exports: SocialProjectExportRecord[]): Promise<void> {
    const value = storedExportsSchema.parse({ version: 1, exports });
    await atomicWritePrivateTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  return {
    async list(accountId, projectId) {
      return (await readAll()).filter(
        ({ job }) => job.accountId === accountId && (!projectId || job.projectId === projectId),
      );
    },
    async listAll() {
      return readAll();
    },
    async get(accountId, exportId) {
      return (
        (await readAll()).find(
          ({ job }) => job.accountId === accountId && job.exportId === exportId,
        ) ?? null
      );
    },
    async createIfAbsent(record) {
      return withFileLock(filePath, async () => {
        const exports = await readAll();
        const existing = exports.find(
          ({ job }) =>
            job.accountId === record.job.accountId && job.requestId === record.job.requestId,
        );
        if (existing) return { record: existing, created: false };
        if (exports.some(({ job }) => job.exportId === record.job.exportId)) {
          throw new Error(`Social project export already exists: ${record.job.exportId}`);
        }
        const validated = socialProjectExportRecordSchema.parse(record);
        await writeAll([...exports, validated]);
        return { record: validated, created: true };
      });
    },
    async update(accountId, exportId, transform) {
      return withFileLock(filePath, async () => {
        const exports = await readAll();
        const index = exports.findIndex(
          ({ job }) => job.accountId === accountId && job.exportId === exportId,
        );
        if (index < 0) return null;
        const current = exports[index]!;
        const next = transform(current);
        if (next === current) return current;
        const validated = socialProjectExportRecordSchema.parse(next);
        const updated = [...exports];
        updated[index] = validated;
        await writeAll(updated);
        return validated;
      });
    },
  };
}
