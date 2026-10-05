import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSocialMediaFileStore } from "../../services/src/social-media/adapters/socialMediaFileStore.js";

let persistedFixture;

function run(executable, args) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`Fixture binary failed: ${code}`)),
    );
  });
}

export async function verifyOnDemandPreviewProxyInElectron(page, options) {
  const root = join(options.dataBaseDir, ".social-harness", "v1");
  const accounts = JSON.parse(
    await readFile(join(root, "social-accounts", "accounts.json"), "utf8"),
  );
  const account = accounts.find((item) => item.displayName === options.firstAccountName);
  assert.ok(account);
  const mediaRoot = join(root, "social-media");
  const catalogPath = join(mediaRoot, "catalog.json");
  const store = createSocialMediaFileStore({
    catalogPath,
    originalsDir: join(mediaRoot, "originals"),
  });
  assert.equal(
    (await store.listJobs(account.accountId)).some((job) => job.sourceKind === "preview-proxy"),
    false,
    "Compatible footage must not transcode on import/playback",
  );
  const fixtureDir = join(options.dataBaseDir, "proxy-fixture");
  await mkdir(fixtureDir, { recursive: true });
  const sourcePath = join(fixtureDir, "incompatible-original.avi");
  await run(options.ffmpegExecutable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x240:r=25:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=4",
    "-c:v",
    "ffv1",
    "-c:a",
    "pcm_s16le",
    "-shortest",
    "-y",
    sourcePath,
  ]);
  const originalBytes = await readFile(sourcePath);
  const originalHash = createHash("sha256").update(originalBytes).digest("hex");
  const asset = await store.importLocalFile({
    accountId: account.accountId,
    mediaId: randomUUID(),
    sourcePath,
    importedAt: Date.now(),
  });
  await page.getByRole("button", { name: "Player", exact: true }).click();
  const projectName = `Proxy smoke ${options.runId}`;
  // 已选项目的编辑器也有同名字段；创建命令只能填写新项目表单，不能全局匹配。
  await page.getByPlaceholder("New Reel", { exact: true }).fill(projectName);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("button", { name: projectName }).waitFor();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  const editor = page.getByTestId("social-project-editor");
  const beforeSettings = Number(await editor.getAttribute("data-project-revision"));
  await page.getByLabel("Width (pixels)", { exact: true }).fill("320");
  await page.getByLabel("Height (pixels)", { exact: true }).fill("240");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.waitForFunction(
    (revision) =>
      Number(
        document
          .querySelector('[data-testid="social-project-editor"]')
          ?.getAttribute("data-project-revision"),
      ) > revision,
    beforeSettings,
  );
  await page.getByLabel("Track name", { exact: true }).fill("Compatibility video");
  await page.getByLabel("Track type").selectOption("video");
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByTitle("Compatibility video", { exact: true }).waitFor();
  await page.getByLabel("Library source").selectOption(asset.mediaId);
  await page.getByLabel("Source out (seconds)").fill("4");
  await page.getByRole("button", { name: "Add clip", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-social-timeline-clip]"));
  const revision = await editor.getAttribute("data-project-revision");
  const jobs = page.getByRole("list", { name: "Media processing", exact: true });
  await jobs
    .getByText("Compatible video preview — exports use the original", { exact: true })
    .waitFor({ timeout: 45_000 });
  const deadline = Date.now() + 45_000;
  let stored;
  while (Date.now() < deadline) {
    stored = await store.getAsset(account.accountId, asset.mediaId);
    if (stored?.previewProxy) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(stored?.previewProxy, "Actual decoder failure must complete an FFmpeg proxy job");
  const matching = (await store.listJobs(account.accountId)).filter(
    (job) => job.mediaId === asset.mediaId,
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].state, "completed");
  assert.equal(stored.sha256, originalHash);
  const video = page.getByLabel("Project video clip", { exact: true });
  await page.waitForFunction(
    () => {
      const video = document.querySelector('video[aria-label="Project video clip"]');
      return video?.readyState >= 2 && !video.error;
    },
    undefined,
    { timeout: 30_000 },
  );
  await video.evaluate((element) => {
    element.currentTime = 1.5;
  });
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Project video clip"]');
    return video?.readyState >= 2 && Math.abs(video.currentTime - 1.5) < 0.05;
  });
  assert.equal(await editor.getAttribute("data-project-revision"), revision);
  const originalPath = await store.getManagedOriginalPath(stored);
  const proxyPath = await store.getManagedPreviewProxyPath(stored);
  assert.notEqual(originalPath, proxyPath);
  assert.deepEqual(await readFile(originalPath), originalBytes);

  // 破坏测试代理后仍必须导出成功；证明导出读原始文件，而不是预览缓存或代理路径。
  const { writeFile } = await import("node:fs/promises");
  const proxyBytes = await readFile(proxyPath);
  await writeFile(proxyPath, "invalid fixture proxy");
  try {
    await page.getByRole("button", { name: `Export revision ${revision}`, exact: true }).click();
    await page
      .getByText(`Ready · revision ${revision}`, { exact: true })
      .waitFor({ timeout: 120_000 });
  } finally {
    await writeFile(proxyPath, proxyBytes);
  }
  assert.equal(
    (await store.listJobs(account.accountId)).filter((job) => job.mediaId === asset.mediaId).length,
    1,
  );
  console.log(
    "[social-e2e] on-demand FFv1/AVI decode failure, real H.264/AAC proxy, seeking, immutable original and original-only export verified",
  );
  persistedFixture = {
    projectName,
    mediaId: asset.mediaId,
    accountId: account.accountId,
    catalogPath,
    mediaRoot,
    originalHash,
  };
  return { projectName, mediaId: asset.mediaId, accountId: account.accountId };
}

export async function verifyPreviewProxyAfterRelaunch(page) {
  assert.ok(persistedFixture, "The initial proxy scenario must complete before relaunch");
  const { projectName, mediaId, accountId, catalogPath, mediaRoot, originalHash } =
    persistedFixture;
  const store = createSocialMediaFileStore({
    catalogPath,
    originalsDir: join(mediaRoot, "originals"),
  });
  const asset = await store.getAsset(accountId, mediaId);
  assert.ok(asset?.previewProxy);
  assert.equal(asset.sha256, originalHash);
  await store.getManagedPreviewProxyPath(asset);
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: projectName }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Project video clip"]');
    return video?.readyState >= 2 && !video.error;
  });
  const jobs = (await store.listJobs(accountId)).filter((job) => job.mediaId === mediaId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, "completed");
  console.log(
    "[social-e2e] persisted proxy playback after Electron relaunch verified without another conversion",
  );
}
