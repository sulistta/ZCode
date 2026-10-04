import assert from "node:assert/strict";
import test from "node:test";
import { resolveRootSurface } from "../src/root/rootSurface.js";

test("Social Harness root exposes only Social Harness surfaces", () => {
  assert.equal(resolveRootSurface({ hasSocialAccountService: true }), "social");
  assert.equal(resolveRootSurface({ hasSocialAccountService: false }), "unavailable");
});
