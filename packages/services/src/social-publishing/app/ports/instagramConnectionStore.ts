import type { InstagramConnectionProfile } from "@social-harness/shared";

export interface InstagramConnectionRecord {
  profile: InstagramConnectionProfile;
  connectedAt: number;
}

export interface InstagramConnectionStore {
  get(accountId: string): Promise<InstagramConnectionRecord | null>;
  put(accountId: string, record: InstagramConnectionRecord): Promise<void>;
  delete(accountId: string): Promise<void>;
}
