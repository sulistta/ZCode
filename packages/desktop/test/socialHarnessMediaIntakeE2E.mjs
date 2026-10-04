import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fakeYtDlpSourcePath = fileURLToPath(
  new URL("./fixtures/socialHarnessFakeYtDlp.mjs", import.meta.url),
);
const localSourceBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SUsAAAAASUVORK5CYII=",
  "base64",
);

export async function prepareSocialHarnessMediaIntakeFixtures(testRoot) {
  const fixtureDirectory = join(testRoot, "media-intake-fixtures");
  await mkdir(fixtureDirectory, { recursive: true });
  const localSourcePath = join(fixtureDirectory, "Original interview sample.png");
  const ytDlpPath = join(fixtureDirectory, "fake-yt-dlp.mjs");
  await writeFile(localSourcePath, localSourceBytes);
  await copyFile(fakeYtDlpSourcePath, ytDlpPath);
  return {
    localSourcePath,
    pickerResponses: JSON.stringify([[], [localSourcePath]]),
    ytDlpPath,
    localOriginalName: "Original interview sample.png",
    youtubeVideoId: "SHE2E000001",
    youtubeOriginalName: "Local fake YouTube video.mp4",
    youtubeTitle: "Local fake YouTube video",
    remoteSourceUrl: "https://media.example.test/interview.mp4",
    remoteOriginalName: "Local fake HTTPS source.mp4",
    searchQuery: "source intake fixture",
    transcriptText: "This caption came from the local fake yt-dlp fixture.",
  };
}

async function readCatalog(dataBaseDir) {
  const catalogPath = join(dataBaseDir, ".social-harness", "v1", "social-media", "catalog.json");
  try {
    return JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, assets: [], jobs: [] };
    }
    throw error;
  }
}

async function waitForCatalogJob(dataBaseDir, videoId, expectedState) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const catalog = await readCatalog(dataBaseDir);
    const job = catalog.jobs.find((item) => item.sourceVideoId === videoId);
    if (job?.state === expectedState) return { catalog, job };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("The YouTube job did not reach " + expectedState);
}

async function waitForCatalogSourceUrlJob(dataBaseDir, sourceUrl, expectedState) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const catalog = await readCatalog(dataBaseDir);
    const job = catalog.jobs.find((item) => item.sourceUrl === sourceUrl);
    if (job?.state === expectedState) return { catalog, job };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("The HTTPS source job did not reach " + expectedState);
}

export async function exerciseSocialHarnessMediaIntake(page, dataBaseDir, accountName, fixtures) {
  const storageRoot = join(dataBaseDir, ".social-harness", "v1");
  const accountsPath = join(storageRoot, "social-accounts", "accounts.json");
  const accounts = JSON.parse(await readFile(accountsPath, "utf8"));
  const account = accounts.find((entry) => entry.displayName === accountName);
  assert.ok(account?.accountId, "Expected the saved account for Library intake");
  const accountId = account.accountId;
  const sourceBytesBefore = await readFile(fixtures.localSourcePath);
  const sourceStatBefore = await stat(fixtures.localSourcePath);

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Bring in your first source", exact: true }).waitFor();
  await page.getByRole("button", { name: "Import files", exact: true }).first().click();
  await page.getByRole("heading", { name: "Bring in your first source", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: fixtures.localOriginalName }).count(), 0);
  let catalog = await readCatalog(dataBaseDir);
  assert.equal(catalog.assets.length, 0, "Cancelling the native picker must leave no asset");
  assert.equal(catalog.jobs.length, 0);

  await page.getByRole("button", { name: "Import files", exact: true }).first().click();
  await page.getByRole("heading", { name: fixtures.localOriginalName, exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Imported 1 file(s)." }).waitFor();
  catalog = await readCatalog(dataBaseDir);
  const localAsset = catalog.assets.find(
    (asset) => asset.originalName === fixtures.localOriginalName,
  );
  assert.ok(localAsset, "The selected source must be copied into the Library");
  assert.equal(localAsset.accountId, accountId);
  assert.equal(localAsset.sourceKind, "local-file");
  assert.equal(localAsset.sizeBytes, sourceBytesBefore.byteLength);
  assert.equal(localAsset.sha256, createHash("sha256").update(sourceBytesBefore).digest("hex"));
  assert.equal("sourcePath" in localAsset, false);
  const managedSourcePath = join(
    storageRoot,
    "social-media",
    "originals",
    accountId,
    localAsset.mediaId + localAsset.extension,
  );
  assert.deepEqual(await readFile(managedSourcePath), sourceBytesBefore);
  assert.deepEqual(await readFile(fixtures.localSourcePath), sourceBytesBefore);
  assert.equal((await stat(fixtures.localSourcePath)).mtimeMs, sourceStatBefore.mtimeMs);
  assert.equal(catalog.jobs.length, 0);

  const searchInput = page.getByLabel("Search videos on YouTube", { exact: true });
  await searchInput.fill(fixtures.searchQuery);
  const searchForm = page.locator("form").filter({ has: searchInput });
  await searchForm.getByRole("button", { name: "Search", exact: true }).click();
  const results = page.getByRole("list", { name: "YouTube search results", exact: true });
  await results.getByRole("link", { name: "Fixture search result 1", exact: true }).waitFor();
  assert.equal(await results.getByRole("listitem").count(), 10);
  assert.equal(
    await page.getByRole("link", { name: "Fixture search result 11", exact: true }).count(),
    0,
  );
  catalog = await readCatalog(dataBaseDir);
  assert.equal(catalog.assets.length, 1, "YouTube discovery must not import a result");
  assert.equal(catalog.jobs.length, 0, "YouTube discovery must not create a download job");

  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  await page.locator('[data-testid="v4-composer-input"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: fixtures.localOriginalName, exact: true }).waitFor();
  assert.equal(
    await page.getByRole("list", { name: "YouTube search results", exact: true }).count(),
    0,
    "Search results must remain transient when the Library view is reopened",
  );

  const videoUrl = "https://www.youtube.com/watch?v=" + fixtures.youtubeVideoId;
  const urlInput = page.getByLabel("Video URL", { exact: true });
  await urlInput.fill(videoUrl);
  const urlForm = page.locator("form").filter({ has: urlInput });
  await urlForm.getByRole("button", { name: "Add to library", exact: true }).click();
  const jobs = page.getByRole("list", { name: "Media processing", exact: true });
  const jobRow = jobs.getByRole("listitem").filter({ hasText: videoUrl });
  await jobRow.getByText("Processing failed", { exact: true }).waitFor({ timeout: 45_000 });
  const failed = await waitForCatalogJob(dataBaseDir, fixtures.youtubeVideoId, "failed");
  assert.equal(failed.job.accountId, accountId);
  await jobRow.getByRole("button", { name: "Retry", exact: true }).click();
  await jobRow.getByText("Added to library", { exact: true }).waitFor({ timeout: 45_000 });
  await page.getByRole("heading", { name: fixtures.youtubeOriginalName, exact: true }).waitFor();

  const completed = await waitForCatalogJob(dataBaseDir, fixtures.youtubeVideoId, "completed");
  const youtubeAsset = completed.catalog.assets.find(
    (asset) => asset.sourceVideoId === fixtures.youtubeVideoId,
  );
  assert.ok(youtubeAsset, "A successful retry must commit the media asset");
  assert.equal(youtubeAsset.accountId, accountId);
  assert.equal(youtubeAsset.sourceKind, "youtube");
  assert.equal(youtubeAsset.sourceOrigin, "video-url");
  assert.equal(youtubeAsset.sourceTitle, fixtures.youtubeTitle);
  assert.equal(youtubeAsset.sourceUrl, videoUrl);
  assert.equal(youtubeAsset.transcript?.method, "youtube-subtitles");
  assert.equal(youtubeAsset.transcript?.languageCode, "en");
  assert.equal(youtubeAsset.transcript?.segments[0]?.text, fixtures.transcriptText);
  assert.equal(
    Object.values(youtubeAsset).includes(fixtures.localSourcePath),
    false,
    "The local source path must not be persisted in the catalog",
  );

  await urlInput.fill(fixtures.remoteSourceUrl);
  await urlForm.getByRole("button", { name: "Add to library", exact: true }).click();
  const remoteJobRow = jobs.getByRole("listitem").filter({ hasText: fixtures.remoteSourceUrl });
  await remoteJobRow.getByText("Processing failed", { exact: true }).waitFor({ timeout: 45_000 });
  const remoteFailed = await waitForCatalogSourceUrlJob(
    dataBaseDir,
    fixtures.remoteSourceUrl,
    "failed",
  );
  assert.equal(remoteFailed.job.sourceKind, "remote-url");
  assert.equal(remoteFailed.job.sourceVideoId, undefined);
  await remoteJobRow.getByRole("button", { name: "Retry", exact: true }).click();
  await remoteJobRow.getByText("Added to library", { exact: true }).waitFor({ timeout: 45_000 });
  await page.getByRole("heading", { name: fixtures.remoteOriginalName, exact: true }).waitFor();
  const remoteCompleted = await waitForCatalogSourceUrlJob(
    dataBaseDir,
    fixtures.remoteSourceUrl,
    "completed",
  );
  const remoteAsset = remoteCompleted.catalog.assets.find(
    (asset) => asset.mediaId === remoteCompleted.job.mediaId,
  );
  assert.ok(remoteAsset, "A supported HTTPS source must commit its managed media asset");
  assert.equal(remoteAsset.sourceKind, "remote-url");
  assert.equal(remoteAsset.sourceUrl, fixtures.remoteSourceUrl);
  assert.equal(remoteAsset.sourceVideoId, undefined);

  const callLog = await readFile(join(dirname(fixtures.ytDlpPath), "calls.ndjson"), "utf8");
  assert.deepEqual(
    callLog
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [
      { type: "search", query: fixtures.searchQuery },
      { type: "download", videoId: fixtures.youtubeVideoId, attempt: 1, proxy: true },
      { type: "download", videoId: fixtures.youtubeVideoId, attempt: 2, proxy: true },
      { type: "download", sourceKey: remoteCompleted.job.sourceKey, attempt: 1, proxy: true },
      { type: "download", sourceKey: remoteCompleted.job.sourceKey, attempt: 2, proxy: true },
    ],
    "All discovery and download attempts must use the local fake yt-dlp executable",
  );
  return {
    localOriginalName: fixtures.localOriginalName,
    youtubeOriginalName: fixtures.youtubeOriginalName,
    remoteOriginalName: fixtures.remoteOriginalName,
  };
}
