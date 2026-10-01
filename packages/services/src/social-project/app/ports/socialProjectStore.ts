import type { SocialProjectSummary } from "@social-harness/shared";
import type { SocialProjectRecord } from "../../domain/projectRecord.js";

export interface SocialProjectStore {
  list(accountId: string): Promise<SocialProjectRecord[]>;
  get(accountId: string, projectId: string): Promise<SocialProjectRecord | null>;
  create(record: SocialProjectRecord): Promise<SocialProjectRecord>;
  update(
    accountId: string,
    projectId: string,
    transform: (current: SocialProjectRecord) => SocialProjectRecord,
  ): Promise<SocialProjectRecord | null>;
}

export function toSocialProjectSummary(record: SocialProjectRecord): SocialProjectSummary {
  return {
    projectId: record.project.projectId,
    accountId: record.project.accountId,
    displayName: record.project.displayName,
    revision: record.project.revision,
    updatedAt: record.project.updatedAt,
    trackCount: record.project.tracks.length,
  };
}
