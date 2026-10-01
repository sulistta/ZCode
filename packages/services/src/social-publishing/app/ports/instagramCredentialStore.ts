import type { InstagramAuthTokenSet } from "./instagramAuthBridge.js";

/** Host-only port backed by an Electron Main adapter that uses OS secure storage. */
export interface InstagramCredentialStore {
  load(accountId: string): Promise<InstagramAuthTokenSet | null>;
  store(accountId: string, tokens: InstagramAuthTokenSet): Promise<void>;
  delete(accountId: string): Promise<void>;
}
