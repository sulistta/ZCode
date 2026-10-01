import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramMediaReader } from "../src/social-publishing/adapters/instagramMediaReader.js";

test("Instagram media reader requests a bounded own-media page with a bearer token", async () => {
  let requestedUrl: URL | undefined;
  let requestedHeaders: Headers | undefined;
  const reader = createInstagramMediaReader({
    fetcher: async (input, init) => {
      requestedUrl = new URL(String(input));
      requestedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "media-1",
              media_type: "VIDEO",
              caption: "A recent Reel",
              permalink: "https://www.instagram.com/reel/example/",
              timestamp: "2026-09-28T12:00:00Z",
            },
            {
              id: "media-2",
              media_type: "IMAGE",
              caption: "Unsafe permalink is omitted",
              permalink: "https://example.com/redirect",
              timestamp: "2026-09-27T12:00:00Z",
            },
            { id: "malformed", media_type: "VIDEO", permalink: "javascript:alert(1)" },
          ],
          paging: { next: "https://attacker.example/next" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const media = await reader.list({
    instagramUserId: "ig-user-42",
    accessToken: "secret-token",
    limit: 2,
  });

  assert.equal(requestedUrl?.origin, "https://graph.instagram.com");
  assert.equal(requestedUrl?.pathname, "/v26.0/ig-user-42/media");
  assert.equal(requestedUrl?.searchParams.get("limit"), "2");
  assert.equal(requestedUrl?.searchParams.get("access_token"), null);
  assert.equal(requestedHeaders?.get("authorization"), "Bearer secret-token");
  assert.deepEqual(media, [
    {
      mediaId: "media-1",
      mediaType: "VIDEO",
      caption: "A recent Reel",
      permalink: "https://www.instagram.com/reel/example/",
      timestamp: "2026-09-28T12:00:00Z",
    },
    {
      mediaId: "media-2",
      mediaType: "IMAGE",
      caption: "Unsafe permalink is omitted",
      permalink: null,
      timestamp: "2026-09-27T12:00:00Z",
    },
  ]);
});

test("Instagram media reader fails with a sanitized error and does not follow redirects", async () => {
  let redirectMode = "";
  const reader = createInstagramMediaReader({
    fetcher: async (_input, init) => {
      redirectMode = String(init?.redirect);
      return new Response("private API error body", { status: 403 });
    },
  });

  await assert.rejects(
    reader.list({ instagramUserId: "ig-user-42", accessToken: "secret-token", limit: 5 }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Instagram media could not be loaded" &&
      !error.message.includes("private API error body"),
  );
  assert.equal(redirectMode, "error");
});
