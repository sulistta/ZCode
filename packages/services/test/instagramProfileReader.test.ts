import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramProfileReader } from "../src/social-publishing/adapters/instagramProfileReader.js";

test("Instagram profile reader uses the pinned Graph API version and bearer token", async () => {
  let requestedUrl: URL | undefined;
  let requestedHeaders: Headers | undefined;
  const reader = createInstagramProfileReader({
    fetcher: async (input, init) => {
      requestedUrl = new URL(String(input));
      requestedHeaders = new Headers(init?.headers);
      return Response.json({ id: "ig-user-42", username: "channel" });
    },
  });

  assert.deepEqual(await reader("secret-token"), {
    instagramUserId: "ig-user-42",
    username: "channel",
    profilePictureUrl: null,
  });
  assert.equal(requestedUrl?.origin, "https://graph.instagram.com");
  assert.equal(requestedUrl?.pathname, "/v26.0/me");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer secret-token");
  assert.equal(requestedUrl?.searchParams.get("access_token"), null);
});
