import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  desktopProductIdentities,
  resolveDesktopInstagramAuthBridgeUrl,
  resolveDesktopReleaseMetadata,
  resolveDesktopProductIdentity,
  resolveWindowsAppUserModelIdForFlavor,
} from "./desktop-product-identity.mjs";
import { extractDeepLinkUrlFromArgs, isOAuthCallbackUrl } from "../src/main/desktopDeepLinkUrl.ts";

const rootPackage = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
);
const desktopPackage = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
);

test("packaged Social Harness and preview identities are distinct from each other", () => {
  assert.deepEqual(
    [desktopProductIdentities.production.productName, desktopProductIdentities.preview.productName],
    ["Social Harness", "Social Harness Preview"],
  );
  assert.notEqual(
    desktopProductIdentities.production.appId,
    desktopProductIdentities.preview.appId,
  );
  assert.notEqual(
    desktopProductIdentities.production.linuxPackageName,
    desktopProductIdentities.preview.linuxPackageName,
  );
  assert.equal(
    resolveDesktopProductIdentity({ SOCIAL_HARNESS_ENV: "production" }).productName,
    "Social Harness",
  );
  assert.equal(
    resolveDesktopProductIdentity({ ZCODE_ENV: "production" }).productName,
    "Social Harness Preview",
  );
  assert.equal(
    resolveDesktopProductIdentity({
      SOCIAL_HARNESS_ENV: "production",
      ZCODE_PREVIEW_IDENTITY: "1",
    }).productName,
    "Social Harness",
  );
  assert.equal(
    resolveDesktopProductIdentity({
      SOCIAL_HARNESS_ENV: "production",
      SOCIAL_HARNESS_PREVIEW_IDENTITY: "1",
    }).productName,
    "Social Harness Preview",
  );
});

test("installer metadata uses its product identity and a configured non-ZCode maintainer contact", () => {
  const production = resolveDesktopReleaseMetadata({
    SOCIAL_HARNESS_ENV: "production",
    SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL: "releases@example.com",
    SOCIAL_HARNESS_PACKAGE_HOMEPAGE: "https://social-harness.invalid",
  });
  assert.equal(production.extraMetadata.socialHarnessProductFlavor, "production");
  assert.equal(production.extraMetadata.desktopName, "Social Harness");
  assert.equal(production.extraMetadata.homepage, "https://social-harness.invalid/");
  assert.deepEqual(production.extraMetadata.author, {
    name: "Social Harness",
    email: "releases@example.com",
  });
  assert.deepEqual(production.linux, {
    maintainer: "Social Harness Maintainers <releases@example.com>",
    vendor: "Social Harness",
    syncDesktopName: true,
  });

  const preview = resolveDesktopReleaseMetadata({
    SOCIAL_HARNESS_ENV: "production",
    SOCIAL_HARNESS_PREVIEW_IDENTITY: "1",
    SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL: "releases@example.com",
    SOCIAL_HARNESS_PACKAGE_HOMEPAGE: "https://social-harness.invalid",
  });
  assert.equal(preview.extraMetadata.desktopName, "Social Harness Preview");
  assert.equal(preview.linux.vendor, "Social Harness Preview");

  assert.throws(
    () => resolveDesktopReleaseMetadata({ SOCIAL_HARNESS_ENV: "production" }),
    /SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL/u,
  );
  assert.throws(
    () =>
      resolveDesktopReleaseMetadata({
        SOCIAL_HARNESS_ENV: "production",
        SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL: "dev@zcode.z.ai",
        SOCIAL_HARNESS_PACKAGE_HOMEPAGE: "https://social-harness.invalid",
      }),
    /non-ZCode/u,
  );
  assert.throws(
    () =>
      resolveDesktopReleaseMetadata({
        SOCIAL_HARNESS_ENV: "production",
        SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL: "releases@example.com",
      }),
    /SOCIAL_HARNESS_PACKAGE_HOMEPAGE/u,
  );
  assert.throws(
    () =>
      resolveDesktopReleaseMetadata({
        SOCIAL_HARNESS_ENV: "production",
        SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL: "releases@example.com",
        SOCIAL_HARNESS_PACKAGE_HOMEPAGE: "http://social-harness.invalid",
      }),
    /HTTPS URL/u,
  );
});

test("production Desktop requires a safe Instagram bridge origin while Preview may stay disconnected", () => {
  assert.equal(
    resolveDesktopInstagramAuthBridgeUrl(undefined, {
      productFlavor: "preview",
      isProductionBuild: true,
    }),
    "",
  );
  assert.equal(
    resolveDesktopInstagramAuthBridgeUrl(undefined, {
      productFlavor: "production",
      isProductionBuild: false,
    }),
    "",
  );
  assert.equal(
    resolveDesktopInstagramAuthBridgeUrl(" https://auth.example.com/ ", {
      productFlavor: "production",
      isProductionBuild: true,
    }),
    "https://auth.example.com",
  );
  assert.throws(
    () =>
      resolveDesktopInstagramAuthBridgeUrl(undefined, {
        productFlavor: "production",
        isProductionBuild: true,
      }),
    /SOCIAL_HARNESS_INSTAGRAM_AUTH_BRIDGE_URL must be set/u,
  );

  for (const value of [
    "http://auth.example.com",
    "https://user:password@auth.example.com",
    "https://auth.example.com/custom-path",
    "https://auth.example.com/?target=unexpected",
    "https://auth.example.com/#fragment",
    "not-a-url",
  ]) {
    assert.throws(() =>
      resolveDesktopInstagramAuthBridgeUrl(value, {
        productFlavor: "production",
        isProductionBuild: true,
      }),
    );
    assert.throws(() =>
      resolveDesktopInstagramAuthBridgeUrl(value, {
        productFlavor: "preview",
        isProductionBuild: false,
      }),
    );
  }
  assert.throws(
    () => resolveDesktopInstagramAuthBridgeUrl(undefined, { productFlavor: "unknown" }),
    /Unsupported desktop product flavor/u,
  );
});

test("Windows and deep-link identities use Social Harness values", () => {
  assert.equal(
    resolveWindowsAppUserModelIdForFlavor("production").startsWith("dev.socialharness."),
    true,
  );
  assert.equal(
    resolveWindowsAppUserModelIdForFlavor("production", { isPackaged: false }),
    "dev.socialharness.app.local",
  );
  assert.equal(
    extractDeepLinkUrlFromArgs(["social-harness://oauth/callback?state=one-time"]),
    "social-harness://oauth/callback?state=one-time",
  );
  assert.equal(isOAuthCallbackUrl(new URL("social-harness://oauth/callback?state=one-time")), true);
  assert.equal(extractDeepLinkUrlFromArgs(["zcode://oauth/callback?state=legacy"]), null);
});

test("Electron development metadata uses the root product's valid release version", () => {
  assert.match(rootPackage.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  assert.equal(desktopPackage.version, rootPackage.version);
});
