import assert from "node:assert/strict";
import test from "node:test";
import { handleSecondInstanceDeepLink } from "./desktopSecondInstanceDeepLink.js";

test("second instances ignore legacy arbitrary-folder arguments", () => {
  let handledUrl: string | null = null;
  const handled = handleSecondInstanceDeepLink({
    additionalData: { openWorkspacePath: "/tmp/project" },
    argv: ["Social Harness.exe", "--open-workspace", "/tmp/project"],
    handleDeepLink: (url) => {
      handledUrl = url;
      return true;
    },
  });

  assert.equal(handled, false);
  assert.equal(handledUrl, null);
});
