import assert from "node:assert/strict";

function numberField(page, label) {
  return page.getByRole("spinbutton", { name: label, exact: true });
}

export async function verifyTimelineRulerViewport(page) {
  const viewport = page.getByTestId("social-project-timeline-viewport");
  const marks = page.getByTestId("social-project-ruler-marks");
  const trackLabel = page.getByTestId("social-project-track-label").first();
  const editor = page.getByTestId("social-project-editor");
  const zoom = page.locator("#social-project-timeline-zoom");
  const initialZoomSliderValue = await zoom.inputValue();
  const initialMinZoom = Number(await viewport.getAttribute("data-social-timeline-min-zoom"));
  const initialRevision = Number(await editor.getAttribute("data-project-revision"));

  try {
    await zoom.focus();
    await zoom.press("End");
    await page.waitForFunction(
      () => document.querySelector("#social-project-timeline-zoom")?.value === "100",
    );
    await viewport.evaluate((element) => {
      element.style.width = "320px";
      element.style.maxWidth = "320px";
    });
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-testid="social-project-timeline-viewport"]');
      return element instanceof HTMLElement && element.scrollWidth > element.clientWidth;
    });
    await page.waitForFunction((previousMinZoom) => {
      const element = document.querySelector('[data-testid="social-project-timeline-viewport"]');
      return (
        element instanceof HTMLElement &&
        element.clientWidth >= 300 &&
        element.clientWidth <= 320 &&
        Number(element.getAttribute("data-social-timeline-min-zoom")) < previousMinZoom
      );
    }, initialMinZoom);
    const narrowMinZoom = Number(await viewport.getAttribute("data-social-timeline-min-zoom"));
    assert.ok(
      narrowMinZoom < initialMinZoom,
      `Expected a narrower viewport to lower the minimum zoom: ${JSON.stringify({ initialMinZoom, narrowMinZoom })}`,
    );

    await zoom.focus();
    await zoom.press("Home");
    await page.waitForFunction(
      () => document.querySelector("#social-project-timeline-zoom")?.value === "0",
    );
    const narrowMinimumZoomPadding = Number(
      await viewport.getAttribute("data-social-timeline-padding-px"),
    );
    const narrowScrollableWidth = (await viewport.evaluate((element) => element.clientWidth)) - 88;
    assert.ok(
      Math.abs(narrowMinimumZoomPadding - narrowScrollableWidth * 0.75) <= 2,
      `Expected 75% trailing padding at minimum zoom: ${JSON.stringify({ narrowMinimumZoomPadding, narrowScrollableWidth })}`,
    );

    await viewport.evaluate((element) => {
      element.style.width = "";
      element.style.maxWidth = "";
    });
    await page.waitForFunction((previousMinZoom) => {
      const element = document.querySelector('[data-testid="social-project-timeline-viewport"]');
      const zoom = document.querySelector("#social-project-timeline-zoom");
      return (
        element instanceof HTMLElement &&
        element.clientWidth > 320 &&
        Number(element.getAttribute("data-social-timeline-min-zoom")) > previousMinZoom &&
        zoom instanceof HTMLInputElement &&
        zoom.value === "0"
      );
    }, narrowMinZoom);
    const widenedMinZoom = Number(await viewport.getAttribute("data-social-timeline-min-zoom"));
    assert.equal(
      await zoom.getAttribute("aria-valuetext"),
      `${widenedMinZoom.toFixed(1)}×`,
      "A wider viewport must clamp the current zoom and keep the slider at its new minimum",
    );
    const scrollableWidth = (await viewport.evaluate((element) => element.clientWidth)) - 88;
    const minimumZoomPadding = Number(
      await viewport.getAttribute("data-social-timeline-padding-px"),
    );
    assert.ok(
      Math.abs(minimumZoomPadding - scrollableWidth * 0.75) <= 2,
      `Expected 75% trailing padding after the minimum zoom is clamped: ${JSON.stringify({ minimumZoomPadding, scrollableWidth })}`,
    );

    await zoom.press("End");
    await page.waitForFunction(
      () => document.querySelector("#social-project-timeline-zoom")?.value === "100",
    );
    const maximumZoomPadding = Number(
      await viewport.getAttribute("data-social-timeline-padding-px"),
    );
    assert.ok(
      Math.abs(maximumZoomPadding - scrollableWidth * 0.15) <= 2,
      `Expected 15% trailing padding at maximum zoom: ${JSON.stringify({ maximumZoomPadding, scrollableWidth })}`,
    );
    assert.ok(
      maximumZoomPadding < minimumZoomPadding,
      "Trailing ruler padding should contract as zoom increases",
    );

    await viewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-testid="social-project-ruler-marks"]');
      return Number(element?.getAttribute("data-start-tick-index")) > 0;
    });

    const labelBounds = await trackLabel.boundingBox();
    const viewportBounds = await viewport.boundingBox();
    assert.ok(labelBounds, "Expected a track name to remain rendered after horizontal scrolling");
    assert.ok(viewportBounds, "Expected the timeline viewport to remain rendered");
    assert.ok(
      Math.abs(labelBounds.x - (viewportBounds.x + 1)) <= 2,
      `Expected the track-name column to stay pinned to the viewport: ${JSON.stringify({ labelBounds, viewportBounds })}`,
    );

    const metrics = await marks.evaluate((element) => ({
      start: Number(element.getAttribute("data-start-tick-index")),
      end: Number(element.getAttribute("data-end-tick-index")),
      total: Number(element.getAttribute("data-total-tick-count")),
      rendered: element.querySelectorAll("[data-social-ruler-tick]").length,
      lastRenderedTime: Math.max(
        ...[...element.querySelectorAll("[data-social-ruler-tick]")].map((tick) =>
          Number(tick.getAttribute("data-time-seconds")),
        ),
      ),
    }));
    assert.ok(
      metrics.start > 0,
      `Expected off-screen left ticks to be virtualized: ${JSON.stringify(metrics)}`,
    );
    assert.ok(
      metrics.end >= metrics.start,
      `Expected a contiguous tick window: ${JSON.stringify(metrics)}`,
    );
    assert.ok(
      metrics.rendered < metrics.total,
      `Expected fewer mounted than total ticks: ${JSON.stringify(metrics)}`,
    );
    assert.ok(
      metrics.lastRenderedTime >= 4,
      `Expected ticks near the scrolled end: ${JSON.stringify(metrics)}`,
    );
    assert.equal(
      Number(await editor.getAttribute("data-project-revision")),
      initialRevision,
      "Changing timeline viewport and zoom must not change the accepted project revision",
    );
  } finally {
    await viewport.evaluate((element) => {
      element.scrollLeft = 0;
      element.style.width = "";
      element.style.maxWidth = "";
    });
    await zoom.evaluate((element, value) => {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, initialZoomSliderValue);
  }
}

export async function verifyTimelineClipTrimming(page) {
  const editor = page.getByTestId("social-project-editor");
  const trimStart = page.getByRole("button", {
    name: "Trim start of A persistent animated caption",
    exact: true,
  });
  const trimEnd = page.getByRole("button", {
    name: "Trim end of A persistent animated caption",
    exact: true,
  });
  const clipActions = page.locator('[data-testid^="social-project-clip-actions-"]').first();
  const timelineStart = numberField(clipActions, "Move to (seconds)");
  const duration = numberField(clipActions, "Duration (seconds)");
  const revision = async () => Number(await editor.getAttribute("data-project-revision"));
  const waitForRevision = (expectedRevision) =>
    page.waitForFunction(
      (expected) =>
        Number(
          document
            .querySelector('[data-testid="social-project-editor"]')
            ?.getAttribute("data-project-revision"),
        ) === expected,
      expectedRevision,
    );

  const beforeKeyboardTrim = await revision();
  await trimStart.scrollIntoViewIfNeeded();
  await trimStart.press("ArrowRight");
  await waitForRevision(beforeKeyboardTrim + 1);
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  await page.waitForFunction(() => {
    const actions = document.querySelector('[data-testid^="social-project-clip-actions-"]');
    const values = [...(actions?.querySelectorAll("label") ?? [])].map(
      (label) => label.querySelector("input")?.value,
    );
    return values.includes("0.033") && values.includes("4.967");
  });
  const startAfterKeyboard = Number(await timelineStart.inputValue());
  const durationAfterKeyboard = Number(await duration.inputValue());
  assert.ok(startAfterKeyboard > 0, "Start handle should advance by one project frame");
  assert.ok(durationAfterKeyboard < 5, "Start trim should shorten the text clip");
  assert.ok(
    Math.abs(startAfterKeyboard + durationAfterKeyboard - 5) <= 0.002,
    "Start trim should preserve the clip's end",
  );

  const beforeCancel = await revision();
  const durationBeforeCancel = await duration.inputValue();
  await trimEnd.scrollIntoViewIfNeeded();
  const cancelBounds = await trimEnd.boundingBox();
  assert.ok(cancelBounds, "End trim handle should be visible");
  const cancelX = cancelBounds.x + cancelBounds.width / 2;
  const cancelY = cancelBounds.y + cancelBounds.height / 2;
  await page.mouse.move(cancelX, cancelY);
  await page.mouse.down();
  await page.mouse.move(cancelX - 12, cancelY, { steps: 2 });
  await trimEnd.dispatchEvent("pointercancel", { bubbles: true, cancelable: true });
  await page.mouse.up();
  assert.equal(await revision(), beforeCancel, "Cancelling a trim must not commit a revision");
  assert.equal(await duration.inputValue(), durationBeforeCancel);

  const beforePointerTrim = await revision();
  await trimEnd.scrollIntoViewIfNeeded();
  const trimBounds = await trimEnd.boundingBox();
  assert.ok(trimBounds, "End trim handle should be visible after cancellation");
  const trimX = trimBounds.x + trimBounds.width / 2;
  const trimY = trimBounds.y + trimBounds.height / 2;
  await page.mouse.move(trimX, trimY);
  await page.mouse.down();
  await page.mouse.move(trimX - 12, trimY, { steps: 2 });
  await page.mouse.up();
  await waitForRevision(beforePointerTrim + 1);
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  await page.waitForFunction((previousDuration) => {
    const actions = document.querySelector('[data-testid^="social-project-clip-actions-"]');
    const duration = [...(actions?.querySelectorAll("label") ?? [])]
      .find((label) => label.textContent?.includes("Duration (seconds)"))
      ?.querySelector("input")?.value;
    return Number(duration) < Number(previousDuration);
  }, durationBeforeCancel);
  assert.ok(
    Number(await duration.inputValue()) < Number(durationBeforeCancel),
    "Pointer end trim should shorten the text clip",
  );
}

export async function verifyTimelineMediaClipTrimming(page, clipName) {
  const editor = page.getByTestId("social-project-editor");
  const mediaClip = page.locator("[data-social-timeline-clip]").filter({ hasText: clipName });
  const clipId = await mediaClip.getAttribute("data-social-timeline-clip");
  assert.ok(clipId, `Expected the ${clipName} clip to appear on the timeline`);
  const clipActions = page.getByTestId(`social-project-clip-actions-${clipId}`);
  const sourceStart = numberField(clipActions, "Source in (seconds)");
  const sourceEnd = numberField(clipActions, "Source out (seconds)");
  const timelineStart = numberField(clipActions, "Move to (seconds)");
  const revision = async () => Number(await editor.getAttribute("data-project-revision"));
  const waitForRevision = (expectedRevision) =>
    page.waitForFunction(
      (expected) =>
        Number(
          document
            .querySelector('[data-testid="social-project-editor"]')
            ?.getAttribute("data-project-revision"),
        ) === expected,
      expectedRevision,
    );

  assert.equal(await sourceStart.inputValue(), "0");
  assert.equal(await sourceEnd.inputValue(), "5");
  const trimStart = page.getByRole("button", {
    name: `Trim start of ${clipName}`,
    exact: true,
  });
  const beforeKeyboardTrim = await revision();
  await trimStart.press("ArrowRight");
  await waitForRevision(beforeKeyboardTrim + 1);
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  await page.waitForFunction((id) => {
    const actions = document.querySelector(`[data-testid="social-project-clip-actions-${id}"]`);
    const values = [...(actions?.querySelectorAll("label") ?? [])].map(
      (label) => label.querySelector("input")?.value,
    );
    return values.includes("0.033") && values.includes("5");
  }, clipId);
  const keyboardStart = Number(await sourceStart.inputValue());
  const endBeforePointerTrim = Number(await sourceEnd.inputValue());
  assert.ok(keyboardStart > 0, "Media start handle should advance by one project frame");
  assert.equal(endBeforePointerTrim, 5, "Media start trim should preserve the source end");
  assert.equal(Number(await timelineStart.inputValue()), keyboardStart);

  const trimEnd = page.getByRole("button", {
    name: `Trim end of ${clipName}`,
    exact: true,
  });
  const beforePointerTrim = await revision();
  await trimEnd.scrollIntoViewIfNeeded();
  const bounds = await trimEnd.boundingBox();
  assert.ok(bounds, "Media end trim handle should be visible");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 12, y, { steps: 2 });
  await page.mouse.up();
  await waitForRevision(beforePointerTrim + 1);
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  await page.waitForFunction(
    ({ id, previousSourceEnd }) => {
      const actions = document.querySelector(`[data-testid="social-project-clip-actions-${id}"]`);
      const sourceEnd = [...(actions?.querySelectorAll("label") ?? [])]
        .find((label) => label.textContent?.includes("Source out (seconds)"))
        ?.querySelector("input")?.value;
      return sourceEnd !== undefined && Number(sourceEnd) < previousSourceEnd;
    },
    { id: clipId, previousSourceEnd: endBeforePointerTrim },
  );
  const pointerEnd = Number(await sourceEnd.inputValue());
  assert.ok(
    pointerEnd < endBeforePointerTrim,
    "Pointer end trim should shorten media source range",
  );
  assert.equal(Number(await timelineStart.inputValue()), keyboardStart);
  assert.equal(Number(await sourceStart.inputValue()), keyboardStart);
  assert.ok(pointerEnd > keyboardStart, "Media end trim must retain a positive source range");
  return clipId;
}

export async function verifyTimelineMediaClipMoveSnapping(page, textClipId, mediaClipId) {
  const editor = page.getByTestId("social-project-editor");
  const textActions = page.getByTestId(`social-project-clip-actions-${textClipId}`);
  const textStartSeconds = Number(await numberField(textActions, "Move to (seconds)").inputValue());
  const textDurationSeconds = Number(
    await numberField(textActions, "Duration (seconds)").inputValue(),
  );
  const targetStartMs = Math.round((textStartSeconds + textDurationSeconds) * 1000);
  const mediaActions = page.getByTestId(`social-project-clip-actions-${mediaClipId}`);
  const mediaStartMs = Math.round(
    Number(await numberField(mediaActions, "Move to (seconds)").inputValue()) * 1000,
  );
  const pixelsPerSecond = Number(
    await page
      .getByTestId("social-project-timeline-viewport")
      .getAttribute("data-social-timeline-pixels-per-second"),
  );
  assert.ok(
    typeof pixelsPerSecond === "number" && Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0,
    "Expected to derive timeline scale from the persisted text clip position",
  );

  const moveButton = page
    .locator(`[data-social-timeline-clip="${mediaClipId}"]`)
    .getByRole("button", { name: "Trim test footage.mp4", exact: true });
  await moveButton.scrollIntoViewIfNeeded();
  const bounds = await moveButton.boundingBox();
  assert.ok(bounds, "Media clip should be visible before pointer move");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const deltaX = ((targetStartMs - mediaStartMs) * pixelsPerSecond) / 1000;
  const beforeMove = Number(await editor.getAttribute("data-project-revision"));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (expectedRevision) =>
      Number(
        document
          .querySelector('[data-testid="social-project-editor"]')
          ?.getAttribute("data-project-revision"),
      ) === expectedRevision,
    beforeMove + 1,
  );
  await page.getByRole("status").filter({ hasText: "Project revision saved." }).waitFor();
  const movedStartMs = Math.round(
    Number(await numberField(mediaActions, "Move to (seconds)").inputValue()) * 1000,
  );
  assert.equal(
    movedStartMs,
    targetStartMs,
    "Pointer move should snap the clip's start to the neighboring clip's end",
  );
}
