import assert from "node:assert/strict";
import test from "node:test";
import { createMetaInstagramOAuthClient } from "../src/adapters/metaInstagramOAuthClient.js";

test("Meta code exchange and long-lived token upgrade stay on fixed HTTPS endpoints", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = createMetaInstagramOAuthClient({
    appId: "app-id",
    appSecret: "server-only-secret",
    now: () => 10_000,
    fetcher: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({ url, init });
      return requests.length === 1
        ? new Response(JSON.stringify({ access_token: "short-lived" }), { status: 200 })
        : new Response(JSON.stringify({ access_token: "long-lived", expires_in: 5_184_000 }), {
            status: 200,
          });
    },
  });

  const tokens = await client.exchangeAuthorizationCode(
    "temporary-code",
    "https://auth.example.test/v1/instagram/callback",
  );

  assert.deepEqual(tokens, { accessToken: "long-lived", expiresAt: 5_184_010_000 });
  assert.equal(requests[0]?.url, "https://api.instagram.com/oauth/access_token");
  const authorizationRequest = requests[0];
  assert.ok(authorizationRequest);
  assert.equal(authorizationRequest.init?.method, "POST");
  assert.ok(authorizationRequest.init?.body instanceof URLSearchParams);
  assert.equal(authorizationRequest.init.body.get("client_secret"), "server-only-secret");
  const upgradeUrl = new URL(requests[1]!.url);
  assert.equal(upgradeUrl.origin, "https://graph.instagram.com");
  assert.equal(upgradeUrl.pathname, "/access_token");
  assert.equal(upgradeUrl.searchParams.get("grant_type"), "ig_exchange_token");
  assert.equal(upgradeUrl.searchParams.get("access_token"), "short-lived");
  assert.equal(upgradeUrl.searchParams.get("client_secret"), "server-only-secret");
});

test("Meta errors are not surfaced with response bodies that may contain secrets", async () => {
  const client = createMetaInstagramOAuthClient({
    appId: "app-id",
    appSecret: "server-only-secret",
    fetcher: async () => new Response("server-only-secret", { status: 500 }),
  });

  await assert.rejects(client.exchangeAuthorizationCode("code", "https://auth.example.test/cb"), {
    message: "Instagram authorization code exchange failed",
  });
});
