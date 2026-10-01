#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveYtDlpReleasePlan } from "../../../scripts/social-media-tools-config.mjs";
import { getTargetPlatform } from "./target-platform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../..");
const runtimeSourcesPath = resolve(repositoryRoot, "third-party/runtime/sources.json");
const YT_DLP_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readVerifiedLicenseMaterials(version) {
  const sources = JSON.parse(await readFile(runtimeSourcesPath, "utf8"));
  const source = sources.ytDlp?.find((item) => item.version === version);
  if (!source) throw new Error(`Missing yt-dlp ${version} license provenance`);

  const materials = [];
  for (const item of [source.license, source.thirdPartyLicenses]) {
    const bytes = await readFile(resolve(repositoryRoot, item.file));
    const actualSha256 = hashBytes(bytes);
    if (actualSha256 !== item.sha256) {
      throw new Error(`yt-dlp license material checksum mismatch: ${item.file}`);
    }
    materials.push({ ...item, bytes });
  }
  return { source, materials };
}

async function currentBinaryMatches(binaryPath, plan) {
  try {
    const info = await stat(binaryPath);
    if (!info.isFile() || info.size !== plan.sizeBytes) return false;
    return hashBytes(await readFile(binaryPath)) === plan.sha256;
  } catch {
    return false;
  }
}

async function downloadVerifiedAsset(plan, binaryPath, fetchImpl) {
  const temporaryPath = join(dirname(binaryPath), `.yt-dlp-${randomUUID()}.download`);
  try {
    const response = await fetchImpl(plan.sourceUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(YT_DLP_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      throw new Error(`yt-dlp download failed with HTTP ${response.status}`);
    }

    const hash = createHash("sha256");
    let sizeBytes = 0;
    const digestTransform = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.byteLength;
        if (sizeBytes > plan.sizeBytes) {
          callback(new Error("yt-dlp release asset exceeded its pinned size"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      digestTransform,
      createWriteStream(temporaryPath, { flags: "wx" }),
    );

    const actualSha256 = hash.digest("hex");
    if (sizeBytes !== plan.sizeBytes || actualSha256 !== plan.sha256) {
      throw new Error(
        `yt-dlp release asset checksum mismatch for ${plan.platformKey}: expected ${plan.sha256}, got ${actualSha256}`,
      );
    }

    await rm(binaryPath, { force: true });
    await rename(temporaryPath, binaryPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function stageNotices(directory, plan, source, materials, binaryPath) {
  const stagedMaterials = [];
  for (const material of materials) {
    const fileName = material === materials[0] ? "LICENSE.txt" : "THIRD_PARTY_LICENSES.txt";
    await writeFile(join(directory, fileName), material.bytes);
    stagedMaterials.push({
      source: material.source,
      sourceFile: material.file,
      stagedFile: fileName,
      sha256: material.sha256,
    });
  }

  const binarySha256 = hashBytes(await readFile(binaryPath));
  const sources = {
    tool: "yt-dlp",
    version: plan.version,
    platform: plan.platformKey,
    upstreamRelease: source.release,
    asset: {
      name: plan.assetName,
      url: plan.sourceUrl,
      sizeBytes: plan.sizeBytes,
      sha256: plan.sha256,
      binaryName: plan.binaryName,
      stagedSha256: binarySha256,
    },
    licenseMaterials: stagedMaterials,
  };
  await writeFile(join(directory, "SOURCES.json"), `${JSON.stringify(sources, null, 2)}\n`);
  await writeFile(
    join(directory, "THIRD-PARTY-NOTICES.txt"),
    [
      `yt-dlp ${plan.version} (${plan.platformKey})`,
      `Official release asset: ${plan.assetName}`,
      "The official PyInstaller executable includes yt-dlp-ejs and other third-party code.",
      "The complete upstream license texts for yt-dlp and bundled third-party components are in LICENSE.txt and THIRD_PARTY_LICENSES.txt.",
      "The release asset URL and SHA-256 values are recorded in SOURCES.json.",
      "",
    ].join("\n"),
  );
}

export async function prepareSocialMediaTools({
  platform = process.env.SOCIAL_HARNESS_TARGET_OS || process.platform,
  arch = process.env.SOCIAL_HARNESS_TARGET_ARCH || process.arch,
  outputRoot = resolve(scriptDir, "../bundled-tools"),
  fetchImpl = fetch,
} = {}) {
  const plan = resolveYtDlpReleasePlan({ platform, arch });
  const directory = resolve(outputRoot, plan.platformKey, "yt-dlp");
  const binaryPath = join(directory, plan.binaryName);
  const { source, materials } = await readVerifiedLicenseMaterials(plan.version);
  await mkdir(directory, { recursive: true });

  if (await currentBinaryMatches(binaryPath, plan)) {
    console.log(`[prepare:social-media-tools] reuse yt-dlp ${plan.version} (${plan.platformKey})`);
  } else {
    console.log(
      `[prepare:social-media-tools] download yt-dlp ${plan.version} (${plan.platformKey})`,
    );
    await downloadVerifiedAsset(plan, binaryPath, fetchImpl);
  }

  if (process.platform !== "win32" && plan.platform !== "win32") {
    await chmod(binaryPath, 0o755);
  }
  await stageNotices(directory, plan, source, materials, binaryPath);
  return { ...plan, directory, binaryPath };
}

async function main() {
  const target = getTargetPlatform();
  const plan = await prepareSocialMediaTools({ platform: target.os, arch: target.arch });
  console.log(`[prepare:social-media-tools] staged ${plan.binaryPath}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
