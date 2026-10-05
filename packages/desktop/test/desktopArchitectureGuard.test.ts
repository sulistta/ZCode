import assert from "node:assert/strict";
import test from "node:test";
import { formatArchitectureMismatchDialogText } from "../src/main/desktopArchitectureGuard.js";

test("architecture mismatch guidance stays non-blocking without a legacy download link", () => {
  const text = formatArchitectureMismatchDialogText(
    { binaryArch: "x64", nativeArch: "arm64" },
    "en-US",
  );

  assert.equal(text.dismissButton, "Continue");
  assert.match(text.detail, /keep using the app/);
  assert.doesNotMatch(text.detail, /https?:\/\/|download/i);
  assert.equal("downloadButton" in text, false);
});
