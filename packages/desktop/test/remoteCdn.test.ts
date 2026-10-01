import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRemoteCdnBaseUrls } from "../src/main/remoteCdn.js";

function withCdnBaseUrl<T>(value: string | undefined, run: () => T): T {
  const previousValue = process.env.SOCIAL_HARNESS_CDN_BASE_URL;
  if (value === undefined) {
    delete process.env.SOCIAL_HARNESS_CDN_BASE_URL;
  } else {
    process.env.SOCIAL_HARNESS_CDN_BASE_URL = value;
  }

  try {
    return run();
  } finally {
    if (previousValue === undefined) {
      delete process.env.SOCIAL_HARNESS_CDN_BASE_URL;
    } else {
      process.env.SOCIAL_HARNESS_CDN_BASE_URL = previousValue;
    }
  }
}

test("remote runtime downloads stay disabled without an explicit Social Harness CDN", () => {
  withCdnBaseUrl(undefined, () => {
    assert.deepEqual(resolveRemoteCdnBaseUrls(), []);
  });
});

test("configured remote releases use the Social Harness path", () => {
  withCdnBaseUrl("https://assets.example.test", () => {
    assert.deepEqual(resolveRemoteCdnBaseUrls({ version: "1.2.3" }), [
      "https://assets.example.test/social-harness/electron/releases/1.2.3",
    ]);
  });
});
