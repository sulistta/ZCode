import type { SocialProjectExportRecord } from "../../domain/projectExportRecord.js";

export interface SocialProjectExportStore {
  list(accountId: string, projectId?: string): Promise<SocialProjectExportRecord[]>;
  listAll(): Promise<SocialProjectExportRecord[]>;
  get(accountId: string, exportId: string): Promise<SocialProjectExportRecord | null>;
  createIfAbsent(
    record: SocialProjectExportRecord,
  ): Promise<{ record: SocialProjectExportRecord; created: boolean }>;
  update(
    accountId: string,
    exportId: string,
    transform: (current: SocialProjectExportRecord) => SocialProjectExportRecord,
  ): Promise<SocialProjectExportRecord | null>;
}
