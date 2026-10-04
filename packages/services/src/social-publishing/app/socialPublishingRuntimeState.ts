import { randomBytes } from "node:crypto";

export const OAUTH_FLOW_TTL_MS = 5 * 60 * 1_000;
export const TOKEN_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
export const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1_000;

export interface PendingAuthorization {
  accountId: string;
  generation: number;
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

export function defaultNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function isSecureAuthorizationUrl(value: string, expectedState: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === "https://www.instagram.com" &&
      url.pathname === "/oauth/authorize" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.getAll("state").length === 1 &&
      url.searchParams.get("state") === expectedState
    );
  } catch {
    return false;
  }
}

export function createSocialPublishingRuntimeState(now: () => number) {
  const pendingByState = new Map<string, PendingAuthorization>();
  const pendingStateByAccount = new Map<string, string>();
  const accountGenerations = new Map<string, number>();
  const accountOperationTails = new Map<string, Promise<void>>();

  async function withAccountLock<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = accountOperationTails.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    accountOperationTails.set(accountId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (accountOperationTails.get(accountId) === tail) accountOperationTails.delete(accountId);
    }
  }

  function currentGeneration(accountId: string): number {
    return accountGenerations.get(accountId) ?? 0;
  }

  function advanceGeneration(accountId: string): number {
    const next = currentGeneration(accountId) + 1;
    accountGenerations.set(accountId, next);
    return next;
  }

  function removePendingForAccount(accountId: string): void {
    const previousState = pendingStateByAccount.get(accountId);
    if (previousState) pendingByState.delete(previousState);
    pendingStateByAccount.delete(accountId);
  }

  function isPending(pending: PendingAuthorization | undefined): pending is PendingAuthorization {
    return Boolean(pending && pending.expiresAt > now());
  }

  return {
    pendingByState,
    pendingStateByAccount,
    withAccountLock,
    currentGeneration,
    advanceGeneration,
    removePendingForAccount,
    isPending,
  };
}
