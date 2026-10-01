import type { SocialAccount } from "@social-harness/shared";

export interface SocialAccountStore {
  list(): Promise<SocialAccount[]>;
  get(accountId: string): Promise<SocialAccount | null>;
  create(account: SocialAccount): Promise<SocialAccount>;
  update(
    accountId: string,
    transform: (current: SocialAccount) => SocialAccount,
  ): Promise<SocialAccount | null>;
}
