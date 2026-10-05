import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { socialMediaAssetSchema } from "@social-harness/shared";

export async function seedSocialProjectClipCandidateAssets(
  dataBaseDir,
  accountName,
  ffmpegExecutable,
) {
  const accountsPath = join(
    dataBaseDir,
    ".social-harness",
    "v1",
    "social-accounts",
    "accounts.json",
  );
  const accounts = JSON.parse(await readFile(accountsPath, "utf8"));
  const account = accounts.find((entry) => entry.displayName === accountName);
  assert.ok(account?.accountId, `Expected the saved account ${accountName}`);
  const accountId = account.accountId;
  const fixtureDirectory = join(dataBaseDir, "e2e-fixtures");
  await mkdir(fixtureDirectory, { recursive: true });

  const transcriptSegments = Array.from({ length: 24 }, (_, index) => ({
    startSeconds: index * 1.25,
    endSeconds: index * 1.25 + 1,
    text:
      index % 3 === 2
        ? `Uma ideia completa para o episódio ${index}.`
        : `Trecho falado sobre criação ${index}`,
  }));
  const importedAt = Date.now();
  const fixtureSpecs = [
    {
      originalName: "Podcast transcript candidate fixture.mp4",
      fileName: "podcast-transcript-candidate.mp4",
      audioInput: "sine=frequency=440:sample_rate=48000:duration=35",
      transcript: {
        method: "whisper-local",
        languageCode: "pt-BR",
        modelId: "small",
        createdAt: importedAt,
        segments: transcriptSegments,
      },
    },
    {
      originalName: "Synthetic music candidate fixture.mp4",
      fileName: "synthetic-music-candidate.mp4",
      audioInput:
        "aevalsrc=0.20*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*2*t))+0.10*sin(2*PI*330*t)*(0.55+0.45*sin(2*PI*2*t)):s=48000:d=35",
    },
  ];

  const assets = [];
  for (const fixture of fixtureSpecs) {
    const sourcePath = join(fixtureDirectory, fixture.fileName);
    const created = spawnSync(
      ffmpegExecutable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x17324d:s=320x320:r=15:d=35",
        "-f",
        "lavfi",
        "-i",
        fixture.audioInput,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        "35",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-y",
        sourcePath,
      ],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const creationDetails = [
      created.error?.message,
      created.signal ? `signal ${created.signal}` : undefined,
      created.stderr?.toString("utf8").trim(),
    ]
      .filter(Boolean)
      .join("\n");
    assert.equal(
      created.status,
      0,
      `FFmpeg candidate fixture creation failed: ${creationDetails || `exit code ${String(created.status)}`}`,
    );

    const mediaId = randomUUID();
    const bytes = await readFile(sourcePath);
    assets.push(
      socialMediaAssetSchema.parse({
        mediaId,
        accountId,
        sourceKind: "local-file",
        originalName: fixture.originalName,
        mediaKind: "video",
        extension: ".mp4",
        mimeType: "video/mp4",
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        importedAt,
        sourceDurationSeconds: 35,
        ...(fixture.transcript ? { transcript: fixture.transcript } : {}),
      }),
    );
  }

  const mediaRoot = join(dataBaseDir, ".social-harness", "v1", "social-media");
  const catalogPath = join(mediaRoot, "catalog.json");
  let catalog = { version: 1, assets: [], jobs: [] };
  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  catalog.assets.push(...assets);
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });

  const originalDirectory = join(mediaRoot, "originals", accountId);
  await mkdir(originalDirectory, { recursive: true });
  for (const [index, asset] of assets.entries()) {
    const fixture = fixtureSpecs[index];
    assert.ok(fixture);
    const bytes = await readFile(join(fixtureDirectory, fixture.fileName));
    const originalPath = join(originalDirectory, `${asset.mediaId}.mp4`);
    await writeFile(originalPath, bytes, { mode: 0o600 });
    assert.equal((await stat(originalPath)).size, bytes.byteLength);
  }

  return assets.map(({ mediaId, originalName }) => ({ mediaId, originalName }));
}
