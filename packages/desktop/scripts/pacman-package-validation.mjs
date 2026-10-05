import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function assertZstandardPackageHeader(header) {
  if (!Buffer.isBuffer(header) || header.length < ZSTD_FRAME_MAGIC.length) {
    throw new Error("Pacman artifact is too short to contain a Zstandard frame");
  }

  if (!header.subarray(0, ZSTD_FRAME_MAGIC.length).equals(ZSTD_FRAME_MAGIC)) {
    throw new Error("Pacman artifact has a .pkg.tar.zst suffix but is not Zstandard-compressed");
  }
}

export function assertPacmanPackageEntries(entries) {
  const normalizedEntries = entries.map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, ""));
  const entrySet = new Set(normalizedEntries);

  if (!entrySet.has(".PKGINFO")) {
    throw new Error("Pacman archive is missing .PKGINFO metadata");
  }

  if (!entrySet.has(".MTREE")) {
    throw new Error("Pacman archive is missing .MTREE metadata");
  }

  if (!normalizedEntries.some((entry) => entry.startsWith("opt/") && !entry.endsWith("/"))) {
    throw new Error("Pacman archive is missing its installed application payload under /opt");
  }
}

export async function verifyPacmanPackageArtifact(artifactPath) {
  const artifact = await open(artifactPath, "r");
  const header = Buffer.alloc(ZSTD_FRAME_MAGIC.length);

  try {
    const { bytesRead } = await artifact.read(header, 0, header.length, 0);
    assertZstandardPackageHeader(header.subarray(0, bytesRead));
  } finally {
    await artifact.close();
  }

  // GNU tar streams and checks the complete Zstandard archive while listing its contents.
  // Requiring these entries catches both a false .zst suffix and a truncated package.
  const { stdout } = await execFileAsync("tar", ["--zstd", "--list", "--file", artifactPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assertPacmanPackageEntries(stdout.split(/\r?\n/).filter(Boolean));
}
