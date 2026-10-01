#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { verifyPacmanPackageArtifact } from "./pacman-package-validation.mjs";

const argv = process.argv.slice(2);

function readArg(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

const artifactPath = readArg("--artifact-path");
if (!artifactPath) {
  throw new Error("Usage: audit-bundle-size.mjs --artifact-path <path-to-artifact>");
}

const absoluteArtifactPath = resolve(artifactPath);
const limitsMb = {
  default: 500,
  ".dmg": 500,
  ".zip": 500,
  ".exe": 500,
  ".appimage": 500,
  ".deb": 500,
};

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

const artifactStat = await stat(absoluteArtifactPath);
const extension = extname(absoluteArtifactPath).toLowerCase();
const limit = limitsMb[extension] ?? limitsMb.default;
const sizeMiB = artifactStat.size / 1024 / 1024;

console.log(`Artifact: ${absoluteArtifactPath}`);
console.log(`Type: ${extension || "<no-extension>"}`);
console.log(`Size: ${formatMiB(artifactStat.size)}`);
console.log(`Limit: ${limit} MiB`);

if (basename(absoluteArtifactPath).endsWith(".pkg.tar.zst")) {
  await verifyPacmanPackageArtifact(absoluteArtifactPath);
  console.log("Pacman archive: valid Zstandard compression, metadata, and application payload");
}

if (sizeMiB > limit) {
  console.error("Bundle size audit failed:");
  console.error(`  - Artifact exceeds ${limit} MiB`);
  process.exit(1);
}
