import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopE2ESaveDialog } from "./desktopE2ESaveDialog.js";

test("save-dialog fixtures require an explicit unbundled CDP test session", () => {
  assert.equal(
    createDesktopE2ESaveDialog({
      isPackaged: false,
      env: { SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE: "cancel" },
    }),
    null,
  );
  assert.equal(
    createDesktopE2ESaveDialog({
      isPackaged: true,
      env: {
        SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
        SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE: "cancel",
      },
    }),
    null,
  );
});

test("save-dialog fixtures can return cancellation without a destination path", () => {
  const fixture = createDesktopE2ESaveDialog({
    isPackaged: false,
    env: {
      SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
      SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE: "cancel",
    },
  });

  assert.deepEqual(fixture?.showSaveDialog(), { canceled: true });
});

test("save-dialog fixtures reject responses that could select a file", () => {
  assert.throws(
    () =>
      createDesktopE2ESaveDialog({
        isPackaged: false,
        env: {
          SOCIAL_HARNESS_E2E_CDP_PORT: "41234",
          SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE: "/tmp/unexpected-export.mp4",
        },
      }),
    /only supports "cancel"/u,
  );
});
