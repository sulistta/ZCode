export class SocialAccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Social account not found: ${accountId}`);
    this.name = "SocialAccountNotFoundError";
  }
}

export class SocialAccountRevisionConflictError extends Error {
  constructor(accountId: string, currentUpdatedAt: number) {
    super(`Social account changed before update: ${accountId}`);
    this.name = "SocialAccountRevisionConflictError";
    this.currentUpdatedAt = currentUpdatedAt;
  }

  readonly currentUpdatedAt: number;
}

export class SocialAccountWorkspaceUnavailableError extends Error {
  constructor() {
    super("Social account conversation workspace is unavailable");
    this.name = "SocialAccountWorkspaceUnavailableError";
  }
}
