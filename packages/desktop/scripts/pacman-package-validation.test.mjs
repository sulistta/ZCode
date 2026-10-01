import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPacmanPackageEntries,
  assertZstandardPackageHeader,
} from "./pacman-package-validation.mjs";

test("accepts a Zstandard frame header", () => {
  assert.doesNotThrow(() => assertZstandardPackageHeader(Buffer.from([0x28, 0xb5, 0x2f, 0xfd])));
});

test("rejects an XZ frame with a Pacman .zst suffix", () => {
  assert.throws(
    () => assertZstandardPackageHeader(Buffer.from([0xfd, 0x37, 0x7a, 0x58])),
    /not Zstandard-compressed/,
  );
});

test("requires Pacman metadata and an application payload", () => {
  assert.doesNotThrow(() =>
    assertPacmanPackageEntries([
      "./.PKGINFO",
      "./.MTREE",
      "./opt/social-harness/resources/app.asar",
    ]),
  );
  assert.throws(
    () => assertPacmanPackageEntries([".MTREE", "opt/social-harness/resources/app.asar"]),
    /missing \.PKGINFO/,
  );
  assert.throws(
    () => assertPacmanPackageEntries([".PKGINFO", ".MTREE", "usr/share/doc/readme"]),
    /missing its installed application payload/,
  );
});
