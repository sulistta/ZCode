import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatZCodeMainProcessName,
  formatZCodeRendererProcessName,
} from "../packages/shared/src/process-names.ts";

const resourceManagerBrandKeys = [
  "resourceManager.appUsage",
  "resourceManager.storage.summaryTotal",
  "resourceManager.storage.diskUsage",
];

test("the active resource manager uses the Social Harness identity in every locale and window title", async () => {
  const [windowHtml, windowSource] = await Promise.all([
    readFile(
      new URL("../packages/desktop/src/renderer/resource-manager.html", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../packages/desktop/src/main/resourceManagerWindow.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(windowHtml, /<title>Social Harness Resource Manager<\/title>/u);
  assert.match(windowSource, /RESOURCE_MANAGER_WINDOW_TITLE = "Social Harness Resource Manager"/u);

  for (const locale of ["en-US", "zh-CN"]) {
    const source = await readFile(
      new URL(`../packages/ui/src/i18n/locales/${locale}.ts`, import.meta.url),
      "utf8",
    );

    for (const key of resourceManagerBrandKeys) {
      const escapedKey = key.replaceAll(".", String.raw`\.`);
      const match = source.match(new RegExp(`"${escapedKey}":\\s*"([^"]*)"`, "u"));
      assert.ok(match, `${locale} defines ${key}`);
      assert.match(match[1], /Social Harness/u, `${locale} ${key} uses the current brand`);
      assert.doesNotMatch(match[1], /ZCode/u, `${locale} ${key} does not show the retired brand`);
    }
  }
});

test("resource manager and renderer process names use the Social Harness prefix", () => {
  assert.equal(formatZCodeMainProcessName(), "social-harness-main");
  assert.equal(formatZCodeRendererProcessName(), "social-harness-renderer-main");
  assert.equal(formatZCodeRendererProcessName("Social Harness"), "social-harness-renderer-main");
  assert.equal(formatZCodeRendererProcessName("ZCode"), "social-harness-renderer-main");
  assert.equal(
    formatZCodeRendererProcessName("Social Harness Resource Manager"),
    "social-harness-renderer-resource-manager",
  );
  assert.equal(
    formatZCodeRendererProcessName("Resource Manager"),
    "social-harness-renderer-resource-manager",
  );
  assert.equal(
    formatZCodeRendererProcessName("Social Harness - Remote"),
    "social-harness-renderer-remote-remote",
  );
});
