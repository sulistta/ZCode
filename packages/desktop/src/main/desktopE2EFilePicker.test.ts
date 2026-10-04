import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDesktopE2EFilePicker } from "./desktopE2EFilePicker.js";

const fixturePath = join(tmpdir(), "Social Harness picker fixture.png");

test("native file picker fixtures require an explicit unbundled CDP test session", () => {
  assert.equal(
    createDesktopE2EFilePicker({
      isPackaged: false,
      env: {
        SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES: "invalid JSON is ignored without CDP",
      },
    }),
    null,
  );
  assert.equal(
    createDesktopE2EFilePicker({
      isPackaged: true,
      env: {
        SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
        SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES: "invalid JSON is ignored in packages",
      },
    }),
    null,
  );
});

test("native file picker fixtures return cancellation and selected paths in order", () => {
  const picker = createDesktopE2EFilePicker({
    isPackaged: false,
    env: {
      SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
      SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES: JSON.stringify([[], [fixturePath]]),
    },
  });

  assert.deepEqual(picker?.selectFiles(), []);
  assert.deepEqual(picker?.selectFiles(), [fixturePath]);
  assert.deepEqual(picker?.selectFiles(), [], "an exhausted fixture queue remains cancelled");
});

test("native file picker fixtures reject malformed and relative selections", () => {
  assert.throws(
    () =>
      createDesktopE2EFilePicker({
        isPackaged: false,
        env: {
          SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
          SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES: "{",
        },
      }),
    /must be valid JSON/u,
  );
  assert.throws(
    () =>
      createDesktopE2EFilePicker({
        isPackaged: false,
        env: {
          SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
          SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES: JSON.stringify([["relative/file.png"]]),
        },
      }),
    /absolute file paths/u,
  );
});
