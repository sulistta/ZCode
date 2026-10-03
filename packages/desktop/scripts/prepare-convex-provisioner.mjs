import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { collectRuntimeModuleClosureEntries } from "./runtime-dependency-closure.mjs";
import { getTargetPlatform } from "./target-platform.mjs";
import {
  convexVersion,
  backendFingerprint,
  isConvexProvisionerReady,
} from "./convex-provisioner-assets.mjs";
const root = resolve(import.meta.dirname, "../../..");
const destination = resolve(import.meta.dirname, "../bundled-tools/convex-provisioner");
const target = getTargetPlatform();
await rm(destination, { recursive: true, force: true });
await mkdir(join(destination, "template"), { recursive: true });
await cp(
  join(root, "packages/social-auth-bridge/src/adapters/convex"),
  join(destination, "template/convex"),
  { recursive: true },
);
await writeFile(
  join(destination, "template/convex.json"),
  JSON.stringify({ functions: "convex/" }),
);
await writeFile(
  join(destination, "template/package.json"),
  JSON.stringify({
    name: "social-harness-user-bridge",
    private: true,
    type: "module",
    dependencies: { convex: convexVersion },
  }),
);
const modules = collectRuntimeModuleClosureEntries(["convex"], [root]);
for (const entry of modules) {
  if (
    entry.moduleName.startsWith("@esbuild/") &&
    entry.moduleName !== `@esbuild/${target.os === "win32" ? "win32" : target.os}-${target.arch}`
  )
    continue;
  if (!entry.sourceModulePath)
    throw new Error(`Missing bundled Convex runtime dependency: ${entry.moduleName}`);
  const output = join(destination, "node_modules", entry.moduleName);
  await mkdir(resolve(output, ".."), { recursive: true });
  await cp(entry.sourceModulePath, output, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      !path.endsWith(".map") &&
      !relative(entry.sourceModulePath, path).split(/[\\/]/u).includes("node_modules"),
  });
}
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify({
    convexVersion,
    backendVersion: 1,
    platform: target.key,
    backendFingerprint: await backendFingerprint(
      join(root, "packages/social-auth-bridge/src/adapters/convex"),
    ),
  }),
);
if (
  !(await isConvexProvisionerReady(
    destination,
    join(root, "packages/social-auth-bridge/src/adapters/convex"),
    target,
  ))
)
  throw new Error(
    `Convex provisioning assets are incomplete for ${target.key}; install the target esbuild optional dependency on the build machine.`,
  );
console.log(
  "[prepare:convex-provisioner] bundled official CLI, backend template and runtime dependencies",
);
