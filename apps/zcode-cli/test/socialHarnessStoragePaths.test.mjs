import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { parseEnvConfig } from "../packages/adapters/src/config/env-config.adapter.ts";

test("Social Harness data base owns headless Agent storage paths", () => {
  const dataBaseDir = "/tmp/social-harness-data";
  const socialRoot = join(dataBaseDir, ".social-harness", "v1");

  assert.deepEqual(
    parseEnvConfig({
      SOCIAL_HARNESS_DATA_BASE_DIR: dataBaseDir,
      ZCODE_STORAGE_DIR: "/tmp/legacy-zcode",
      ZCODE_SESSION_DB_PATH: "/tmp/legacy-zcode/session.sqlite",
    }).storage,
    {
      dir: socialRoot,
      sessionDbPath: join(socialRoot, "cli", "db", "db.sqlite"),
    },
  );
});
