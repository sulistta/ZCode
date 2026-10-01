import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@social-harness/shared/node";
import {
  SOCIAL_HARNESS_FILE_LOCK_TIMEOUT_ERROR_CODE,
  instagramPublicationSchema,
  socialAccountIdSchema,
  type InstagramPublication,
} from "@social-harness/shared";
import {
  InstagramPublicationActiveConflictError,
  type InstagramPublicationStore,
} from "../app/ports/instagramPublicationStore.js";

const ACTIVE_STATUSES = new Set([
  "preparing-media",
  "creating-container",
  "processing-container",
  "publishing",
]);

interface SocialPublishingPublicationFileStoreOptions {
  filePath: string;
}

function parsePublications(value: unknown): InstagramPublication[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Social publishing publication store must contain an object");
  }
  const data = value as { version?: unknown; publications?: unknown };
  if (data.version !== 1 || !Array.isArray(data.publications)) {
    throw new Error("Social publishing publication store version is invalid");
  }
  return data.publications.map((publication) => instagramPublicationSchema.parse(publication));
}

export function createSocialPublishingPublicationFileStore(
  options: SocialPublishingPublicationFileStoreOptions,
): InstagramPublicationStore {
  async function readAll(): Promise<InstagramPublication[]> {
    try {
      return parsePublications(JSON.parse(await readFile(options.filePath, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeAll(publications: InstagramPublication[]): Promise<void> {
    await atomicWritePrivateTextFile(
      options.filePath,
      `${JSON.stringify({ version: 1, publications }, null, 2)}\n`,
    );
  }

  return {
    async get(accountIdInput, publicationId) {
      const accountId = socialAccountIdSchema.parse(accountIdInput);
      return (
        (await readAll()).find(
          (publication) =>
            publication.accountId === accountId && publication.publicationId === publicationId,
        ) ?? null
      );
    },
    async list(accountIdInput) {
      const accountId = socialAccountIdSchema.parse(accountIdInput);
      return (await readAll())
        .filter((publication) => publication.accountId === accountId)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 100);
    },
    async listAll() {
      return readAll();
    },
    async createIfAbsent(input) {
      const publication = instagramPublicationSchema.parse(input);
      return withFileLock(options.filePath, async () => {
        const publications = await readAll();
        const existing = publications.find(
          (candidate) =>
            candidate.accountId === publication.accountId &&
            candidate.requestId === publication.requestId,
        );
        if (existing) return { publication: existing, created: false };
        if (
          publications.some(
            (candidate) =>
              candidate.accountId === publication.accountId &&
              ACTIVE_STATUSES.has(candidate.status),
          )
        ) {
          throw new InstagramPublicationActiveConflictError();
        }
        if (
          publications.some((candidate) => candidate.publicationId === publication.publicationId)
        ) {
          throw new Error("Instagram publication ID already exists");
        }
        await writeAll([...publications, publication]);
        return { publication, created: true };
      });
    },
    async update(accountIdInput, publicationId, transform) {
      const accountId = socialAccountIdSchema.parse(accountIdInput);
      return withFileLock(options.filePath, async () => {
        const publications = await readAll();
        const index = publications.findIndex(
          (publication) =>
            publication.accountId === accountId && publication.publicationId === publicationId,
        );
        if (index < 0) return null;
        const current = publications[index]!;
        const next = instagramPublicationSchema.parse(transform(current));
        if (next === current) return current;
        const updated = [...publications];
        updated[index] = next;
        await writeAll(updated);
        return next;
      });
    },
    async withRunnerLock(accountIdInput, operation) {
      const accountId = socialAccountIdSchema.parse(accountIdInput);
      const accountKey = createHash("sha256").update(accountId).digest("hex");
      try {
        await withFileLock(`${options.filePath}.runner-${accountKey}`, operation, {
          lockRetryDelaysMs: [20, 40],
          lockOwnerlessGraceMs: 10,
          lockMaxWaitMs: 100,
        });
        return true;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === SOCIAL_HARNESS_FILE_LOCK_TIMEOUT_ERROR_CODE
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}
