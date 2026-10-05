import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { resolveStorageRoots } from "../src/storage/adapters/rootsResolver.js";

test("storage scanning uses the Social Harness v1 root under the home directory", () => {
  assert.deepEqual(resolveStorageRoots({ homeDir: "/users/vitor", dataBaseDir: "/users/vitor" }), [
    {
      id: "home",
      path: join("/users/vitor", ".social-harness", "v1"),
      hasCustomDataBaseDir: false,
    },
  ]);
});

test("custom storage scanning excludes the preserved legacy ZCode directory", () => {
  const roots = resolveStorageRoots({
    homeDir: "/users/vitor",
    dataBaseDir: "/mnt/social-data",
  });

  assert.deepEqual(
    roots.map(({ id, path }) => ({ id, path })),
    [
      { id: "home", path: join("/users/vitor", ".social-harness", "v1") },
      { id: "dataBaseDir", path: join("/mnt/social-data", ".social-harness", "v1") },
    ],
  );
  assert.ok(roots.every((root) => !root.path.includes(".zcode")));
});
