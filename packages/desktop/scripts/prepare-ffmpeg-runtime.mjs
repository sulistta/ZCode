#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../scripts/spawn-command.mjs";
import { resolveFfmpegReleasePlan } from "../../../scripts/social-media-tools-config.mjs";
import { getTargetPlatform } from "./target-platform.mjs";
import {
  downloadVerifiedFfmpegAsset,
  extractFfmpegZipAsset,
  extractLinuxFfmpegArchive,
  ffmpegSourceProvenanceMatches,
  hasPassingFfmpegRuntimeSmoke,
  listFfmpegRuntimeFiles,
  sha256Bytes,
  sha256File,
  verifyFfmpegExecutablePair,
} from "./ffmpeg-runtime-assets.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../..");
const runtimeSourcesPath = resolve(repositoryRoot, "third-party/runtime/sources.json");

async function readVerifiedLicense(version) {
  const sources = JSON.parse(await readFile(runtimeSourcesPath, "utf8"));
  const source = sources.ffmpeg?.find((entry) => entry.version === version);
  if (!source) throw new Error(`Missing FFmpeg ${version} license provenance`);
  const licenseBytes = await readFile(resolve(repositoryRoot, source.license.file));
  if (sha256Bytes(licenseBytes) !== source.license.sha256) {
    throw new Error(`FFmpeg license checksum mismatch: ${source.license.file}`);
  }
  return { source, licenseBytes };
}

async function currentRuntimeMatches(outputDirectory, plan, licenseSha256) {
  try {
    const metadata = JSON.parse(await readFile(join(outputDirectory, "SOURCES.json"), "utf8"));
    const licenseBytes = await readFile(join(outputDirectory, "LICENSE.txt"));
    const noticeInfo = await stat(join(outputDirectory, "THIRD-PARTY-NOTICES.txt"));
    if (
      metadata.tool !== "ffmpeg" ||
      metadata.version !== plan.version ||
      metadata.platform !== plan.platformKey ||
      metadata.provider !== plan.provider ||
      metadata.providerReleaseUrl !== plan.providerReleaseUrl ||
      !ffmpegSourceProvenanceMatches(metadata, plan) ||
      metadata.variant !== plan.variant ||
      JSON.stringify(metadata.assets) !== JSON.stringify(plan.assets) ||
      metadata.license?.sha256 !== licenseSha256 ||
      sha256Bytes(licenseBytes) !== licenseSha256 ||
      !noticeInfo.isFile() ||
      !metadata.build?.buildConfiguration?.includes("--enable-gpl") ||
      metadata.build.buildConfiguration.includes("--enable-nonfree") ||
      !hasPassingFfmpegRuntimeSmoke(metadata.build.runtimeSmoke) ||
      !metadata.requiredEncoders?.includes("libx264")
    ) {
      return false;
    }
    for (const file of metadata.runtimeFiles ?? []) {
      const filePath = join(outputDirectory, ...file.path.split("/"));
      const fileInfo = await stat(filePath);
      if (fileInfo.size !== file.sizeBytes || (await sha256File(filePath)) !== file.sha256) {
        return false;
      }
    }
    return (
      metadata.runtimeFiles?.some(
        (file) => file.path === `bin/ffmpeg${plan.platform === "win32" ? ".exe" : ""}`,
      ) &&
      metadata.runtimeFiles?.some(
        (file) => file.path === `bin/ffprobe${plan.platform === "win32" ? ".exe" : ""}`,
      )
    );
  } catch {
    return false;
  }
}

export async function prepareFfmpegRuntime({
  platform = process.env.SOCIAL_HARNESS_TARGET_OS || process.platform,
  arch = process.env.SOCIAL_HARNESS_TARGET_ARCH || process.arch,
  outputRoot = resolve(scriptDir, "../bundled-tools"),
  fetchImpl = fetch,
  runCommandImpl = runCommand,
} = {}) {
  const plan = resolveFfmpegReleasePlan({ platform, arch });
  if (plan.platform !== process.platform || plan.arch !== process.arch) {
    throw new Error(
      `FFmpeg must be prepared on a native ${plan.platformKey} runner (current: ${process.platform}-${process.arch})`,
    );
  }

  const outputDirectory = resolve(outputRoot, plan.platformKey, "ffmpeg");
  const { source, licenseBytes } = await readVerifiedLicense(plan.version);
  await mkdir(dirname(outputDirectory), { recursive: true });
  if (await currentRuntimeMatches(outputDirectory, plan, source.license.sha256)) {
    console.log(`[prepare:ffmpeg-runtime] reuse FFmpeg ${plan.version} (${plan.platformKey})`);
    return { ...plan, outputDirectory };
  }

  const tempRoot = await mkdtemp(join(tmpdir(), `social-harness-ffmpeg-${randomUUID()}-`));
  const stagingDirectory = await mkdtemp(join(dirname(outputDirectory), ".ffmpeg-stage-"));
  const runtimePaths = [
    `bin/ffmpeg${plan.platform === "win32" ? ".exe" : ""}`,
    `bin/ffprobe${plan.platform === "win32" ? ".exe" : ""}`,
  ];
  try {
    const archivePaths = [];
    for (const [index, asset] of plan.assets.entries()) {
      const archivePath = join(tempRoot, `${index}-${asset.name}`);
      console.log(`[prepare:ffmpeg-runtime] download ${asset.name} (${plan.platformKey})`);
      await downloadVerifiedFfmpegAsset(asset, archivePath, fetchImpl);
      archivePaths.push({ asset, archivePath });
    }

    if (plan.platform === "linux") {
      const stagedLibraryPaths = await extractLinuxFfmpegArchive(
        archivePaths[0].archivePath,
        stagingDirectory,
        plan,
        runCommandImpl,
      );
      runtimePaths.push(...stagedLibraryPaths);
    } else {
      for (const { asset, archivePath } of archivePaths) {
        const libraryPaths = await extractFfmpegZipAsset(
          archivePath,
          stagingDirectory,
          plan,
          asset,
        );
        runtimePaths.push(...libraryPaths);
      }
    }

    const ffmpegPath = join(
      stagingDirectory,
      "bin",
      plan.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    const ffprobePath = join(
      stagingDirectory,
      "bin",
      plan.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
    if (plan.platform !== "win32") {
      await Promise.all([chmod(ffmpegPath, 0o755), chmod(ffprobePath, 0o755)]);
    }
    const build = await verifyFfmpegExecutablePair(stagingDirectory, plan);
    const runtimeFiles = await listFfmpegRuntimeFiles(stagingDirectory, runtimePaths);
    const binaries = runtimeFiles.filter((file) => file.path.startsWith("bin/ff"));
    await writeFile(join(stagingDirectory, "LICENSE.txt"), licenseBytes);
    const licenseSha256 = sha256Bytes(licenseBytes);
    const stagedSources = {
      tool: "ffmpeg",
      version: plan.version,
      platform: plan.platformKey,
      provider: plan.provider,
      providerReleaseUrl: plan.providerReleaseUrl,
      ffmpegSourceCommit: plan.ffmpegSourceCommit,
      buildScriptSource: plan.buildScriptSource,
      variant: plan.variant,
      assets: plan.assets,
      build,
      requiredEncoders: build.requiredEncoders,
      runtimeFiles,
      binaries,
      license: { file: "LICENSE.txt", sha256: licenseSha256 },
    };
    await writeFile(
      join(stagingDirectory, "SOURCES.json"),
      `${JSON.stringify(stagedSources, null, 2)}\n`,
    );
    await writeFile(
      join(stagingDirectory, "THIRD-PARTY-NOTICES.txt"),
      [
        `FFmpeg ${plan.version} and ffprobe (${plan.platformKey})`,
        `Provider: ${plan.provider}`,
        `FFmpeg source revision: ${plan.ffmpegSourceCommit}`,
        `Provider build script revision: ${plan.buildScriptSource.revision} (${plan.buildScriptSource.revisionStatus}); source archive hashes are in SOURCES.json.`,
        ...(plan.buildScriptSource.revisionStatus === "candidate-unverified"
          ? [
              "The provider has not attested that this build script revision produced these binaries.",
            ]
          : []),
        `Build variant: ${plan.variant}; H.264 export uses libx264.`,
        "This is a GPL build. The GPLv3 text is in LICENSE.txt; exact target archives and staged file checksums are in SOURCES.json.",
        `Corresponding source and reproducible build materials must accompany the release: ${source.reviewRequired}`,
        "",
      ].join("\n"),
    );

    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, outputDirectory);
    return { ...plan, outputDirectory };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const target = getTargetPlatform();
  const plan = await prepareFfmpegRuntime({ platform: target.os, arch: target.arch });
  console.log(`[prepare:ffmpeg-runtime] staged ${plan.outputDirectory}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
