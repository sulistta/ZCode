import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeAiSdkModelExecutionConfig } from "../src/model-config.js";

test("headless model requests use Social Harness identity and no default referer", () => {
  const config = createRuntimeAiSdkModelExecutionConfig({
    SOCIAL_HARNESS_APP_VERSION: "3.14.0",
    ZCODE_DYNAMIC_WORKFLOW_MODE: "alwaysOn",
  }, { sourceTitle: "electron" });

  assert.equal(config.defaultHeaders["User-Agent"], "Social Harness/3.14.0");
  assert.equal(config.defaultHeaders["X-Title"], "Social Harness@electron");
  assert.equal(config.defaultHeaders["X-Social-Harness-App-Version"], "3.14.0");
  assert.equal(config.defaultHeaders["HTTP-Referer"], undefined);
  assert.equal(config.defaultHeaders["X-ZCode-Agent"], undefined);
});

test("headless model requests use only a valid explicitly configured referer origin", () => {
  const config = createRuntimeAiSdkModelExecutionConfig({
    SOCIAL_HARNESS_PROVIDER_REFERER: "https://models.social.example/path?source=test",
  });
  const invalidConfig = createRuntimeAiSdkModelExecutionConfig({
    SOCIAL_HARNESS_PROVIDER_REFERER: "javascript:alert(1)",
  });

  assert.equal(config.defaultHeaders["HTTP-Referer"], "https://models.social.example");
  assert.equal(invalidConfig.defaultHeaders["HTTP-Referer"], undefined);
});
