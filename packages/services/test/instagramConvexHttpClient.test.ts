import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInstagramConvexBridgeHttpClient } from "../src/social-publishing/adapters/instagramConvexBridgeHttpClient.js";
const deploymentUrl = "https://test-bridge-123.convex.cloud/";
const installationCredential = "A".repeat(43);
const credential = "B".repeat(43);
test("daily ticket redemption binds the secure token set to this installation, without administrative credentials", async () => {
  const client = createInstagramConvexBridgeHttpClient({
    deploymentUrl,
    installationCredential,
    fetcher: async (_, init) => {
      assert.equal(init.headers["x-social-installation"], installationCredential);
      assert.equal(init.headers.authorization, undefined);
      return Response.json({
        accessToken: "meta-fixture-token",
        expiresAt: Date.now() + 60_000,
        mediaUploadCredential: credential,
      });
    },
  });
  const tokens = await client.redeemHandoff({
    handoffTicket: "C".repeat(43),
    codeVerifier: "D".repeat(43),
  });
  assert.equal(
    tokens.bridgeInstallationHash,
    createHash("sha256").update(installationCredential).digest("base64url"),
  );
  assert.equal(tokens.bridgeOrigin, "https://test-bridge-123.convex.site");
});
test("uploads directly to storage and binds finalization to the returned lease", async () => {
  const calls = [];
  const client = createInstagramConvexBridgeHttpClient({
    deploymentUrl,
    installationCredential,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/reserve"))
        return Response.json({
          leaseId: "C".repeat(22),
          expiresAt: Date.now() + 10000,
          uploadUrl: "https://test-bridge-123.convex.cloud/api/storage/upload",
        });
      if (String(url).includes("/api/storage/upload"))
        return Response.json({ storageId: "storage-test-id" });
      return Response.json({
        leaseId: "C".repeat(22),
        expiresAt: Date.now() + 10000,
        mediaUrl: "https://test-bridge-123.convex.cloud/api/storage/video",
      });
    },
  });
  await client.uploadTemporaryMedia({
    accountId: "account",
    credential,
    file: new Blob(["video"]),
    sha256: "d".repeat(64),
    idempotencyKey: "request-1234567890",
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].init.headers.authorization, undefined);
  assert.equal(calls[1].init.headers["x-social-installation"], undefined);
  assert.equal(calls[1].init.body instanceof Blob, true);
  assert.equal(JSON.parse(calls[2].init.body).storageId, "storage-test-id");
});
test("rejects foreign upload URL without transmitting the video", async () => {
  let calls = 0;
  const client = createInstagramConvexBridgeHttpClient({
    deploymentUrl,
    installationCredential,
    fetcher: async () => {
      calls++;
      return Response.json({
        leaseId: "C".repeat(22),
        expiresAt: Date.now() + 10000,
        uploadUrl: "https://foreign.convex.cloud/api/storage/upload",
      });
    },
  });
  await assert.rejects(
    client.uploadTemporaryMedia({
      accountId: "account",
      credential,
      file: new Blob(["video"]),
      sha256: "d".repeat(64),
      idempotencyKey: "request-1234567890",
    }),
  );
  assert.equal(calls, 1);
});
test("quota exhaustion has an actionable code; upload failure cleans reservation", async () => {
  const paths = [];
  const client = createInstagramConvexBridgeHttpClient({
    deploymentUrl,
    installationCredential,
    fetcher: async (url) => {
      paths.push(String(url));
      if (String(url).endsWith("/reserve"))
        return Response.json({
          leaseId: "C".repeat(22),
          expiresAt: Date.now() + 10000,
          uploadUrl: "https://test-bridge-123.convex.cloud/api/storage/upload",
        });
      if (String(url).includes("/api/storage/upload"))
        return new Response("quota exceeded", { status: 402 });
      return Response.json(null);
    },
  });
  await assert.rejects(
    client.uploadTemporaryMedia({
      accountId: "account",
      credential,
      file: new Blob(["video"]),
      sha256: "d".repeat(64),
      idempotencyKey: "request-1234567890",
    }),
    (e) => e.code === "capacity-unavailable",
  );
  assert.equal(paths.at(-1).endsWith("/delete"), true);
});
