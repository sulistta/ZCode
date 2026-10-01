import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeAudioSegment, measureToneAmplitude } from "./socialProjectAudioE2EUtils.mjs";
import { verifyExportRetainedAfterSaveCancel } from "./socialProjectSaveDialogE2E.mjs";

function runBinary(executable, args, input) {
  const result = spawnSync(executable, args, {
    ...(input ? { input } : {}),
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function getBrightPixelBounds(rgb, width, height) {
  assert.equal(rgb.length, width * height * 3);
  const points = [];
  let intensityTotal = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const red = rgb[offset];
      const green = rgb[offset + 1];
      const blue = rgb[offset + 2];
      if (
        red > 100 &&
        green > 100 &&
        blue > 100 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) < 65
      ) {
        points.push({ x, y });
        intensityTotal += (red + green + blue) / 3;
      }
    }
  }
  assert.ok(points.length > 8, `Expected visible caption pixels, received ${points.length}`);
  return {
    centerX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    centerY: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    width: Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)) + 1,
    height: Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)) + 1,
    meanIntensity: intensityTotal / points.length,
  };
}

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, received ${actual}`,
  );
}

export async function verifyPreviewExportParityInElectron(page, runId, options) {
  const projectName = options.projectName ?? `Motion smoke ${runId}`;
  const captionText = options.captionText ?? "A persistent animated caption";
  const previewFrame = page.getByLabel("Project preview frame", { exact: true });
  const scrubber = page.getByRole("slider", { name: "Project playhead", exact: true });
  const caption = previewFrame.getByText(captionText, { exact: true });
  const projectRevision = Number(
    await page.getByTestId("social-project-editor").getAttribute("data-project-revision"),
  );
  assert.ok(Number.isInteger(projectRevision) && projectRevision > 0);

  await scrubber.focus();
  await scrubber.press("Home");
  for (let step = 0; step < 40; step += 1) {
    await scrubber.press("ArrowRight");
  }
  assert.equal(await scrubber.inputValue(), "2000");
  await page.waitForFunction(() => {
    return document.querySelector('[aria-label="Project playhead"]')?.value === "2000";
  });
  const previewTransform = await caption.getAttribute("style");
  assert.match(
    previewTransform ?? "",
    /translate\(80px, -12px\)/u,
    `Expected the preview caption to use the keyframed position at 2000 ms, received: ${previewTransform}`,
  );

  const previewGeometry = await caption.evaluate((element) => {
    const frame = element.closest('[aria-label="Project preview frame"]');
    if (!frame) throw new Error("The caption must belong to the project preview frame");
    const frameRect = frame.getBoundingClientRect();
    const captionRect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      centerX: (captionRect.left + captionRect.width / 2 - frameRect.left) / frameRect.width,
      centerY: (captionRect.top + captionRect.height / 2 - frameRect.top) / frameRect.height,
      width: captionRect.width / frameRect.width,
      height: captionRect.height / frameRect.height,
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
      opacity: Number(style.opacity),
    };
  });
  const previewSize = {
    width: Math.round(previewGeometry.frameWidth),
    height: Math.round(previewGeometry.frameHeight),
  };

  await page
    .getByRole("button", { name: `Export revision ${projectRevision}`, exact: true })
    .click();
  await page
    .getByText(`Ready · revision ${projectRevision}`, { exact: true })
    .waitFor({ timeout: 120_000 });
  console.log(`[social-e2e] exported revision ${projectRevision}; checking visual parity`);
  const dataRoot = join(options.dataBaseDir, ".social-harness", "v1", "social-projects");
  const storedExports = JSON.parse(await readFile(join(dataRoot, "exports.json"), "utf8"));
  const record = storedExports.exports
    .filter(
      (candidate) =>
        candidate.snapshot.displayName === projectName &&
        candidate.snapshot.revision === projectRevision &&
        candidate.job.status === "completed",
    )
    .sort((left, right) => right.job.createdAt - left.job.createdAt)[0];
  assert.ok(record, `Expected a completed export for ${projectName}`);
  const exportPath = join(dataRoot, "exports", `${record.job.exportId}.mp4`);
  const exportPng = runBinary(options.ffmpegExecutable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "2",
    "-i",
    exportPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${previewSize.width}:${previewSize.height}:flags=lanczos`,
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "pipe:1",
  ]);
  await writeFile(join(options.dataBaseDir, "social-export-parity.png"), exportPng);
  const exportRgb = runBinary(
    options.ffmpegExecutable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    exportPng,
  );

  const exportBounds = getBrightPixelBounds(exportRgb, previewSize.width, previewSize.height);
  assertClose(
    previewGeometry.centerX,
    exportBounds.centerX / previewSize.width,
    0.04,
    `Caption center x at the matching preview/export timestamp: preview=${JSON.stringify(previewGeometry)}, export=${JSON.stringify(exportBounds)}`,
  );
  assertClose(
    previewGeometry.centerY,
    exportBounds.centerY / previewSize.height,
    0.04,
    "Caption center y at the matching preview/export timestamp",
  );
  assertClose(
    previewGeometry.width,
    exportBounds.width / previewSize.width,
    0.14,
    "Caption width at the matching preview/export timestamp",
  );
  assertClose(
    previewGeometry.height,
    exportBounds.height / previewSize.height,
    0.14,
    "Caption height at the matching preview/export timestamp",
  );
  assert.equal(previewGeometry.opacity, 0.9);
  assert.ok(
    exportBounds.meanIntensity / 255 > previewGeometry.opacity * 0.65 &&
      exportBounds.meanIntensity / 255 < previewGeometry.opacity * 1.15,
    `Caption opacity should agree across preview/export: preview=${previewGeometry.opacity}, export=${exportBounds.meanIntensity / 255}`,
  );

  await verifyExportRetainedAfterSaveCancel(page, { dataRoot, exportPath, record });

  console.log(
    `[social-e2e] visual parity passed; sampling active media audio for ${options.mediaClipId}`,
  );
  assert.ok(options.mediaClipId, "Audio parity requires the active video clip id");
  const mediaClip = page.locator(`[data-social-timeline-clip="${options.mediaClipId}"]`);
  await mediaClip.scrollIntoViewIfNeeded();
  await mediaClip.click();
  const mediaActions = page.getByTestId(`social-project-clip-actions-${options.mediaClipId}`);
  const timelineStartSeconds = Number(
    await mediaActions
      .getByRole("spinbutton", { name: "Move to (seconds)", exact: true })
      .inputValue(),
  );
  const sourceStartSeconds = Number(
    await mediaActions
      .getByRole("spinbutton", { name: "Source in (seconds)", exact: true })
      .inputValue(),
  );
  const sourceEndSeconds = Number(
    await mediaActions
      .getByRole("spinbutton", { name: "Source out (seconds)", exact: true })
      .inputValue(),
  );
  const playbackRate = Number(
    await mediaActions.getByRole("spinbutton", { name: "Speed", exact: true }).inputValue(),
  );
  const clipVolume = Number(
    await mediaActions.getByRole("spinbutton", { name: "Volume", exact: true }).inputValue(),
  );
  assert.equal(clipVolume, 0.5, "The preview/export fixture must use an audible non-default gain");
  const clipDurationSeconds = (sourceEndSeconds - sourceStartSeconds) / playbackRate;
  assert.ok(clipDurationSeconds > 2, "The trimmed video fixture must retain a stable audio window");
  const localSampleOffsetSeconds = Math.min(1, clipDurationSeconds / 2);
  const targetPlayheadMs =
    Math.round(((timelineStartSeconds + localSampleOffsetSeconds) * 1000) / 50) * 50;
  const playheadSteps = Math.round(targetPlayheadMs / 50);
  await scrubber.focus();
  await scrubber.press("Home");
  for (let step = 0; step < playheadSteps; step += 1) {
    await scrubber.press("ArrowRight");
  }
  await page.waitForFunction((expected) => {
    return document.querySelector('[aria-label="Project playhead"]')?.value === String(expected);
  }, targetPlayheadMs);

  const previewVideo = previewFrame.locator("video");
  await previewVideo.waitFor({ state: "visible" });
  const expectedSourceTimeSeconds =
    sourceStartSeconds + (targetPlayheadMs / 1000 - timelineStartSeconds) * playbackRate;
  // Chromium更新项目播放头后仍会异步seek并解码本地媒体；不能用播放头已变化推断视频帧已就绪。
  await page.waitForFunction(
    ({ expectedSourceTimeSeconds }) => {
      const element = document.querySelector('[aria-label="Project preview frame"] video');
      return (
        element instanceof HTMLVideoElement &&
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Math.abs(element.currentTime - expectedSourceTimeSeconds) <= 0.15
      );
    },
    { expectedSourceTimeSeconds },
  );
  const previewElement = await previewVideo.evaluate((element) => {
    if (!(element instanceof HTMLVideoElement))
      throw new Error("Expected the active project video");
    return {
      currentTime: element.currentTime,
      readyState: element.readyState,
      volume: element.volume,
      muted: element.muted,
    };
  });
  assert.ok(
    previewElement.readyState >= 2,
    "The active preview frame should be decoded before measuring audio",
  );
  assert.equal(previewElement.volume, clipVolume);
  assert.equal(previewElement.muted, false);
  assertClose(
    previewElement.currentTime,
    expectedSourceTimeSeconds,
    0.15,
    "Preview media source time at the selected project playhead",
  );

  const tapSetup = await previewVideo.evaluate((element) => {
    if (!(element instanceof HTMLVideoElement))
      throw new Error("Expected the active project video");
    const context = new AudioContext();
    const source = context.createMediaElementSource(element);
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    const silentSink = context.createGain();
    silentSink.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentSink);
    silentSink.connect(context.destination);
    const playButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Play",
    );
    if (!playButton) throw new Error("Expected the paused project preview Play button");
    playButton.addEventListener("click", () => void context.resume(), { once: true });
    window.__socialHarnessPreviewAudioTap = {
      context,
      analyser,
      element,
      initialTime: element.currentTime,
    };
    return {
      sampleRate: context.sampleRate,
      fftSize: analyser.fftSize,
      initialTime: element.currentTime,
    };
  });
  console.log(
    `[social-e2e] preview audio tap ready at source time ${tapSetup.initialTime.toFixed(3)}s; clicking Play`,
  );
  await page.getByRole("button", { name: "Play", exact: true }).click();
  let previewAudio;
  try {
    await page.waitForFunction(
      () => {
        const tap = window.__socialHarnessPreviewAudioTap;
        return (
          tap?.context?.state === "running" &&
          !tap.element.paused &&
          tap.element.currentTime > tap.initialTime + 0.25
        );
      },
      undefined,
      { timeout: 5_000 },
    );
    previewAudio = await page.evaluate(() => {
      const tap = window.__socialHarnessPreviewAudioTap;
      const samples = new Float32Array(tap.analyser.fftSize);
      tap.analyser.getFloatTimeDomainData(samples);
      return {
        samples: Array.from(samples),
        sampleRate: tap.context.sampleRate,
        currentTime: tap.element.currentTime,
        playheadMs: Number(document.querySelector('[aria-label="Project playhead"]')?.value),
        volume: tap.element.volume,
        muted: tap.element.muted,
      };
    });
  } finally {
    await page
      .getByRole("button", { name: "Pause", exact: true })
      .click()
      .catch(() => undefined);
    await page.evaluate(async () => {
      const tap = window.__socialHarnessPreviewAudioTap;
      if (tap?.context && tap.context.state !== "closed") await tap.context.close();
      delete window.__socialHarnessPreviewAudioTap;
    });
  }
  assert.ok(previewAudio, "Expected to sample the active Electron preview audio");
  assert.equal(previewAudio.muted, false);
  assert.equal(previewAudio.volume, clipVolume);

  const audioWindowSeconds = tapSetup.fftSize / tapSetup.sampleRate;
  const sourceWindowStartSeconds = Math.max(0, previewAudio.currentTime - audioWindowSeconds);
  const projectWindowStartSeconds =
    timelineStartSeconds + (sourceWindowStartSeconds - sourceStartSeconds) / playbackRate;
  const sourceFixturePath = join(options.dataBaseDir, "e2e-fixtures", "trim-test-footage.mp4");
  const sourceSamples = decodeAudioSegment(
    options.ffmpegExecutable,
    sourceFixturePath,
    sourceWindowStartSeconds,
    audioWindowSeconds,
    previewAudio.sampleRate,
  );
  const previewSamples = new Float32Array(previewAudio.samples);
  const exportSamples = decodeAudioSegment(
    options.ffmpegExecutable,
    exportPath,
    projectWindowStartSeconds,
    audioWindowSeconds,
    previewAudio.sampleRate,
  );
  const sourceToneAmplitude = measureToneAmplitude(sourceSamples, previewAudio.sampleRate, 880);
  const previewTapAmplitude = measureToneAmplitude(previewSamples, previewAudio.sampleRate, 880);
  const exportToneAmplitude = measureToneAmplitude(exportSamples, previewAudio.sampleRate, 880);
  console.log(
    `[social-e2e] audio tone amplitudes source=${sourceToneAmplitude.toFixed(4)} preview=${previewTapAmplitude.toFixed(4)} export=${exportToneAmplitude.toFixed(4)} at project ${projectWindowStartSeconds.toFixed(3)}s`,
  );
  assert.ok(sourceToneAmplitude > 0.005, "Synthetic source should contain an 880 Hz tone");
  assert.ok(previewTapAmplitude > 0.005, "The active Electron preview should emit the source tone");
  const previewTapRatio = previewTapAmplitude / sourceToneAmplitude;
  let expectedPreviewToneAmplitude;
  if (previewTapRatio >= clipVolume * 0.7 && previewTapRatio <= clipVolume * 1.3) {
    expectedPreviewToneAmplitude = previewTapAmplitude;
  } else {
    assert.ok(
      previewTapRatio >= 0.7 && previewTapRatio <= 1.3,
      `Preview audio tap should expose the source tone with or without native element gain: source=${sourceToneAmplitude}, preview=${previewTapAmplitude}, ratio=${previewTapRatio}`,
    );
    expectedPreviewToneAmplitude = previewTapAmplitude * clipVolume;
  }
  const audioParityRatio = exportToneAmplitude / expectedPreviewToneAmplitude;
  assert.ok(
    audioParityRatio >= 0.7 && audioParityRatio <= 1.3,
    `Preview/export audio should agree at the mapped project timestamp: source=${sourceToneAmplitude}, preview=${previewTapAmplitude}, volume=${clipVolume}, export=${exportToneAmplitude}, ratio=${audioParityRatio}, projectTime=${projectWindowStartSeconds}`,
  );
}
