import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

test("settings follow the selected data root and upgrade old home settings safely", async (t) => {
  const tempRoot = await mkdtemp(join(homedir(), ".social-harness-setting-root-test-"));
  const homeDir = join(tempRoot, "home");
  const customDir = join(tempRoot, "custom-data");
  const legacyCustomDir = join(tempRoot, "legacy-custom-data");
  await mkdir(homeDir, { recursive: true });

  const previousEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SOCIAL_HARNESS_DESKTOP_HOME_DIR: process.env.SOCIAL_HARNESS_DESKTOP_HOME_DIR,
    SOCIAL_HARNESS_DATA_BASE_DIR: process.env.SOCIAL_HARNESS_DATA_BASE_DIR,
  };
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.SOCIAL_HARNESS_DESKTOP_HOME_DIR = homeDir;
  process.env.SOCIAL_HARNESS_DATA_BASE_DIR = homeDir;

  t.after(async () => {
    const { setDataBaseDir } = await import("../src/paths.js");
    setDataBaseDir(null);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  const [{ createSettingService }, paths] = await Promise.all([
    import("../src/setting/settingService.js"),
    import("../src/paths.js"),
  ]);
  const service = createSettingService();
  const homeSettingsFile = join(homeDir, ".social-harness", "v1", "config", "setting.json");

  await service.update({ locale: "en-US" });
  let homeSettings = JSON.parse(await readFile(homeSettingsFile, "utf8"));
  assert.equal(homeSettings.locale, "en-US");
  assert.equal(paths.getDataBaseDir(), homeDir);

  const mediaFixture = join(homeDir, ".social-harness", "v1", "social-media", "original.bin");
  await mkdir(dirname(mediaFixture), { recursive: true });
  await writeFile(mediaFixture, Buffer.from("preserve managed media"));
  await service.updateDataBaseDir(customDir);

  const customSettingsFile = join(customDir, ".social-harness", "v1", "config", "setting.json");
  const customSettings = JSON.parse(await readFile(customSettingsFile, "utf8"));
  assert.equal(customSettings.locale, "en-US");
  assert.equal(customSettings.dataBaseDir, customDir);
  assert.equal(paths.getDataBaseDir(), customDir);
  assert.equal(
    await readFile(
      join(customDir, ".social-harness", "v1", "social-media", "original.bin"),
      "utf8",
    ),
    "preserve managed media",
  );
  homeSettings = JSON.parse(await readFile(homeSettingsFile, "utf8"));
  assert.deepEqual(homeSettings, { dataBaseDir: customDir });

  const pointerFile = paths.getDataBaseDirBootstrapFilePath(homeDir);
  assert.deepEqual(JSON.parse(await readFile(pointerFile, "utf8")), { dataBaseDir: customDir });
  await service.update({ locale: "zh-CN" });
  assert.equal(JSON.parse(await readFile(customSettingsFile, "utf8")).locale, "zh-CN");
  assert.deepEqual(JSON.parse(await readFile(homeSettingsFile, "utf8")), {
    dataBaseDir: customDir,
  });

  // Older builds kept the full settings document at home even when the selected data root was elsewhere.
  await rm(pointerFile, { force: true });
  await mkdir(dirname(homeSettingsFile), { recursive: true });
  await writeFile(
    homeSettingsFile,
    JSON.stringify({ locale: "en-US", dataBaseDir: legacyCustomDir }),
  );
  paths.setDataBaseDir(legacyCustomDir);
  const upgradedSettings = await createSettingService().get();
  assert.equal(upgradedSettings.locale, "en-US");
  assert.equal(upgradedSettings.dataBaseDir, legacyCustomDir);
  const upgradedSettingsFile = join(
    legacyCustomDir,
    ".social-harness",
    "v1",
    "config",
    "setting.json",
  );
  assert.equal(JSON.parse(await readFile(upgradedSettingsFile, "utf8")).locale, "en-US");
  assert.deepEqual(JSON.parse(await readFile(homeSettingsFile, "utf8")), {
    dataBaseDir: legacyCustomDir,
  });
  assert.deepEqual(JSON.parse(await readFile(pointerFile, "utf8")), {
    dataBaseDir: legacyCustomDir,
  });

  const { applyEarlyDataBaseDirBootstrap } =
    await import("../../desktop/src/main/desktopDataBaseDirBootstrap.js");
  paths.setDataBaseDir(null);
  assert.equal(applyEarlyDataBaseDirBootstrap(), legacyCustomDir);
  assert.equal(paths.getDataBaseDir(), legacyCustomDir);
});
