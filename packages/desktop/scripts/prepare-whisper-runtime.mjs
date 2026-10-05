#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../scripts/spawn-command.mjs";
import { resolveWhisperCppBuildPlan } from "../../../scripts/social-media-tools-config.mjs";
import { getTargetPlatform } from "./target-platform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../..");
const runtimeSourcesPath = resolve(repositoryRoot, "third-party/runtime/sources.json");
const BUILD_OPTIONS = Object.freeze([
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DGGML_STATIC=ON",
  "-DWHISPER_BUILD_IS_DEV=OFF",
  "-DWHISPER_BUILD_TESTS=OFF",
  "-DWHISPER_BUILD_EXAMPLES=ON",
  "-DWHISPER_BUILD_SERVER=OFF",
  "-DGGML_NATIVE=OFF",
  "-DGGML_SSE42=OFF",
  "-DGGML_AVX=OFF",
  "-DGGML_AVX2=OFF",
  "-DGGML_BMI2=OFF",
  "-DGGML_FMA=OFF",
  "-DGGML_F16C=OFF",
  "-DGGML_AVX512=OFF",
  "-DGGML_OPENMP=OFF",
  "-DGGML_BLAS=OFF",
  "-DGGML_CUDA=OFF",
  "-DGGML_METAL=OFF",
  "-DGGML_OPENCL=OFF",
  "-DGGML_VULKAN=OFF",
  "-DGGML_HIP=OFF",
  "-DGGML_SYCL=OFF",
  "-DGGML_CCACHE=OFF",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readVerifiedLicense(version) {
  const sources = JSON.parse(await readFile(runtimeSourcesPath, "utf8"));
  const source = sources.whisperCpp?.find((entry) => entry.version === version);
  if (!source) throw new Error(`Missing whisper.cpp ${version} license provenance`);
  const licenseBytes = await readFile(resolve(repositoryRoot, source.license.file));
  if (sha256(licenseBytes) !== source.license.sha256) {
    throw new Error(`whisper.cpp license checksum mismatch: ${source.license.file}`);
  }
  return { source, licenseBytes };
}

async function downloadVerifiedSource(plan, archivePath, fetchImpl) {
  const response = await fetchImpl(plan.sourceUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`whisper.cpp source download failed with HTTP ${response.status}`);
  }
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const digestTransform = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > plan.sourceSizeBytes) {
        callback(new Error("whisper.cpp source archive exceeded its pinned size"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      digestTransform,
      createWriteStream(archivePath, { flags: "wx" }),
    );
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    throw error;
  }
  const actualSha256 = hash.digest("hex");
  if (sizeBytes !== plan.sourceSizeBytes || actualSha256 !== plan.sourceSha256) {
    await rm(archivePath, { force: true });
    throw new Error(
      `whisper.cpp source archive checksum mismatch: expected ${plan.sourceSha256}, got ${actualSha256}`,
    );
  }
}

async function currentBinaryMatches(outputDirectory, plan, licenseSha256) {
  try {
    const [metadataBytes, binaryBytes, licenseBytes] = await Promise.all([
      readFile(join(outputDirectory, "SOURCES.json")),
      readFile(join(outputDirectory, plan.binaryName)),
      readFile(join(outputDirectory, "LICENSE.txt")),
    ]);
    const metadata = JSON.parse(metadataBytes.toString("utf8"));
    return (
      metadata.tool === "whisper.cpp" &&
      metadata.version === plan.version &&
      metadata.commit === plan.commit &&
      metadata.platform === plan.platformKey &&
      metadata.source?.url === plan.sourceUrl &&
      metadata.source?.sizeBytes === plan.sourceSizeBytes &&
      metadata.source?.sha256 === plan.sourceSha256 &&
      metadata.source?.commit === plan.commit &&
      metadata.binary?.name === plan.binaryName &&
      metadata.binary?.sizeBytes === binaryBytes.byteLength &&
      metadata.binary?.sha256 === sha256(binaryBytes) &&
      metadata.build?.sharedLibraries === false &&
      metadata.build?.cpuOnly === true &&
      JSON.stringify(metadata.build?.cmakeOptions) === JSON.stringify(BUILD_OPTIONS) &&
      metadata.license?.sha256 === licenseSha256 &&
      sha256(licenseBytes) === licenseSha256 &&
      (await stat(join(outputDirectory, "THIRD-PARTY-NOTICES.txt"))).isFile() &&
      (await stat(join(outputDirectory, plan.binaryName))).isFile()
    );
  } catch {
    return false;
  }
}

async function findExecutable(buildDirectory, binaryName) {
  const matches = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === binaryName) {
        matches.push(path);
      }
    }
  }
  await walk(buildDirectory);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one whisper.cpp executable named ${binaryName}; found ${matches.length}`,
    );
  }
  return matches[0];
}

export function buildWhisperCppConfigureArgs(sourceDirectory, buildDirectory) {
  return ["-S", sourceDirectory, "-B", buildDirectory, ...BUILD_OPTIONS];
}

export async function prepareWhisperRuntime({
  platform = process.env.SOCIAL_HARNESS_TARGET_OS || process.platform,
  arch = process.env.SOCIAL_HARNESS_TARGET_ARCH || process.arch,
  outputRoot = resolve(scriptDir, "../bundled-tools"),
  fetchImpl = fetch,
  runCommandImpl = runCommand,
} = {}) {
  const plan = resolveWhisperCppBuildPlan({ platform, arch });
  // 编译产物必须与 Electron 目标匹配；错误架构会让安装后的首次转录才失败。
  if (plan.platform !== process.platform || plan.arch !== process.arch) {
    throw new Error(
      `whisper.cpp must be built on a native ${plan.platformKey} runner (current: ${process.platform}-${process.arch})`,
    );
  }

  const outputDirectory = resolve(outputRoot, plan.platformKey, "whisper.cpp");
  const binaryPath = join(outputDirectory, plan.binaryName);
  const { source, licenseBytes } = await readVerifiedLicense(plan.version);
  const stagingParent = dirname(outputDirectory);
  await mkdir(stagingParent, { recursive: true });
  if (await currentBinaryMatches(outputDirectory, plan, source.license.sha256)) {
    console.log(
      `[prepare:whisper-runtime] reuse whisper.cpp ${plan.version} (${plan.platformKey})`,
    );
    return { ...plan, outputDirectory, binaryPath };
  }

  const tempRoot = await mkdtemp(join(tmpdir(), `social-harness-whisper-${randomUUID()}-`));
  const sourceArchivePath = join(tempRoot, "whisper.cpp.tar.gz");
  const buildDirectory = join(tempRoot, "build");
  const stagingDirectory = await mkdtemp(join(stagingParent, ".whisper-stage-"));

  try {
    await downloadVerifiedSource(plan, sourceArchivePath, fetchImpl);
    runCommandImpl("cmake", ["-E", "tar", "xzf", sourceArchivePath], {
      cwd: tempRoot,
      env: process.env,
    });
    const extractedSourceDirectory = join(tempRoot, `whisper.cpp-${plan.version}`);
    const sourceEntries = await readdir(tempRoot);
    if (!sourceEntries.includes(`whisper.cpp-${plan.version}`)) {
      throw new Error("whisper.cpp source archive did not extract to its pinned root directory");
    }
    const extractedLicense = await readFile(join(extractedSourceDirectory, "LICENSE"));
    if (sha256(extractedLicense) !== source.license.sha256) {
      throw new Error("whisper.cpp source archive license does not match pinned provenance");
    }

    runCommandImpl(
      "cmake",
      buildWhisperCppConfigureArgs(extractedSourceDirectory, buildDirectory),
      {
        env: { ...process.env, SOURCE_DATE_EPOCH: "0" },
      },
    );
    runCommandImpl(
      "cmake",
      [
        "--build",
        buildDirectory,
        "--config",
        "Release",
        "--target",
        "whisper-cli",
        "--parallel",
        String(Math.max(1, Math.min(6, availableParallelism()))),
      ],
      { env: { ...process.env, SOURCE_DATE_EPOCH: "0" } },
    );

    const builtBinaryPath = await findExecutable(buildDirectory, plan.binaryName);
    await cp(builtBinaryPath, join(stagingDirectory, plan.binaryName));
    if (process.platform !== "win32") {
      await chmod(join(stagingDirectory, plan.binaryName), 0o755);
    }
    await writeFile(join(stagingDirectory, "LICENSE.txt"), licenseBytes);
    const binaryBytes = await readFile(join(stagingDirectory, plan.binaryName));
    const binaryStat = await stat(join(stagingDirectory, plan.binaryName));
    const stagedSources = {
      tool: "whisper.cpp",
      version: plan.version,
      commit: plan.commit,
      platform: plan.platformKey,
      source: {
        url: plan.sourceUrl,
        sizeBytes: plan.sourceSizeBytes,
        sha256: plan.sourceSha256,
        commit: plan.commit,
      },
      build: {
        system: "native target runner",
        configuration: "Release",
        sharedLibraries: false,
        cpuOnly: true,
        tests: false,
        server: false,
        cmakeOptions: BUILD_OPTIONS,
      },
      binary: {
        name: plan.binaryName,
        sizeBytes: binaryStat.size,
        sha256: sha256(binaryBytes),
      },
      license: {
        source: source.license.source,
        file: "LICENSE.txt",
        sha256: source.license.sha256,
      },
    };
    await writeFile(
      join(stagingDirectory, "SOURCES.json"),
      `${JSON.stringify(stagedSources, null, 2)}\n`,
    );
    await writeFile(
      join(stagingDirectory, "THIRD-PARTY-NOTICES.txt"),
      [
        `whisper.cpp ${plan.version} (${plan.platformKey})`,
        `Official source: ${plan.sourceUrl}`,
        `Source commit: ${plan.commit}`,
        "The static CPU executable includes whisper.cpp and its ggml subproject under the upstream MIT license in LICENSE.txt.",
        "The source archive checksum, build configuration, license checksum, and executable checksum are recorded in SOURCES.json.",
        "",
      ].join("\n"),
    );

    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, outputDirectory);
    return { ...plan, outputDirectory, binaryPath };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("whisper.cpp packaging requires CMake and a native C/C++ compiler", {
        cause: error,
      });
    }
    throw error;
  } finally {
    await Promise.all([
      rm(tempRoot, { recursive: true, force: true }),
      rm(stagingDirectory, { recursive: true, force: true }),
    ]);
  }
}

async function main() {
  const target = getTargetPlatform();
  const plan = await prepareWhisperRuntime({ platform: target.os, arch: target.arch });
  console.log(`[prepare:whisper-runtime] staged ${plan.binaryPath}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
