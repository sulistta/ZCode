import assert from "node:assert/strict";
import test from "node:test";
import { resolveStartupPlugins } from "../src/app/startup-marks.js";

test("social account startup skips generic plugin discovery and seeding", () => {
  const marks: Array<{ event: string; stage: string }> = [];
  const outcome = resolveStartupPlugins({
    cliStorageRoot: "/unused",
    // The account-scoped branch must return before inspecting generic plugin config.
    configResult: {} as never,
    options: {},
    socialAccountRuntime: true,
    startupTimer: {
      mark: (_label, input) => marks.push({ event: input.event, stage: input.stage }),
    } as never,
    workingDirectory: "/unused",
  });

  assert.deepEqual(outcome, {
    commandRoots: [],
    diagnostics: [],
    hooks: {},
    mcpServers: {},
    plugins: [],
    skillRoots: [],
  });
  assert.deepEqual(marks, [
    {
      event: "bootstrap.app.startup.plugins.skipped",
      stage: "resolve_plugins",
    },
  ]);
});
