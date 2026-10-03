import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, cp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getTargetPlatform } from "../scripts/target-platform.mjs";
import { isConvexProvisionerReady } from "../scripts/convex-provisioner-assets.mjs";
import { resolveDesktopProductIdentity } from "../scripts/desktop-product-identity.mjs";
const desktopRoot = resolve(import.meta.dirname, "..");
const packagedExecutable = process.env.SOCIAL_HARNESS_PACKAGED_EXECUTABLE?.trim();
const linuxPayloadExecutable = join(
  desktopRoot,
  process.env.SOCIAL_HARNESS_DESKTOP_DIST_DIR || "dist",
  process.arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked",
  resolveDesktopProductIdentity({
    SOCIAL_HARNESS_ENV: "production",
    SOCIAL_HARNESS_PREVIEW_IDENTITY: "1",
  }).linuxExecutableName,
);
const embeddedNode = process.env.SOCIAL_HARNESS_CONVEX_RUNTIME_EXECUTABLE?.trim()
  ? resolve(process.env.SOCIAL_HARNESS_CONVEX_RUNTIME_EXECUTABLE)
  : packagedExecutable
    ? process.platform === "linux"
      ? linuxPayloadExecutable
      : resolve(packagedExecutable)
    : createRequire(import.meta.url)("electron");
const packagedResources =
  process.platform === "darwin"
    ? join(dirname(embeddedNode), "../Resources")
    : join(dirname(embeddedNode), "resources");
const assets = process.env.SOCIAL_HARNESS_CONVEX_RUNTIME_ASSETS?.trim()
  ? resolve(process.env.SOCIAL_HARNESS_CONVEX_RUNTIME_ASSETS)
  : packagedExecutable || process.env.SOCIAL_HARNESS_CONVEX_RUNTIME_EXECUTABLE?.trim()
    ? join(packagedResources, "convex-provisioner")
    : join(desktopRoot, "bundled-tools/convex-provisioner");
assert.equal(
  await isConvexProvisionerReady(
    assets,
    resolve(import.meta.dirname, "../../social-auth-bridge/src/adapters/convex"),
    getTargetPlatform(),
  ),
  true,
);
function run(args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(embeddedNode, args, {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (d) => {
      output += d;
    });
    child.stderr.on("data", (d) => {
      errors += d;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolveRun(output) : reject(new Error(errors))));
  });
}
const directory = await mkdtemp(join(tmpdir(), "convex-runtime-smoke-"));
try {
  await cp(join(assets, "template"), directory, { recursive: true });
  await symlink(
    join(assets, "node_modules"),
    join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (await run([join(assets, "node_modules/convex/bin/main.js"), "--version"], directory)).trim(),
    "1.46.0",
  );
  await writeFile(
    join(directory, "smoke.cjs"),
    'const esbuild=require("esbuild");esbuild.build({entryPoints:["convex/bridge.ts","convex/media.ts","convex/schema.ts","convex/http.ts","convex/crons.ts"],bundle:true,write:false,outdir:"smoke-out",platform:"browser",format:"esm",external:["convex/server","convex/values"],target:"es2022"}).then(result=>{if(result.outputFiles.length!==5)throw new Error("missing backend module");console.log("bundled-backend-ok")});',
  );
  assert.equal((await run([join(directory, "smoke.cjs")], directory)).trim(), "bundled-backend-ok");
  console.log(
    "Convex runtime smoke passed: official CLI and all backend modules run with Electron's embedded Node and bundled native esbuild, without external tools or dependency installation.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
