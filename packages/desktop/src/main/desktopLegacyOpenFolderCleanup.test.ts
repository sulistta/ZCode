import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupLegacyOpenFolderActions } from "./desktopLegacyOpenFolderCleanup.js";

const logger = { info() {}, warn() {} };

test("macOS cleanup removes only the owned legacy Finder workflow", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "social-harness-finder-cleanup-"));
  const servicesDir = join(homeDir, "Library", "Services");
  const workflowDir = join(servicesDir, "Open in ZCode.workflow");
  const unrelatedWorkflow = join(servicesDir, "My Custom Workflow.workflow");
  const infoPlistPath = join(workflowDir, "Contents", "Info.plist");
  let servicesIndexRefreshed = false;

  try {
    await mkdir(join(workflowDir, "Contents"), { recursive: true });
    await writeFile(
      infoPlistPath,
      "<key>CFBundleIdentifier</key><string>dev.zcode.app.finder-open-workflow</string>",
    );
    await mkdir(unrelatedWorkflow, { recursive: true });
    await writeFile(join(unrelatedWorkflow, "sentinel"), "preserve");

    await cleanupLegacyOpenFolderActions({
      platform: "darwin",
      homeDir,
      logger,
      refreshServicesIndex: () => {
        servicesIndexRefreshed = true;
      },
    });

    await assert.rejects(readFile(infoPlistPath));
    assert.equal(await readFile(join(unrelatedWorkflow, "sentinel"), "utf8"), "preserve");
    assert.equal(servicesIndexRefreshed, true);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("macOS cleanup preserves a same-named user workflow without the legacy bundle id", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "social-harness-finder-custom-"));
  const workflowDir = join(homeDir, "Library", "Services", "Open in ZCode.workflow");
  const infoPlistPath = join(workflowDir, "Contents", "Info.plist");

  try {
    await mkdir(join(workflowDir, "Contents"), { recursive: true });
    await writeFile(infoPlistPath, "<key>CFBundleIdentifier</key><string>user.custom</string>");

    await cleanupLegacyOpenFolderActions({ platform: "darwin", homeDir, logger });

    assert.match(await readFile(infoPlistPath, "utf8"), /user\.custom/u);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("Windows cleanup deletes only known keys carrying the legacy command marker", async () => {
  const registryCalls: string[][] = [];
  const runner = async (args: readonly string[]) => {
    registryCalls.push([...args]);
    if (args[0] === "query") {
      return args[1]?.endsWith("\\command")
        ? { exitCode: 0, stdout: 'REG_SZ    "Social Harness.exe" --open-workspace "%1"' }
        : { exitCode: 1, stdout: "" };
    }
    return { exitCode: 0, stdout: "" };
  };

  await cleanupLegacyOpenFolderActions({
    platform: "win32",
    logger,
    registryRunner: runner,
  });

  assert.deepEqual(
    registryCalls.filter((args) => args[0] === "delete"),
    [
      ["delete", "HKCU\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode", "/f"],
      ["delete", "HKCU\\Software\\Classes\\Drive\\shell\\ZCode.OpenInZCode", "/f"],
    ],
  );
});

test("Windows cleanup preserves customized commands without the legacy marker", async () => {
  const registryCalls: string[][] = [];
  const runner = async (args: readonly string[]) => {
    registryCalls.push([...args]);
    return args[0] === "query"
      ? { exitCode: 0, stdout: 'REG_SZ    "custom-handler.exe" "%1"' }
      : { exitCode: 0, stdout: "" };
  };

  await cleanupLegacyOpenFolderActions({ platform: "win32", logger, registryRunner: runner });

  assert.equal(
    registryCalls.some((args) => args[0] === "delete"),
    false,
  );
});
