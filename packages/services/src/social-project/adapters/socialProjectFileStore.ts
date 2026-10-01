import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@social-harness/shared/node";
import { z } from "zod";
import { socialProjectRecordSchema, type SocialProjectRecord } from "../domain/projectRecord.js";
import type { SocialProjectStore } from "../app/ports/socialProjectStore.js";

const storedCatalogSchema = z.object({
  version: z.literal(1),
  projects: z.array(socialProjectRecordSchema),
});

interface SocialProjectFileStoreOptions {
  filePath: string;
}

export function createSocialProjectFileStore(
  options: SocialProjectFileStoreOptions,
): SocialProjectStore {
  async function readAll(): Promise<SocialProjectRecord[]> {
    try {
      const content = await readFile(options.filePath, "utf8");
      return storedCatalogSchema.parse(JSON.parse(content) as unknown).projects;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeAll(projects: SocialProjectRecord[]): Promise<void> {
    const catalog = storedCatalogSchema.parse({ version: 1, projects });
    await atomicWritePrivateTextFile(options.filePath, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  return {
    async list(accountId) {
      return (await readAll()).filter((record) => record.project.accountId === accountId);
    },
    async get(accountId, projectId) {
      return (
        (await readAll()).find(
          (record) =>
            record.project.accountId === accountId && record.project.projectId === projectId,
        ) ?? null
      );
    },
    async create(record) {
      return withFileLock(options.filePath, async () => {
        const projects = await readAll();
        if (projects.some((current) => current.project.projectId === record.project.projectId)) {
          throw new Error(`Social project already exists: ${record.project.projectId}`);
        }
        const validated = socialProjectRecordSchema.parse(record);
        await writeAll([...projects, validated]);
        return validated;
      });
    },
    async update(accountId, projectId, transform) {
      return withFileLock(options.filePath, async () => {
        const projects = await readAll();
        const index = projects.findIndex(
          (record) =>
            record.project.accountId === accountId && record.project.projectId === projectId,
        );
        if (index < 0) return null;
        const current = projects[index]!;
        const next = transform(current);
        if (next === current) return current;
        const validated = socialProjectRecordSchema.parse(next);
        const updated = [...projects];
        updated[index] = validated;
        await writeAll(updated);
        return validated;
      });
    },
  };
}
