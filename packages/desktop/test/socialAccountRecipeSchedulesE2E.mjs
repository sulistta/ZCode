import assert from "node:assert/strict";

export async function createAndRunPinnedRecipeSchedule(page) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  const recipes = page.getByRole("region", { name: "Saved script recipes", exact: true });
  await recipes.getByRole("button", { name: "New recipe", exact: true }).click();
  const editor = page.getByRole("region", { name: "Recipe editor", exact: true });
  await editor.getByLabel("Recipe name", { exact: true }).fill("scheduled-review");
  await editor.getByLabel("Description", { exact: true }).fill("Pinned schedule fixture");
  await editor.getByLabel("Script", { exact: true }).fill("return 'SCHEDULE_APPROVED_FIRST';");
  await editor.getByRole("button", { name: "Save recipe", exact: true }).click();
  const recipe = recipes
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "scheduled-review", exact: true }) });
  await recipe.getByRole("button", { name: "Review and run", exact: true }).click();
  const review = page.getByRole("region", { name: "Review recipe execution", exact: true });
  await review.getByRole("button", { name: "Schedule reviewed version", exact: true }).click();
  const form = page.getByRole("region", { name: "Automation details", exact: true });
  await form.getByText("return 'SCHEDULE_APPROVED_FIRST';", { exact: true }).waitFor();
  await form.getByLabel("Name", { exact: true }).fill("Pinned recipe schedule");
  await form.getByRole("button", { name: "Create automation", exact: true }).click();
  const schedule = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Pinned recipe schedule", exact: true }) });
  await schedule.waitFor();
  await recipe.getByRole("button", { name: "Edit recipe", exact: true }).click();
  await editor
    .getByLabel("Script", { exact: true })
    .fill("throw new Error('UNAPPROVED_DEFINITION');");
  await editor.getByRole("button", { name: "Save recipe", exact: true }).click();
  await schedule.getByRole("button", { name: "Run now", exact: true }).click();
  await schedule.getByRole("button", { name: "Show run history", exact: true }).click();
  await schedule.getByText("Completed", { exact: true }).waitFor({ timeout: 30_000 });
  await schedule.getByRole("button", { name: "Edit automation", exact: true }).click();
  await form.getByText("return 'SCHEDULE_APPROVED_FIRST';", { exact: true }).waitFor();
  await form.getByLabel("Name", { exact: true }).fill("Renamed pinned schedule");
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("heading", { name: "Renamed pinned schedule", exact: true }).waitFor();
  return { firstScript: "return 'SCHEDULE_APPROVED_FIRST';" };
}

export async function replaceAndRunRecipeSchedule(page) {
  const recipes = page.getByRole("region", { name: "Saved script recipes", exact: true });
  const recipe = recipes
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "scheduled-review", exact: true }) });
  await recipe.getByRole("button", { name: "Edit recipe", exact: true }).click();
  const editor = page.getByRole("region", { name: "Recipe editor", exact: true });
  const script = "return 'SCHEDULE_APPROVED_SECOND';";
  await editor.getByLabel("Script", { exact: true }).fill(script);
  await editor.getByRole("button", { name: "Save recipe", exact: true }).click();
  const schedule = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Renamed pinned schedule", exact: true }) });
  await schedule.getByRole("button", { name: "Replace approved version", exact: true }).click();
  const review = page.getByRole("region", { name: "Review recipe execution", exact: true });
  await review.getByText(script, { exact: true }).waitFor();
  await review.getByRole("button", { name: "Schedule reviewed version", exact: true }).click();
  const form = page.getByRole("region", { name: "Automation details", exact: true });
  await form.getByText(script, { exact: true }).waitFor();
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await schedule.getByRole("button", { name: "Run now", exact: true }).click();
  const showHistory = schedule.getByRole("button", { name: "Show run history", exact: true });
  if (await showHistory.count()) await showHistory.click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("article")].some(
      (item) =>
        item.textContent.includes("Renamed pinned schedule") &&
        [...item.querySelectorAll("li")].filter((row) => row.textContent.includes("Completed"))
          .length === 2,
    ),
  );
  assert.equal(await schedule.getByText("Failed", { exact: true }).count(), 0);
  return { secondScript: script };
}

export async function verifyAutomaticRecipeOccurrence(page, repo) {
  const schedule = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Renamed pinned schedule", exact: true }) });
  await schedule.getByRole("button", { name: "Edit automation", exact: true }).click();
  const form = page.getByRole("region", { name: "Automation details", exact: true });
  const due = new Date();
  due.setSeconds(0, 0);
  due.setMinutes(due.getMinutes() + 2);
  const time = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
  await form.getByLabel("Local time", { exact: true }).fill(time);
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await form.waitFor({ state: "hidden" });
  const recipe = page
    .getByRole("region", { name: "Saved script recipes", exact: true })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "scheduled-review", exact: true }) });
  await recipe.getByRole("button", { name: "Edit recipe", exact: true }).click();
  const editor = page.getByRole("region", { name: "Recipe editor", exact: true });
  await editor
    .getByLabel("Script", { exact: true })
    .fill("throw new Error('LATEST_DEFINITION_IS_NOT_APPROVED');");
  await editor.getByRole("button", { name: "Save recipe", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const deadline = Date.now() + 4 * 60_000;
  let occurrence;
  while (Date.now() < deadline) {
    const automation = (await repo.list()).find((item) => item.title === "Renamed pinned schedule");
    assert.ok(automation);
    occurrence = (await repo.listRuns(automation.automationId, automation.workspaceKey)).find(
      (run) =>
        run.trigger === "schedule" &&
        run.outcome === "succeeded" &&
        run.dispatchStatus === "dispatched",
    );
    if (occurrence) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  assert.ok(
    occurrence,
    "The actual Scheduler/Main/Host path must settle the recipe engine outcome",
  );
  assert.equal(occurrence.recipeSnapshot.script, "return 'SCHEDULE_APPROVED_SECOND';");
  assert.ok(occurrence.sessionId);
  assert.equal(occurrence.modelSelection.providerId, "social-harness-e2e-local");
  await schedule.getByRole("button", { name: "Pause", exact: true }).click();
  await schedule.getByText("Paused", { exact: true }).waitFor();
}
