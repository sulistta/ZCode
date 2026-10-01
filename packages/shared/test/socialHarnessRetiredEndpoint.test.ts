import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";
import { DesktopCommandIds } from "../src/platform.js";
import { resolveHelpAppConfig } from "../src/helpAppConfig.js";
import {
  buildRuntimeZCodeApiUrl,
  buildRuntimeZCodeEndpointUrls,
  isRetiredZCodeEndpointUrl,
  resolveRuntimeZCodeEndpointOrigin,
  rewriteZCodeEndpointUrl,
} from "../src/zcodeEndpoint.js";

test("retired endpoint overrides are discarded from persisted settings and patches", () => {
  const oldSettings = appSettingsSchema.parse({
    zcodeEndpointOrigin: "https://old.example.invalid",
  });
  const oldPatch = appSettingsPatchSchema.parse({
    zcodeEndpointOrigin: "https://old.example.invalid",
  });

  assert.equal("zcodeEndpointOrigin" in oldSettings, false);
  assert.deepEqual(oldPatch, {});
});

test("retired ZCode endpoint commands are absent from the Desktop protocol", () => {
  assert.equal("SetZCodeEndpointProduction" in DesktopCommandIds, false);
  assert.equal("SetZCodeEndpointTest" in DesktopCommandIds, false);
  assert.equal("SetZCodeEndpointCustom" in DesktopCommandIds, false);
  assert.equal("ResetZCodeEndpoint" in DesktopCommandIds, false);
  assert.equal("OpenChangelog" in DesktopCommandIds, false);
});

test("first-party API origin has no default and legacy ZCode origins fail closed", () => {
  assert.equal(resolveRuntimeZCodeEndpointOrigin({}), "");
  assert.equal(buildRuntimeZCodeApiUrl({}, "/api/v1/client/scenes"), "");
  assert.equal(buildRuntimeZCodeEndpointUrls({}).origin, "");
  assert.equal(
    resolveRuntimeZCodeEndpointOrigin({ SOCIAL_HARNESS_BASE_URL: "https://zcode.z.ai" }),
    "",
  );
  assert.equal(
    resolveRuntimeZCodeEndpointOrigin({ SOCIAL_HARNESS_ENDPOINT_ORIGIN: "https://api.zcode.z.ai" }),
    "",
  );
  assert.equal(
    resolveRuntimeZCodeEndpointOrigin({ SOCIAL_HARNESS_BASE_URL: "https://social.example.test" }),
    "https://social.example.test",
  );
  assert.equal(isRetiredZCodeEndpointUrl("https://zcode.z.ai/api/v1/test"), true);
  assert.equal(isRetiredZCodeEndpointUrl("https://api.zcode.z.ai/api/v1/test"), true);
  assert.equal(isRetiredZCodeEndpointUrl("https://zcode.z.ai.example.test/api/v1/test"), false);
  assert.equal(
    rewriteZCodeEndpointUrl("https://zcode.z.ai/api/v1/test", "https://social.example.test"),
    "https://social.example.test/api/v1/test",
  );
});

test("bundled help configuration has no legacy company support destinations", async () => {
  const raw = await readFile(new URL("../../../config/default.json", import.meta.url), "utf8");
  const config = resolveHelpAppConfig(null, JSON.parse(raw));

  assert.equal(config.feedback_use_external_form, false);
  assert.equal(config.feedback_url, undefined);
  assert.deepEqual(config.community_urls, {
    "zh-CN": undefined,
    "en-US": undefined,
  });
});
