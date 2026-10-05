import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { FileMediaCredentialStore } from "../src/adapters/fileMediaCredentialStore.js";
import { FileTemporaryMediaStore } from "../src/adapters/fileTemporaryMediaStore.js";
import { TemporaryMediaStoreError } from "../src/app/ports/temporaryMediaStore.js";

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "social-harness-bridge-test-"));
}

function toWebStream(bytes: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("media credentials preserve reconnect keys, revoke individually, and enforce account limits", async (t) => {
  const root = await createTempDir();
  t.after(async () => rm(root, { recursive: true, force: true }));
  const accountId = "local-account-secret";
  const firstStore = new FileMediaCredentialStore(root);
  await firstStore.initialize();
  const firstCredential = await firstStore.issue(accountId);
  assert.equal(await firstStore.authenticate(firstCredential), sha256(Buffer.from(accountId)));

  const index = await readFile(join(root, "media-credentials.json"), "utf8");
  assert.equal(index.includes(accountId), false);
  assert.equal(index.includes(firstCredential), false);
  assert.equal((await stat(join(root, "media-credentials.json"))).mode & 0o777, 0o600);

  const restartedStore = new FileMediaCredentialStore(root);
  await restartedStore.initialize();
  assert.equal(await restartedStore.authenticate(firstCredential), sha256(Buffer.from(accountId)));
  const secondCredential = await restartedStore.issue(accountId);
  assert.notEqual(secondCredential, firstCredential);
  assert.equal(await restartedStore.authenticate(firstCredential), sha256(Buffer.from(accountId)));
  assert.equal(await restartedStore.authenticate(secondCredential), sha256(Buffer.from(accountId)));
  assert.deepEqual(await restartedStore.revoke(firstCredential), {
    accountHash: sha256(Buffer.from(accountId)),
    remainingCredentials: 1,
  });
  assert.equal(await restartedStore.authenticate(firstCredential), null);
  assert.equal(await restartedStore.authenticate(secondCredential), sha256(Buffer.from(accountId)));
  const thirdCredential = await restartedStore.issue(accountId);
  const fourthCredential = await restartedStore.issue(accountId);
  const fifthCredential = await restartedStore.issue(accountId);
  const otherAccount = "another-local-account";
  const otherCredential = await restartedStore.issue(otherAccount);
  await assert.rejects(restartedStore.issue(accountId), /per-account capacity/u);
  assert.equal(await restartedStore.revokeAll(secondCredential), sha256(Buffer.from(accountId)));
  assert.equal(await restartedStore.authenticate(secondCredential), null);
  assert.equal(await restartedStore.authenticate(thirdCredential), null);
  assert.equal(await restartedStore.authenticate(fourthCredential), null);
  assert.equal(await restartedStore.authenticate(fifthCredential), null);
  assert.equal(
    await restartedStore.authenticate(otherCredential),
    sha256(Buffer.from(otherAccount)),
  );
  assert.equal(await restartedStore.revokeAll(otherCredential), sha256(Buffer.from(otherAccount)));
});

test("temporary media survives restart, is account-scoped, and supports early cleanup", async (t) => {
  const root = await createTempDir();
  t.after(async () => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("approved mp4 bytes");
  const accountHash = "a".repeat(64);
  const store = new FileTemporaryMediaStore(root, () => 10_000, 60_000, 100);
  await store.initialize();
  const upload = await store.upload({
    accountHash,
    body: toWebStream(bytes),
    contentLength: bytes.byteLength,
    idempotencyKey: "publication-request-id",
    expectedSha256: sha256(bytes),
  });
  assert.equal(upload.expiresAt, 70_000);

  const restartedStore = new FileTemporaryMediaStore(root, () => 20_000, 60_000, 100);
  await restartedStore.initialize();
  const retriedUpload = await restartedStore.upload({
    accountHash,
    body: toWebStream(Buffer.from("unread replacement")),
    contentLength: bytes.byteLength,
    idempotencyKey: "publication-request-id",
    expectedSha256: sha256(bytes),
  });
  assert.deepEqual(retriedUpload, upload);
  const fetched = await restartedStore.read(upload.capability);
  assert.ok(fetched);
  assert.equal(fetched.contentLength, bytes.byteLength);
  assert.deepEqual(Buffer.concat(await Array.fromAsync(fetched.body)), bytes);
  assert.equal(await restartedStore.delete("b".repeat(64), upload.leaseId), false);
  assert.equal(await restartedStore.delete(accountHash, upload.leaseId), true);
  assert.equal(await restartedStore.read(upload.capability), null);
});

test("temporary media verifies streamed size and digest and rejects capacity overflow", async (t) => {
  const root = await createTempDir();
  t.after(async () => rm(root, { recursive: true, force: true }));
  let now = 1_000;
  const store = new FileTemporaryMediaStore(root, () => now, 100, 4);
  await store.initialize();
  const bytes = Buffer.from("abc");
  await assert.rejects(
    store.upload({
      accountHash: "a".repeat(64),
      body: toWebStream(bytes),
      contentLength: bytes.byteLength,
      idempotencyKey: "first-publication-request",
      expectedSha256: "0".repeat(64),
    }),
    (error: unknown) => error instanceof TemporaryMediaStoreError && error.code === "invalid_media",
  );

  await store.upload({
    accountHash: "a".repeat(64),
    body: toWebStream(bytes),
    contentLength: bytes.byteLength,
    idempotencyKey: "first-publication-request",
    expectedSha256: sha256(bytes),
  });
  await assert.rejects(
    store.upload({
      accountHash: "b".repeat(64),
      body: toWebStream(Buffer.from("xy")),
      contentLength: 2,
      idempotencyKey: "second-publication-request",
      expectedSha256: sha256(Buffer.from("xy")),
    }),
    (error: unknown) =>
      error instanceof TemporaryMediaStoreError && error.code === "media_capacity",
  );

  now = 1_100;
  const nextProcess = new FileTemporaryMediaStore(root, () => now, 100, 4);
  await nextProcess.initialize();
  assert.equal(await nextProcess.read("not-a-capability"), null);
  const remaining = await nextProcess.read("a".repeat(43));
  assert.equal(remaining, null);
  assert.equal(
    (await (await import("node:fs/promises")).readdir(root)).some((name) => name.endsWith(".mp4")),
    false,
  );
});

test("temporary media is physically removed by the expiry worker while the bridge is idle", async (t) => {
  const root = await createTempDir();
  t.after(async () => rm(root, { recursive: true, force: true }));
  let now = 1_000;
  const store = new FileTemporaryMediaStore(root, () => now, 100, 100);
  await store.initialize();
  const bytes = Buffer.from("idle expiry fixture");
  const upload = await store.upload({
    accountHash: "c".repeat(64),
    body: toWebStream(bytes),
    contentLength: bytes.byteLength,
    idempotencyKey: "idle-expiry-publication",
    expectedSha256: sha256(bytes),
  });
  let cleanupFailure: unknown;
  const stopCleanup = store.startCleanupWorker({
    intervalMs: 5,
    onError: (error) => {
      cleanupFailure = error;
    },
  });
  t.after(stopCleanup);
  now = upload.expiresAt;

  const deadline = Date.now() + 1_000;
  let remainingFiles: string[] = [];
  while (Date.now() < deadline) {
    remainingFiles = await readdir(root);
    if (remainingFiles.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(cleanupFailure, undefined);
  assert.deepEqual(remainingFiles, []);
  assert.equal(await store.read(upload.capability), null);
});
