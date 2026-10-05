import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramTokenRefresher } from "../src/social-publishing/adapters/instagramTokenRefresher.js";

test("Instagram token refresh uses the fixed HTTPS endpoint and returns expiry metadata", async () => {
  let requestUrl: URL | null = null;
  let requestInit: RequestInit | undefined;
  const refresher = createInstagramTokenRefresher({
    now: () => 1_000,
    fetcher: async (input, init) => {
      requestUrl = new URL(String(input));
      requestInit = init;
      return new Response(
        JSON.stringify({ access_token: "renewed-token", expires_in: 5_184_000 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const tokens = await refresher.refresh("existing-token");

  assert.equal(requestUrl?.origin, "https://graph.instagram.com");
  assert.equal(requestUrl?.pathname, "/refresh_access_token");
  assert.equal(requestUrl?.searchParams.get("grant_type"), "ig_refresh_token");
  assert.equal(requestUrl?.searchParams.get("access_token"), "existing-token");
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.redirect, "error");
  assert.deepEqual(tokens, { accessToken: "renewed-token", expiresAt: 5_184_001_000 });
});

test("Instagram token refresh hides Meta error response bodies", async () => {
  const refresher = createInstagramTokenRefresher({
    fetcher: async () => new Response("private-token secret response", { status: 401 }),
  });

  await assert.rejects(refresher.refresh("private-token"), {
    message: "Instagram token refresh was rejected",
  });
});
