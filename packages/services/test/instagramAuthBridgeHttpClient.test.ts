import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramAuthBridgeHttpClient } from "../src/social-publishing/adapters/instagramAuthBridgeHttpClient.js";

test("Instagram auth bridge accepts only a public HTTPS origin", () => {
  for (const baseUrl of [
    "http://auth.example.test",
    "https://user:password@auth.example.test",
    "https://auth.example.test/custom-path",
    "https://auth.example.test/?target=unexpected",
    "https://auth.example.test/#fragment",
  ]) {
    assert.throws(() => createInstagramAuthBridgeHttpClient({ baseUrl }));
  }
});

test("Instagram auth bridge calls fixed origin paths and validates token responses", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = createInstagramAuthBridgeHttpClient({
    baseUrl: "https://auth.example.test/",
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify(
          requests.length === 1
            ? { authorizeUrl: "https://www.instagram.com/oauth/authorize?state=abc" }
            : {
                accessToken: "private-token",
                expiresAt: 123,
                mediaUploadCredential: "private-media-credential".padEnd(43, "m"),
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const authorizeUrl = await client.createAuthorization({
    state: "state",
    codeChallenge: "challenge",
    accountId: "social-account",
  });
  const tokenSet = await client.redeemHandoff({
    handoffTicket: "ticket",
    codeVerifier: "verifier",
  });

  assert.equal(authorizeUrl, "https://www.instagram.com/oauth/authorize?state=abc");
  assert.deepEqual(tokenSet, {
    accessToken: "private-token",
    expiresAt: 123,
    mediaUploadCredential: "private-media-credential".padEnd(43, "m"),
  });
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://auth.example.test/v1/instagram/authorize",
      "https://auth.example.test/v1/instagram/redeem",
    ],
  );
  assert.equal(
    requests.every((request) => request.init?.redirect === "error"),
    true,
  );
});

test("malformed redemption response revokes a valid media credential before failing", async () => {
  const credential = "private-media-credential".padEnd(43, "m");
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = createInstagramAuthBridgeHttpClient({
    baseUrl: "https://auth.example.test",
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/v1/instagram/redeem")) {
        return new Response(
          JSON.stringify({
            accessToken: "",
            expiresAt: 123,
            mediaUploadCredential: credential,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 204 });
    },
  });

  await assert.rejects(
    client.redeemHandoff({ handoffTicket: "opaque-ticket", codeVerifier: "private-verifier" }),
    { message: "Instagram auth bridge returned an invalid handoff response" },
  );

  assert.deepEqual(
    requests.map(({ url, init }) => [url, init?.method]),
    [
      ["https://auth.example.test/v1/instagram/redeem", "POST"],
      ["https://auth.example.test/v1/media/credential", "DELETE"],
    ],
  );
  assert.equal(
    new Headers(requests[1]?.init?.headers).get("authorization"),
    `Bearer ${credential}`,
  );
});

test("temporary media operations keep credentials private and reject off-origin capability URLs", async () => {
  const credential = "host-vault-media-credential".padEnd(43, "m");
  const capability = "public-capability-token".padEnd(43, "c");
  const leaseId = "media-lease".padEnd(22, "l");
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = createInstagramAuthBridgeHttpClient({
    baseUrl: "https://auth.example.test",
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/v1/media/upload")) {
        return new Response(
          JSON.stringify({
            leaseId,
            mediaUrl: `https://auth.example.test/v1/media/${capability}`,
            expiresAt: 123_456,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 204 });
    },
  });
  const media = await client.uploadTemporaryMedia!({
    accountId: "local-account",
    credential,
    file: new Blob(["approved export"], { type: "video/mp4" }),
    idempotencyKey: "publication-request-id",
    sha256: "a".repeat(64),
  });
  await client.deleteTemporaryMedia!({ accountId: "local-account", credential, leaseId });
  await client.revokeMediaUploadCredential!(credential);
  await client.revokeAllMediaUploadCredentials!(credential);

  assert.deepEqual(media, {
    leaseId,
    mediaUrl: `https://auth.example.test/v1/media/${capability}`,
    expiresAt: 123_456,
  });
  assert.deepEqual(
    requests.map(({ url, init }) => [url, init?.method]),
    [
      ["https://auth.example.test/v1/media/upload", "POST"],
      [`https://auth.example.test/v1/media/${leaseId}`, "DELETE"],
      ["https://auth.example.test/v1/media/credential", "DELETE"],
      ["https://auth.example.test/v1/media/credentials", "DELETE"],
    ],
  );
  assert.equal(requests[0]?.init?.body instanceof Blob, true);
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("authorization"),
    `Bearer ${credential}`,
  );

  const unsafeClient = createInstagramAuthBridgeHttpClient({
    baseUrl: "https://auth.example.test",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          leaseId,
          mediaUrl: `https://attacker.example.test/v1/media/${capability}`,
          expiresAt: 123_456,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    unsafeClient.uploadTemporaryMedia!({
      accountId: "local-account",
      credential,
      file: new Blob(["approved export"], { type: "video/mp4" }),
      idempotencyKey: "publication-request-id",
      sha256: "a".repeat(64),
    }),
    { message: "Instagram auth bridge returned an unsafe media URL" },
  );
});
