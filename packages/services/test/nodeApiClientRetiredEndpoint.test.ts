import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@social-harness/shared";
import { NodeApiClient } from "../src/providers/api/nodeApiClient.js";

test("NodeApiClient refuses retired and relative API URLs before fetch", async () => {
  const fetchedUrls: string[] = [];
  const client = new NodeApiClient({
    resolveZCodeEndpointOrigin: () => "",
    fetchImpl: async (input) => {
      fetchedUrls.push(String(input));
      return new Response(null, { status: 200 });
    },
  });

  await assert.rejects(
    client.request("https://zcode.z.ai/api/v1/client/scenes"),
    (error: unknown) => error instanceof ApiError && /retired ZCode API/u.test(error.message),
  );
  await assert.rejects(
    client.request("/api/v1/client/scenes"),
    (error: unknown) => error instanceof ApiError && /absolute HTTP\(S\) URL/u.test(error.message),
  );
  assert.deepEqual(fetchedUrls, []);
});

test("NodeApiClient rewrites explicit first-party endpoints and preserves provider URLs", async () => {
  const fetchedUrls: string[] = [];
  const client = new NodeApiClient({
    resolveZCodeEndpointOrigin: () => "https://social.example.test",
    fetchImpl: async (input) => {
      fetchedUrls.push(String(input));
      return new Response(null, { status: 200 });
    },
  });

  await client.request("https://zcode.z.ai/api/v1/client/scenes");
  await client.request("https://api.openai.com/v1/models");
  assert.deepEqual(fetchedUrls, [
    "https://social.example.test/api/v1/client/scenes",
    "https://api.openai.com/v1/models",
  ]);
});
