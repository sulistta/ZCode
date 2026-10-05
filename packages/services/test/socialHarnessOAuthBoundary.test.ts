import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthRuntimeConfig } from "../src/oauth/runtimeConfig.js";
import { buildDesktopOAuthRedirectUriFromEnv } from "../src/oauth/providers/configUtils.js";

test("Social Harness does not construct the retired Z.ai or BigModel OAuth adapters", () => {
  assert.deepEqual(createOAuthRuntimeConfig({}).providers, []);
  assert.deepEqual(
    createOAuthRuntimeConfig({ SOCIAL_HARNESS_BASE_URL: "https://social.example.test" }).providers,
    [],
  );
});

test("Social Harness never generates a retired desktop OAuth redirect", () => {
  assert.equal(buildDesktopOAuthRedirectUriFromEnv({}), "");
  assert.equal(
    buildDesktopOAuthRedirectUriFromEnv({ SOCIAL_HARNESS_BASE_URL: "https://zcode.z.ai" }),
    "",
  );
  assert.equal(
    buildDesktopOAuthRedirectUriFromEnv({
      SOCIAL_HARNESS_BASE_URL: "https://social.example.test",
    }),
    "",
  );
});
