import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readlink, rm, stat, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl");
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
export const FFMPEG_RUNTIME_SMOKE_FIXTURE = Object.freeze({
  source: "lavfi:testsrc2",
  width: 64,
  height: 64,
  frameRate: 24,
  frameCount: 6,
});

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hasPassingFfmpegRuntimeSmoke(smoke) {
  return (
    smoke?.status === "passed" &&
    JSON.stringify(smoke.fixture) === JSON.stringify(FFMPEG_RUNTIME_SMOKE_FIXTURE) &&
    typeof smoke.observed?.formatName === "string" &&
    smoke.observed.formatName.split(",").includes("mp4") &&
    smoke.observed.codecName === "h264" &&
    smoke.observed.width === FFMPEG_RUNTIME_SMOKE_FIXTURE.width &&
    smoke.observed.height === FFMPEG_RUNTIME_SMOKE_FIXTURE.height &&
    smoke.observed.frameCount === FFMPEG_RUNTIME_SMOKE_FIXTURE.frameCount
  );
}

export function ffmpegSourceProvenanceMatches(metadata, plan) {
  return (
    metadata?.ffmpegSourceCommit === plan.ffmpegSourceCommit &&
    JSON.stringify(metadata?.buildScriptSource) === JSON.stringify(plan.buildScriptSource)
  );
}

export function parseFfmpegRuntimeSmokeProbe(probeOutput) {
  let probe;
  try {
    probe = JSON.parse(probeOutput);
  } catch {
    throw new Error("FFmpeg runtime smoke test received invalid ffprobe JSON");
  }

  const stream = Array.isArray(probe?.streams) ? probe.streams[0] : null;
  const observed = {
    formatName: probe?.format?.format_name,
    codecName: stream?.codec_name,
    width: Number(stream?.width),
    height: Number(stream?.height),
    frameCount: Number(stream?.nb_frames),
  };
  if (
    typeof observed.formatName !== "string" ||
    !observed.formatName.split(",").includes("mp4") ||
    observed.codecName !== "h264" ||
    observed.width !== FFMPEG_RUNTIME_SMOKE_FIXTURE.width ||
    observed.height !== FFMPEG_RUNTIME_SMOKE_FIXTURE.height ||
    observed.frameCount !== FFMPEG_RUNTIME_SMOKE_FIXTURE.frameCount
  ) {
    throw new Error("FFmpeg runtime smoke test did not produce the expected H.264 MP4 fixture");
  }
  return observed;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function readCommandStdout(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with code ${String(result.status)}${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout;
}

export async function downloadVerifiedFfmpegAsset(asset, archivePath, fetchImpl) {
  const response = await fetchImpl(asset.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`FFmpeg runtime download failed with HTTP ${response.status}: ${asset.name}`);
  }

  const hash = createHash("sha256");
  let sizeBytes = 0;
  const digestTransform = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > asset.sizeBytes) {
        callback(new Error(`FFmpeg archive exceeded its pinned size: ${asset.name}`));
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
  if (sizeBytes !== asset.sizeBytes || actualSha256 !== asset.sha256) {
    await rm(archivePath, { force: true });
    throw new Error(
      `FFmpeg archive checksum mismatch for ${asset.name}: expected ${asset.sha256}, got ${actualSha256}`,
    );
  }
}

function archiveEntryName(entryName) {
  const normalized = entryName.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`FFmpeg ZIP contains an unsafe path: ${entryName}`);
  }
  return segments;
}

export async function extractFfmpegZipAsset(archivePath, outputDirectory, plan, asset) {
  await mkdir(join(outputDirectory, "bin"), { recursive: true });
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let foundFfmpeg = false;
    let foundFfprobe = false;
    const libraryNames = new Map();
    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        fail(openError ?? new Error(`Could not open FFmpeg ZIP: ${asset.name}`));
        return;
      }

      zipFile.on("error", fail);
      zipFile.on("entry", (entry) => {
        let segments;
        try {
          segments = archiveEntryName(entry.fileName);
        } catch (error) {
          fail(error);
          return;
        }
        const fileName = segments.at(-1) ?? "";
        if (entry.fileName.endsWith("/")) {
          zipFile.readEntry();
          return;
        }

        let targetRelativePath;
        if (plan.platform === "win32") {
          if (segments.at(-2) === "bin") {
            if (fileName === "ffmpeg.exe" || fileName === "ffprobe.exe") {
              targetRelativePath = `bin/${fileName}`;
            } else if (/\.dll$/i.test(fileName)) {
              targetRelativePath = `bin/${fileName}`;
              if (libraryNames.has(fileName.toLowerCase())) {
                fail(new Error(`FFmpeg ZIP contains duplicate DLL ${fileName}`));
                return;
              }
              libraryNames.set(fileName.toLowerCase(), fileName);
            }
          }
        } else if (fileName === asset.binaryName) {
          targetRelativePath = `bin/${asset.binaryName}`;
        }

        if (!targetRelativePath) {
          zipFile.readEntry();
          return;
        }

        const destinationPath = join(outputDirectory, ...targetRelativePath.split("/"));
        mkdir(dirname(destinationPath), { recursive: true })
          .then(
            () =>
              new Promise((streamResolve, streamReject) => {
                zipFile.openReadStream(entry, (streamError, readStream) => {
                  if (streamError || !readStream) {
                    streamReject(streamError ?? new Error(`Could not read ${entry.fileName}`));
                    return;
                  }
                  pipeline(readStream, createWriteStream(destinationPath, { flags: "wx" }))
                    .then(streamResolve)
                    .catch(streamReject);
                });
              }),
          )
          .then(() => {
            if (targetRelativePath === "bin/ffmpeg" || targetRelativePath === "bin/ffmpeg.exe") {
              foundFfmpeg = true;
            }
            if (targetRelativePath === "bin/ffprobe" || targetRelativePath === "bin/ffprobe.exe") {
              foundFfprobe = true;
            }
            zipFile.readEntry();
          })
          .catch(fail);
      });
      zipFile.on("end", () => {
        if (settled) return;
        if (
          plan.platform === "win32" &&
          (!foundFfmpeg || !foundFfprobe || libraryNames.size === 0)
        ) {
          fail(new Error(`FFmpeg ZIP is missing its executables or DLLs: ${asset.name}`));
          return;
        }
        if (asset.binaryName && !(asset.binaryName === "ffmpeg" ? foundFfmpeg : foundFfprobe)) {
          fail(new Error(`FFmpeg ZIP is missing ${asset.binaryName}: ${asset.name}`));
          return;
        }
        settled = true;
        resolvePromise([...libraryNames.values()].map((name) => `bin/${name}`));
      });
      zipFile.readEntry();
    });
  });
}

export async function extractLinuxFfmpegArchive(
  archivePath,
  outputDirectory,
  plan,
  runCommandImpl,
) {
  const extractedRoot = await mkdtemp(
    join(tmpdir(), `social-harness-ffmpeg-unpack-${randomUUID()}-`),
  );
  try {
    runCommandImpl("tar", ["-xJf", archivePath, "-C", extractedRoot]);
    const releaseRoot = join(extractedRoot, plan.archiveRoot);
    const sourceBin = join(releaseRoot, "bin");
    const sourceLib = join(releaseRoot, "lib");
    const libraryEntries = await readdir(sourceLib, { withFileTypes: true });
    const runtimeLibraryNames = libraryEntries
      .filter((entry) => /^lib.+\.so(?:\.|$)/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (runtimeLibraryNames.length === 0) {
      throw new Error(`BtbN FFmpeg archive has no shared libraries: ${plan.archiveRoot}`);
    }

    await mkdir(join(outputDirectory, "bin"), { recursive: true });
    await mkdir(join(outputDirectory, "lib"), { recursive: true });
    for (const binaryName of ["ffmpeg", "ffprobe"]) {
      await cp(join(sourceBin, binaryName), join(outputDirectory, "bin", binaryName));
    }
    for (const libraryName of runtimeLibraryNames) {
      const sourcePath = join(sourceLib, libraryName);
      const destinationPath = join(outputDirectory, "lib", libraryName);
      const entryInfo = await lstat(sourcePath);
      if (entryInfo.isSymbolicLink()) {
        const linkTarget = await readlink(sourcePath);
        if (linkTarget.includes("/") || linkTarget.includes("\\") || linkTarget === "..") {
          throw new Error(`BtbN FFmpeg archive has an unexpected library link: ${libraryName}`);
        }
        // 修复：Node fs.cp 会把归档中的相对 .so 链接改成临时解包目录下的绝对链接，清理临时目录后动态加载器就找不到库。这里在安装目录重建相对链接。
        await symlink(linkTarget, destinationPath);
      } else {
        await cp(sourcePath, destinationPath);
      }
    }
    return runtimeLibraryNames.map((name) => `lib/${name}`);
  } finally {
    await rm(extractedRoot, { recursive: true, force: true });
  }
}

export async function listFfmpegRuntimeFiles(outputDirectory, relativePaths) {
  const files = [];
  for (const relativePath of [...new Set(relativePaths)].sort()) {
    const path = join(outputDirectory, ...relativePath.split("/"));
    const [linkInfo, fileInfo] = await Promise.all([lstat(path), stat(path)]);
    files.push({
      path: relativePath,
      kind: linkInfo.isSymbolicLink() ? "symlink" : "file",
      sizeBytes: fileInfo.size,
      sha256: await sha256File(path),
    });
  }
  return files;
}

export async function verifyFfmpegExecutablePair(outputDirectory, plan) {
  const ffmpegPath = join(
    outputDirectory,
    "bin",
    plan.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  const ffprobePath = join(
    outputDirectory,
    "bin",
    plan.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  );
  const versionOutput = readCommandStdout(ffmpegPath, ["-version"]);
  const ffprobeVersionOutput = readCommandStdout(ffprobePath, ["-version"]);
  if (
    !versionOutput.startsWith(plan.expectedVersionPrefix) ||
    !ffprobeVersionOutput.startsWith(plan.expectedVersionPrefix.replace(/^ffmpeg/, "ffprobe"))
  ) {
    throw new Error(`Packaged FFmpeg version does not match ${plan.version} (${plan.platformKey})`);
  }
  const encoderOutput = readCommandStdout(ffmpegPath, ["-hide_banner", "-encoders"]);
  if (!encoderOutput.includes("libx264")) {
    throw new Error(`Packaged FFmpeg does not provide libx264 (${plan.platformKey})`);
  }
  const buildConfiguration = readCommandStdout(ffmpegPath, ["-buildconf"]);
  const usesNonFree = buildConfiguration.includes("--enable-nonfree");
  if (usesNonFree) {
    throw new Error(`Refusing to package a nonfree FFmpeg build (${plan.platformKey})`);
  }

  const smokeDirectory = await mkdtemp(join(tmpdir(), "social-harness-ffmpeg-smoke-"));
  let runtimeSmoke;
  try {
    const fixturePath = join(smokeDirectory, "fixture.mp4");
    readCommandStdout(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `${FFMPEG_RUNTIME_SMOKE_FIXTURE.source.slice("lavfi:".length)}=size=${FFMPEG_RUNTIME_SMOKE_FIXTURE.width}x${FFMPEG_RUNTIME_SMOKE_FIXTURE.height}:rate=${FFMPEG_RUNTIME_SMOKE_FIXTURE.frameRate}`,
      "-frames:v",
      String(FFMPEG_RUNTIME_SMOKE_FIXTURE.frameCount),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      fixturePath,
    ]);
    const probeOutput = readCommandStdout(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,nb_frames:format=format_name",
      "-of",
      "json",
      fixturePath,
    ]);
    runtimeSmoke = {
      status: "passed",
      fixture: FFMPEG_RUNTIME_SMOKE_FIXTURE,
      observed: parseFfmpegRuntimeSmokeProbe(probeOutput),
    };
    if (!hasPassingFfmpegRuntimeSmoke(runtimeSmoke)) {
      throw new Error(`FFmpeg runtime smoke test failed (${plan.platformKey})`);
    }
  } finally {
    await rm(smokeDirectory, { recursive: true, force: true });
  }

  return {
    ffmpegVersionOutput: versionOutput.split(/\r?\n/)[0],
    ffprobeVersionOutput: ffprobeVersionOutput.split(/\r?\n/)[0],
    requiredEncoders: ["libx264"],
    buildConfiguration,
    runtimeSmoke,
  };
}
