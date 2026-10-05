import assert from "node:assert/strict";
import test from "node:test";
import { WEBFETCH_USER_AGENT } from "../../../src/tool/handlers/webfetch-constants.js";

test("headless Agent WebFetch identifies as Social Harness", () => {
  assert.equal(WEBFETCH_USER_AGENT, "Social-Harness-WebFetch/0.1");
  assert.doesNotMatch(WEBFETCH_USER_AGENT, /zcode|coding-agent-cli/iu);
});
