import assert from "node:assert/strict";
import test from "node:test";
import { isSocialModelProviderConfig } from "../src/social-accounts/socialModelSettingsModel.js";

test("Social Harness model setup accepts direct API-key providers only", () => {
  assert.equal(
    isSocialModelProviderConfig({ group: "standard-personal", access: { type: "api-key" } }),
    true,
  );
  assert.equal(isSocialModelProviderConfig({ access: { type: "api-key" } }), true);
  assert.equal(
    isSocialModelProviderConfig({
      group: "standard-personal",
      access: { type: "zhipu-coding-plan-api-key" },
    }),
    false,
  );
  assert.equal(
    isSocialModelProviderConfig({ group: "zai-family", access: { type: "api-key" } }),
    false,
  );
  assert.equal(
    isSocialModelProviderConfig({ group: "standard-personal", access: { type: "zhipu-account" } }),
    false,
  );
});
