import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeepLinkSingleInstanceData,
  extractDeepLinkUrlFromArgs,
  isSupportedSocialHarnessDeepLinkUrl,
} from "./desktopDeepLinkUrl.js";

test("Social Harness accepts Instagram OAuth deep links only", () => {
  assert.equal(
    isSupportedSocialHarnessDeepLinkUrl(
      new URL("social-harness://oauth/callback?state=account-connect&code=one-time-ticket"),
    ),
    true,
  );
  assert.equal(
    isSupportedSocialHarnessDeepLinkUrl(
      new URL("social-harness://workspace/open?path=%2Ftmp%2Fproject"),
    ),
    false,
  );
});

test("retired payment and share-import deep links are rejected", () => {
  assert.equal(
    isSupportedSocialHarnessDeepLinkUrl(
      new URL("social-harness://payment/callback?state=old-product&code=payment"),
    ),
    false,
  );
  assert.equal(
    isSupportedSocialHarnessDeepLinkUrl(
      new URL("social-harness://share/import?code=old-product-share"),
    ),
    false,
  );
});

test("legacy --open-workspace arguments are not forwarded to a second instance", () => {
  assert.deepEqual(
    createDeepLinkSingleInstanceData(["Social Harness.exe", "--open-workspace", "/tmp/project"]),
    {},
  );
  assert.equal(
    extractDeepLinkUrlFromArgs(["social-harness://workspace/open?path=%2Ftmp%2Fproject"]),
    null,
  );
});
