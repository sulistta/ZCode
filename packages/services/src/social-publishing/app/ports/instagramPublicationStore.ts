import type { InstagramPublication } from "@social-harness/shared";

export class InstagramPublicationActiveConflictError extends Error {
  constructor() {
    super("An Instagram publication is already active for this account");
    this.name = "InstagramPublicationActiveConflictError";
  }
}

export interface InstagramPublicationStore {
  get(accountId: string, publicationId: string): Promise<InstagramPublication | null>;
  list(accountId: string): Promise<InstagramPublication[]>;
  listAll(): Promise<InstagramPublication[]>;
  createIfAbsent(
    publication: InstagramPublication,
  ): Promise<{ publication: InstagramPublication; created: boolean }>;
  update(
    accountId: string,
    publicationId: string,
    transform: (current: InstagramPublication) => InstagramPublication,
  ): Promise<InstagramPublication | null>;
  withRunnerLock(accountId: string, operation: () => Promise<void>): Promise<boolean>;
}
