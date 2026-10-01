import assert from "node:assert/strict";
import test from "node:test";
import { resolveDesktopE2ERemoteDebuggingConfig } from "./desktopE2ERemoteDebugging.js";

test("development keeps its existing default and launcher-owned CDP ports", () => {
  assert.deepEqual(
    resolveDesktopE2ERemoteDebuggingConfig({
      isPackaged: false,
      productFlavor: "preview",
      env: {},
    }),
    { port: 9229, appendSwitch: true },
  );
  assert.deepEqual(
    resolveDesktopE2ERemoteDebuggingConfig({
      isPackaged: false,
      productFlavor: "production",
      env: { SOCIAL_HARNESS_E2E_CDP_PORT: "41234" },
    }),
    { port: 41234, appendSwitch: false },
  );
});

test("only an explicitly opted-in packaged Preview accepts a valid E2E CDP port", () => {
  assert.deepEqual(
    resolveDesktopE2ERemoteDebuggingConfig({
      isPackaged: true,
      productFlavor: "preview",
      env: {
        SOCIAL_HARNESS_E2E_PACKAGED_PREVIEW: "1",
        SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
      },
    }),
    { port: 41234, appendSwitch: true },
  );
  assert.equal(
    resolveDesktopE2ERemoteDebuggingConfig({
      isPackaged: true,
      productFlavor: "preview",
      env: { SOCIAL_HARNESS_E2E_CDP_PORT: "41234" },
    }),
    null,
  );
  assert.equal(
    resolveDesktopE2ERemoteDebuggingConfig({
      isPackaged: true,
      productFlavor: "production",
      env: {
        SOCIAL_HARNESS_E2E_PACKAGED_PREVIEW: "1",
        SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
      },
    }),
    null,
  );
  assert.equal(
    resolveDesktopE2ERemoteDebuggingConfig({
      isPackaged: true,
      productFlavor: "preview",
      env: {
        SOCIAL_HARNESS_E2E_PACKAGED_PREVIEW: "1",
        SOCIAL_HARNESS_E2E_CDP_PORT: "",
      },
    }),
    null,
  );
});

test("enabled E2E CDP rejects invalid ports", () => {
  assert.throws(
    () =>
      resolveDesktopE2ERemoteDebuggingConfig({
        isPackaged: true,
        productFlavor: "preview",
        env: {
          SOCIAL_HARNESS_E2E_PACKAGED_PREVIEW: "1",
          SOCIAL_HARNESS_E2E_CDP_PORT: "70000",
        },
      }),
    /must be an integer from 1 to 65535/u,
  );
});
