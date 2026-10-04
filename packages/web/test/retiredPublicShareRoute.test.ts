import assert from "node:assert/strict";
import test from "node:test";
import { isRetiredPublicSharePath } from "../src/retiredPublicShareRoute.js";

test("recognizes legacy English and Chinese share routes, including OAuth callbacks", () => {
  for (const pathname of [
    "/share",
    "/share/",
    "/share/abc123",
    "/share/callback",
    "/cn/share",
    "/cn/share/abc123",
    "/cn/share/callback",
  ]) {
    assert.equal(isRetiredPublicSharePath(pathname), true, pathname);
  }
});

test("does not treat other Web paths as retired share routes", () => {
  for (const pathname of ["/", "/conversations", "/sharing/abc123", "/cn/shareable"]) {
    assert.equal(isRetiredPublicSharePath(pathname), false, pathname);
  }
});
