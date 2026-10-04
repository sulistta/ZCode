import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile } from "@social-harness/shared/node";
import {
  socialMediaAssetSchema,
  socialMediaJobSchema,
  type SocialMediaAsset,
  type SocialMediaJob,
} from "@social-harness/shared";

export interface SocialMediaCatalog {
  version: 1;
  assets: SocialMediaAsset[];
  jobs: SocialMediaJob[];
}

export function parseSocialMediaCatalog(value: unknown): SocialMediaCatalog {
  if (Array.isArray(value)) {
    return {
      version: 1,
      assets: value.map((record) => socialMediaAssetSchema.parse(record)),
      jobs: [],
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Social media catalog must contain a supported record");
  }
  const catalog = value as Record<string, unknown>;
  if (catalog.version !== 1 || !Array.isArray(catalog.assets) || !Array.isArray(catalog.jobs)) {
    throw new Error("Unsupported social media catalog version");
  }
  return {
    version: 1,
    assets: catalog.assets.map((record) => socialMediaAssetSchema.parse(record)),
    jobs: catalog.jobs.map((record) => socialMediaJobSchema.parse(record)),
  };
}

export async function readSocialMediaCatalog(filePath: string): Promise<SocialMediaCatalog> {
  try {
    return parseSocialMediaCatalog(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, assets: [], jobs: [] };
    }
    throw error;
  }
}

export async function writeSocialMediaCatalog(
  filePath: string,
  catalog: SocialMediaCatalog,
): Promise<void> {
  await atomicWritePrivateTextFile(filePath, `${JSON.stringify(catalog, null, 2)}\n`);
}
