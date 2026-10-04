import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveStartupWindowBootstrap } from "./startupWorkspace.js";

test("startup creates only the internal runtime directory, without restoring or warming projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-harness-startup-"));
  const runtimeWorkspaceDir = join(root, "nested", "runtime");
  try {
    assert.deepEqual(await resolveStartupWindowBootstrap(runtimeWorkspaceDir), {});
    assert.equal((await stat(runtimeWorkspaceDir)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
