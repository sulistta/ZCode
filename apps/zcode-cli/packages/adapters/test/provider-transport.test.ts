import assert from "node:assert/strict";
import test from "node:test";
import { createProviderTransportFetch } from "../src/model/provider-transport.js";

function createRecordingFetch(urls: string[]): typeof fetch {
  return async (input) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return new Response(null, { status: 200 });
  };
}

test("personal API-key providers keep their configured endpoint with a Social Harness origin", async () => {
  const requestedUrls: string[] = [];
  const transport = createProviderTransportFetch({
    accessType: "api-key",
    env: { SOCIAL_HARNESS_BASE_URL: "https://social.example.test" },
    fetch: createRecordingFetch(requestedUrls),
  });

  await transport("https://open.bigmodel.cn/api/anthropic/v1/messages");
  await transport("https://api.z.ai/api/anthropic/v1/messages");

  assert.deepEqual(requestedUrls, [
    "https://open.bigmodel.cn/api/anthropic/v1/messages",
    "https://api.z.ai/api/anthropic/v1/messages",
  ]);
});

test("account-entitlement requests fail locally until an explicit gateway route is available", async () => {
  const requestedUrls: string[] = [];
  const fetch = createRecordingFetch(requestedUrls);
  const sourceUrl = "https://open.bigmodel.cn/api/anthropic/v1/messages";
  const unconfiguredTransport = createProviderTransportFetch({
    accessType: "zhipu-account",
    env: {},
    fetch,
  });
  const configuredTransport = createProviderTransportFetch({
    accessType: "zhipu-account",
    env: { SOCIAL_HARNESS_BASE_URL: "https://social.example.test" },
    fetch,
  });

  await assert.rejects(unconfiguredTransport(sourceUrl), /Coding Plan gateway/u);
  await configuredTransport(sourceUrl);

  await assert.rejects(
    configuredTransport("https://open.bigmodel.cn/api/anthropic/v1/unmapped"),
    /Coding Plan gateway/u,
  );
  assert.deepEqual(requestedUrls, [
    "https://social.example.test/api/v1/ultra/anthropic/v1/messages",
  ]);
});
