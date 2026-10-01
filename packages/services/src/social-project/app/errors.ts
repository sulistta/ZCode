export class SocialProjectNotFoundError extends Error {
  constructor(accountId: string, projectId: string) {
    super(`Social project not found for account ${accountId}: ${projectId}`);
    this.name = "SocialProjectNotFoundError";
  }
}

export class SocialProjectAccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Social account not found: ${accountId}`);
    this.name = "SocialProjectAccountNotFoundError";
  }
}

export class SocialProjectRevisionConflictError extends Error {
  constructor(projectId: string, currentRevision: number) {
    super(
      `Social project revision conflict for ${projectId}; current revision is ${currentRevision}`,
    );
    this.name = "SocialProjectRevisionConflictError";
    this.currentRevision = currentRevision;
  }

  readonly currentRevision: number;
}

export class SocialProjectIdempotencyConflictError extends Error {
  constructor(commandId: string) {
    super(`Social project command ID was reused with another payload: ${commandId}`);
    this.name = "SocialProjectIdempotencyConflictError";
  }
}

export class SocialProjectAgentEditSuspendedError extends Error {
  constructor(projectId: string) {
    super(`Agent edits are suspended while the user controls project ${projectId}`);
    this.name = "SocialProjectAgentEditSuspendedError";
  }
}

export class SocialProjectMediaNotFoundError extends Error {
  constructor(accountId: string, mediaId: string) {
    super(`Media asset is not available to account ${accountId}: ${mediaId}`);
    this.name = "SocialProjectMediaNotFoundError";
  }
}

export class SocialProjectExportRequestConflictError extends Error {
  constructor(requestId: string) {
    super(`Social project export request ID was reused with another revision: ${requestId}`);
    this.name = "SocialProjectExportRequestConflictError";
  }
}

export class SocialProjectExportRevisionConflictError extends Error {
  constructor(projectId: string, currentRevision: number) {
    super(`Social project changed before export; current revision is ${currentRevision}`);
    this.name = "SocialProjectExportRevisionConflictError";
    this.currentRevision = currentRevision;
  }

  readonly currentRevision: number;
}

export class SocialProjectExportUnavailableError extends Error {
  constructor() {
    super("The requested project export is unavailable");
    this.name = "SocialProjectExportUnavailableError";
  }
}

export class SocialProjectExportRenderError extends Error {
  constructor(readonly code: SocialProjectExportJob["errorCode"]) {
    super(code ?? "render-failed");
    this.name = "SocialProjectExportRenderError";
  }
}
import type { SocialProjectExportJob } from "@social-harness/shared";
