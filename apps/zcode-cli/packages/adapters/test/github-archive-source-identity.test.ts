import assert from "node:assert/strict";
import test from "node:test";
import { GITHUB_ARCHIVE_USER_AGENT } from "../src/plugins/github-archive-source.js";

test("GitHub plugin archive requests identify as Social Harness", () => {
  assert.equal(GITHUB_ARCHIVE_USER_AGENT, "Social-Harness-Plugin-Installer");
  assert.doesNotMatch(GITHUB_ARCHIVE_USER_AGENT, /zcode|coding-agent-cli/iu);
});
