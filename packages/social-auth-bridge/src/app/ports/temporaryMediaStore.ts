import type { Readable } from "node:stream";

export const MAX_TEMPORARY_MEDIA_BYTES = 1_073_741_824;

export type TemporaryMediaStoreErrorCode =
  | "invalid_media"
  | "media_too_large"
  | "media_conflict"
  | "media_capacity"
  | "media_store_unavailable";

export class TemporaryMediaStoreError extends Error {
  constructor(
    readonly code: TemporaryMediaStoreErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "TemporaryMediaStoreError";
  }
}

export interface TemporaryMediaUpload {
  leaseId: string;
  capability: string;
  expiresAt: number;
}

export interface TemporaryMediaRead {
  body: Readable;
  contentLength: number;
  expiresAt: number;
}

export interface TemporaryMediaStore {
  initialize(): Promise<void>;
  upload(input: {
    accountHash: string;
    body: ReadableStream<Uint8Array>;
    contentLength: number | null;
    idempotencyKey: string;
    expectedSha256: string;
  }): Promise<TemporaryMediaUpload>;
  read(capability: string): Promise<TemporaryMediaRead | null>;
  delete(accountHash: string, leaseId: string): Promise<boolean>;
  deleteAccount(accountHash: string): Promise<void>;
}
