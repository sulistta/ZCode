export interface MediaCredentialStore {
  initialize(): Promise<void>;
  issue(accountId: string): Promise<string>;
  authenticate(credential: string): Promise<string | null>;
  revoke(credential: string): Promise<{
    accountHash: string;
    remainingCredentials: number;
  } | null>;
  revokeAll(credential: string): Promise<string | null>;
}
