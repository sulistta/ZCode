import { createHash } from "node:crypto";
import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
export const convexVersion = "1.46.0";
export async function backendFingerprint(directory) {
  const hash = createHash("sha256");
  async function visit(path, prefix) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(path, entry.name), name);
      else {
        hash.update(name);
        hash.update(await readFile(join(path, entry.name)));
      }
    }
  }
  hash.update(convexVersion);
  await visit(directory, "convex");
  return hash.digest("hex");
}
export async function isConvexProvisionerReady(destination, source, target) {
  try {
    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    if (
      manifest.platform !== target.key ||
      manifest.convexVersion !== convexVersion ||
      manifest.backendFingerprint !== (await backendFingerprint(source))
    )
      return false;
    if (
      manifest.backendFingerprint !==
      (await backendFingerprint(join(destination, "template/convex")))
    )
      return false;
    const esbuild = JSON.parse(
      await readFile(join(destination, "node_modules/esbuild/package.json"), "utf8"),
    );
    const native = JSON.parse(
      await readFile(
        join(destination, `node_modules/@esbuild/${target.os}-${target.arch}/package.json`),
        "utf8",
      ),
    );
    const convex = JSON.parse(
      await readFile(join(destination, "node_modules/convex/package.json"), "utf8"),
    );
    if (esbuild.version !== native.version || esbuild.version !== convex.dependencies.esbuild)
      return false;
    for (const path of [
      "convex/bin/main.js",
      "convex/dist/cli.bundle.cjs",
      "esbuild/lib/main.js",
      `@esbuild/${target.os}-${target.arch}/${target.os === "win32" ? "esbuild.exe" : "bin/esbuild"}`,
    ])
      await access(join(destination, "node_modules", path));
    return true;
  } catch {
    return false;
  }
}
