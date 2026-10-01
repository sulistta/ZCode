import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { socialMediaAssetSchema } from "@social-harness/shared";
import {
  verifyTimelineMediaClipTrimming,
  verifyTimelineClipTrimming,
  verifyTimelineMediaClipMoveSnapping,
  verifyTimelineRulerViewport,
} from "./socialProjectTimelineE2E.mjs";

function numberField(page, label) {
  return page.getByRole("spinbutton", { name: label, exact: true });
}

function transitionField(effects, direction) {
  return effects
    .locator("label")
    .filter({ hasText: `Transition ${direction}` })
    .locator("select");
}

export async function seedSocialProjectVideoAsset(dataBaseDir, accountName, ffmpegExecutable) {
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
  const sourcePath = join(fixtureDirectory, "trim-test-footage.mp4");
  await mkdir(fixtureDirectory, { recursive: true });
  const created = spawnSync(
    ffmpegExecutable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x17324d:s=320x320:r=30:d=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000:duration=5",
      "-shortest",
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
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(created.status, 0, created.stderr.toString());

  const mediaId = randomUUID();
  const originalName = "Trim test footage.mp4";
  const importedAt = Date.now();
  const bytes = await readFile(sourcePath);
  const asset = socialMediaAssetSchema.parse({
    mediaId,
    accountId,
    sourceKind: "local-file",
    originalName,
    mediaKind: "video",
    extension: ".mp4",
    mimeType: "video/mp4",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    importedAt,
    sourceDurationSeconds: 5,
  });
  const mediaRoot = join(dataBaseDir, ".social-harness", "v1", "social-media");
  const originalDirectory = join(mediaRoot, "originals", accountId);
  const originalPath = join(originalDirectory, `${mediaId}.mp4`);

  const catalogPath = join(mediaRoot, "catalog.json");
  let catalog = { version: 1, assets: [], jobs: [] };
  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  catalog.assets.push(asset);
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  // The library may prune uncatalogued files while this fixture is being seeded.
  await mkdir(originalDirectory, { recursive: true });
  await writeFile(originalPath, bytes, { mode: 0o600 });
  const managedInfo = await stat(originalPath);
  assert.equal(managedInfo.size, bytes.byteLength);
  return { mediaId, originalName };
}

export async function createProjectMotionInElectron(page, runId, mediaFixture) {
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Player", exact: true }).waitFor();

  const projectName = `Motion smoke ${runId}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("button", { name: projectName }).waitFor();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();

  const projectEditor = page.getByTestId("social-project-editor");
  const revisionBeforeSettings = Number(await projectEditor.getAttribute("data-project-revision"));
  await page.getByLabel("Width (pixels)").fill("640");
  await page.getByLabel("Height (pixels)").fill("640");
  assert.equal(await page.getByLabel("Width (pixels)").inputValue(), "640");
  assert.equal(await page.getByLabel("Height (pixels)").inputValue(), "640");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.waitForFunction((previousRevision) => {
    const editor = document.querySelector('[data-testid="social-project-editor"]');
    return Number(editor?.getAttribute("data-project-revision")) > previousRevision;
  }, revisionBeforeSettings);
  assert.equal(await page.getByLabel("Width (pixels)").inputValue(), "640");
  assert.equal(await page.getByLabel("Height (pixels)").inputValue(), "640");
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();

  await page.getByLabel("Track name").fill("Captions");
  await page.getByLabel("Track type").selectOption("text");
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByTitle("Captions").waitFor();

  await page.getByLabel("Overlay text").fill("A persistent animated caption");
  await numberField(page, "Duration (seconds)").fill("5");
  await page.getByRole("button", { name: "Add clip", exact: true }).click();
  const textClip = page
    .locator("[data-social-timeline-clip]")
    .filter({ hasText: "A persistent animated caption" });
  const textClipId = await textClip.getAttribute("data-social-timeline-clip");
  assert.ok(textClipId, "Expected the animated caption clip on the timeline");
  const effects = page.getByTestId(`social-project-clip-effects-${textClipId}`);
  await effects.waitFor();
  await effects.locator("summary").click();

  await numberField(page, "X (pixels)").fill("24");
  await numberField(page, "Y (pixels)").fill("-12");
  await numberField(page, "Scale X").fill("1.25");
  await numberField(page, "Scale Y").fill("0.9");
  await numberField(page, "Rotation (degrees)").fill("12");
  await numberField(page, "Opacity").fill("0.9");
  await transitionField(effects, "in").selectOption("fade");
  await numberField(page, "Transition in duration (seconds)").fill("0.5");
  await transitionField(effects, "out").selectOption("dissolve");
  await numberField(page, "Transition out duration (seconds)").fill("0.75");
  await page.getByLabel("New keyframe property").selectOption("x");
  await numberField(page, "New keyframe time (seconds)").fill("1.5");
  await numberField(page, "New keyframe value").fill("80");
  await page.getByLabel("New keyframe easing").selectOption("ease-out");
  await page.getByRole("button", { name: "Add keyframe", exact: true }).click();
  await page.getByRole("button", { name: "Save motion and transitions", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  assert.equal(await numberField(page, "X (pixels)").inputValue(), "24");
  assert.equal(await numberField(page, "Keyframe 1 value").inputValue(), "80");
  assert.equal(await transitionField(effects, "in").inputValue(), "fade");
  await verifyTimelineClipTrimming(page);
  await page.getByLabel("Track name").fill("Footage");
  await page.getByLabel("Track type").selectOption("video");
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByTitle("Footage").waitFor();
  await page.getByLabel("Library source").selectOption(mediaFixture.mediaId);
  await page.getByRole("button", { name: "Add clip", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  const mediaClipId = await verifyTimelineMediaClipTrimming(page, mediaFixture.originalName);
  await verifyTimelineMediaClipMoveSnapping(page, textClipId, mediaClipId);
  await verifyTimelineRulerViewport(page);
  const mediaClip = page.locator(`[data-social-timeline-clip="${mediaClipId}"]`);
  await mediaClip.scrollIntoViewIfNeeded();
  await mediaClip.click();
  const mediaActions = page.getByTestId(`social-project-clip-actions-${mediaClipId}`);
  const revisionBeforeVolume = Number(await projectEditor.getAttribute("data-project-revision"));
  await numberField(mediaActions, "Volume").fill("0.5");
  await mediaActions.getByRole("button", { name: "Save clip changes", exact: true }).click();
  await page.waitForFunction((previousRevision) => {
    const editor = document.querySelector('[data-testid="social-project-editor"]');
    return Number(editor?.getAttribute("data-project-revision")) > previousRevision;
  }, revisionBeforeVolume);
  assert.equal(await numberField(mediaActions, "Volume").inputValue(), "0.5");
  return { textClipId, mediaClipId };
}

export async function verifyProjectMotionAfterRelaunch(
  page,
  runId,
  clipIds,
  captionText = "A persistent animated caption",
) {
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Player", exact: true }).waitFor();
  const projectName = `Motion smoke ${runId}`;
  await page.getByRole("button", { name: projectName }).click();
  const textClip = page.locator(`[data-social-timeline-clip="${clipIds.textClipId}"]`);
  await textClip.waitFor();
  await textClip.click();
  const clipActions = page.getByTestId(`social-project-clip-actions-${clipIds.textClipId}`);
  assert.equal(
    await clipActions.getByRole("textbox", { name: "Overlay text" }).inputValue(),
    captionText,
  );
  const effects = page.getByTestId(`social-project-clip-effects-${clipIds.textClipId}`);
  await effects.waitFor();
  await clipActions.waitFor();
  const persistedTimelineStart = Number(
    await numberField(clipActions, "Move to (seconds)").inputValue(),
  );
  const persistedClipDuration = Number(
    await numberField(clipActions, "Duration (seconds)").inputValue(),
  );
  assert.ok(persistedTimelineStart > 0, "Keyboard start trim should survive Electron relaunch");
  assert.ok(
    persistedTimelineStart + persistedClipDuration < 5,
    "Pointer end trim should survive Electron relaunch",
  );
  const mediaActions = page.getByTestId(`social-project-clip-actions-${clipIds.mediaClipId}`);
  const mediaSourceStart = Number(
    await numberField(mediaActions, "Source in (seconds)").inputValue(),
  );
  const mediaSourceEnd = Number(
    await numberField(mediaActions, "Source out (seconds)").inputValue(),
  );
  const mediaTimelineStart = Number(
    await numberField(mediaActions, "Move to (seconds)").inputValue(),
  );
  assert.ok(mediaSourceStart > 0, "Media keyboard start trim should survive Electron relaunch");
  assert.ok(mediaSourceEnd < 5, "Media pointer end trim should survive Electron relaunch");
  assert.ok(
    Math.abs(mediaTimelineStart - (persistedTimelineStart + persistedClipDuration)) <= 0.001,
    "Nearest-edge timeline move should survive Electron relaunch",
  );
  await effects.locator("summary").click();

  assert.equal(await numberField(page, "X (pixels)").inputValue(), "24");
  assert.equal(await numberField(page, "Y (pixels)").inputValue(), "-12");
  assert.equal(await page.getByLabel("Width (pixels)").inputValue(), "640");
  assert.equal(await page.getByLabel("Height (pixels)").inputValue(), "640");
  assert.equal(await numberField(page, "Scale X").inputValue(), "1.25");
  assert.equal(await numberField(page, "Scale Y").inputValue(), "0.9");
  assert.equal(await numberField(page, "Rotation (degrees)").inputValue(), "12");
  assert.equal(await numberField(page, "Opacity").inputValue(), "0.9");
  assert.equal(await numberField(page, "Keyframe 1 time (seconds)").inputValue(), "1.5");
  assert.equal(await numberField(page, "Keyframe 1 value").inputValue(), "80");
  assert.equal(await page.getByLabel("Keyframe 1 easing").inputValue(), "ease-out");
  assert.equal(await transitionField(effects, "in").inputValue(), "fade");
  assert.equal(await numberField(page, "Transition in duration (seconds)").inputValue(), "0.5");
  assert.equal(await transitionField(effects, "out").inputValue(), "dissolve");
  assert.equal(await numberField(page, "Transition out duration (seconds)").inputValue(), "0.75");

  const mediaClip = page.locator(`[data-social-timeline-clip="${clipIds.mediaClipId}"]`);
  await mediaClip.scrollIntoViewIfNeeded();
  await mediaClip.click();
  assert.equal(await numberField(mediaActions, "Volume").inputValue(), "0.5");
}
