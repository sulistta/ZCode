import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectRuntimeModuleClosureEntries } from "./runtime-dependency-closure.mjs";
test("binary-only optional dependency resolves its parent's exact version instead of hoisted version", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-closure-test-"));
  try {
    for (const [path, json] of [
      [
        "node_modules/parent",
        {
          name: "parent",
          version: "1.0.0",
          main: "index.js",
          optionalDependencies: { "@binary/tool": "1.0.0" },
        },
      ],
      ["node_modules/parent/node_modules/@binary/tool", { name: "@binary/tool", version: "1.0.0" }],
      ["node_modules/@binary/tool", { name: "@binary/tool", version: "2.0.0" }],
    ]) {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, "package.json"), JSON.stringify(json));
    }
    await writeFile(join(root, "node_modules/parent/index.js"), "module.exports={}");
    const entries = collectRuntimeModuleClosureEntries(["parent"], [root]);
    assert.equal(
      entries.find((e) => e.moduleName === "@binary/tool").sourceModulePath,
      join(root, "node_modules/parent/node_modules/@binary/tool"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
