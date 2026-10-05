import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopInstagramCredentialVault } from "../src/main/desktopInstagramCredentialVault.js";

function createSafeStorage(backend: () => string = () => "gnome_libsecret") {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: backend,
    encryptString(value: string) {
      return Buffer.from([...value].reverse().join(""));
    },
    decryptString(value: Buffer) {
      return [...value.toString("utf8")].reverse().join("");
    },
  };
}

test("credential vault stores only encrypted text and restores token metadata after recreation", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "social-instagram-vault-"));
  try {
    const vault = createDesktopInstagramCredentialVault({
      rootDir,
      platform: "linux",
      safeStorage: createSafeStorage(),
    });
    await vault.set(
      "account-one",
      JSON.stringify({
        accessToken: "secret-token",
        expiresAt: 123,
        refreshedAt: 100,
        bridgeOrigin: "https://fixture-123.convex.site",
        bridgeInstallationHash: "A".repeat(43),
        mediaUploadCredential: "private-media-credential".padEnd(43, "m"),
      }),
    );

    const path = join(rootDir, "social-publishing", "credentials", "account-one.json");
    const encryptedFile = await readFile(path, "utf8");
    assert.equal(encryptedFile.includes("secret-token"), false);
    const reopenedVault = createDesktopInstagramCredentialVault({
      rootDir,
      platform: "linux",
      safeStorage: createSafeStorage(),
    });
    assert.deepEqual(JSON.parse((await reopenedVault.get("account-one")) ?? "null"), {
      accessToken: "secret-token",
      expiresAt: 123,
      refreshedAt: 100,
      bridgeOrigin: "https://fixture-123.convex.site",
      bridgeInstallationHash: "A".repeat(43),
      mediaUploadCredential: "private-media-credential".padEnd(43, "m"),
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("credential vault fails closed when Linux selects basic_text or storage is unavailable", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "social-instagram-vault-"));
  try {
    const basicTextVault = createDesktopInstagramCredentialVault({
      rootDir,
      platform: "linux",
      safeStorage: createSafeStorage(() => "basic_text"),
    });
    await assert.rejects(
      basicTextVault.set("account-one", JSON.stringify({ accessToken: "secret-token" })),
      { message: "OS secure storage backend is not protected" },
    );

    const unavailableVault = createDesktopInstagramCredentialVault({
      rootDir,
      platform: "darwin",
      safeStorage: { ...createSafeStorage(), isEncryptionAvailable: () => false },
    });
    await assert.rejects(
      unavailableVault.set("account-one", JSON.stringify({ accessToken: "secret-token" })),
      { message: "OS secure storage is unavailable" },
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("credential vault rejects traversal account IDs and still permits secure deletion", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "social-instagram-vault-"));
  try {
    const vault = createDesktopInstagramCredentialVault({
      rootDir,
      platform: "win32",
      safeStorage: createSafeStorage(),
    });
    await assert.rejects(
      vault.get("../outside"),
      (error: unknown) => error instanceof Error && error.name === "ZodError",
    );
    await vault.delete("account-one");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
