import assert from "node:assert/strict";

export async function createAndExerciseAccountAutomation(page, title, editedTitle, weekday) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", {
      name: "Automations",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { level: 1, name: "Account automations" }).waitFor();
  await page.getByRole("button", { name: "Create automation", exact: true }).click();

  const form = page.getByRole("region", { name: "Automation details" });
  await form.getByLabel("Name", { exact: true }).fill(title);
  await form
    .getByLabel("Instructions", { exact: true })
    .fill("Prepare a source research plan for this account.");
  const scheduleSelects = form.getByRole("combobox");
  await scheduleSelects.nth(0).selectOption("weekly");
  await scheduleSelects.nth(1).selectOption(String(weekday));
  await form.getByLabel("Local time", { exact: true }).fill("23:59");
  await form.getByRole("button", { name: "Create automation", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Automation created for this account." })
    .waitFor();

  let automationCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await automationCard.getByText("Active", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Pause", exact: true }).click();
  await automationCard.getByText("Paused", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Resume", exact: true }).click();
  await automationCard.getByText("Active", { exact: true }).waitFor();

  await automationCard.getByRole("button", { name: "Edit automation" }).click();
  const editForm = page.getByRole("region", { name: "Automation details" });
  await editForm.getByLabel("Name", { exact: true }).fill(editedTitle);
  await editForm
    .locator("textarea")
    .fill("Prepare and verify a source research plan for this account.");
  await editForm.getByRole("button", { name: "Save changes", exact: true }).click();

  automationCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: editedTitle, exact: true }),
  });
  await automationCard.getByText("Active", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Show run history" }).click();
  await automationCard.getByText("No runs yet.", { exact: true }).waitFor();
}

export async function verifyAccountAutomationAfterRelaunch(page, editedTitle, weekday) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", {
      name: "Automations",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { level: 1, name: "Account automations" }).waitFor();
  const automationCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: editedTitle, exact: true }),
  });
  await automationCard.getByText("Active", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Edit automation" }).click();
  const editForm = page.getByRole("region", { name: "Automation details" });
  const scheduleSelects = editForm.getByRole("combobox");
  assert.equal(await scheduleSelects.nth(0).inputValue(), "weekly");
  assert.equal(await scheduleSelects.nth(1).inputValue(), String(weekday));
  assert.equal(await editForm.getByLabel("Local time", { exact: true }).inputValue(), "23:59");
  await editForm.getByRole("button", { name: "Cancel", exact: true }).last().click();
  await automationCard.getByRole("button", { name: "Show run history" }).click();
  await automationCard.getByText("No runs yet.", { exact: true }).waitFor();
}

export async function createAndVerifyScheduledHostRejection(page, title, automationRepo) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  await page.getByRole("heading", { level: 1, name: "Account automations" }).waitFor();
  await page.getByRole("button", { name: "Create automation", exact: true }).click();

  const form = page.getByRole("region", { name: "Automation details" });
  await form.getByLabel("Name", { exact: true }).fill(title);
  await form
    .getByLabel("Instructions", { exact: true })
    .fill("Prepare a source research plan for this account.");
  await form.getByRole("combobox").nth(0).selectOption("daily");

  // 取当前本地时间两分钟后的整分钟，给 20 秒轮询留出窗口，同时落在五分钟 misfire grace 内。
  const scheduledAt = new Date();
  scheduledAt.setSeconds(0, 0);
  scheduledAt.setMinutes(scheduledAt.getMinutes() + 2);
  const localTime = `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`;
  await form.getByLabel("Local time", { exact: true }).fill(localTime);
  await form.getByRole("button", { name: "Create automation", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Automation created for this account." })
    .waitFor();

  const automationCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await automationCard.getByText("Active", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Show run history" }).click();

  const deadline = Date.now() + 4 * 60_000;
  let automation;
  let scheduledRun;
  while (Date.now() < deadline) {
    automation = (await automationRepo.list()).find((candidate) => candidate.title === title);
    if (automation) {
      const workspaceKey = automation.workspaceIdentity?.trim() || automation.workspacePath;
      const runs = await automationRepo.listRuns(automation.automationId, workspaceKey);
      scheduledRun = runs.find(
        (run) => run.trigger === "schedule" && run.dispatchStatus === "failed_to_dispatch",
      );
      if (scheduledRun) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  assert.ok(automation, "the scheduled automation must persist in the account repository");
  assert.ok(scheduledRun, "the Desktop Scheduler must record its scheduled Host rejection");
  assert.equal(scheduledRun.trigger, "schedule");
  assert.equal(
    scheduledRun.error,
    "Automation 无法从目标 Host 解析首选模型",
    "the saved dispatch error must come from Host model-selection validation, not Main's no-Host branch",
  );
  assert.equal(
    scheduledRun.workspaceKey,
    automation.workspaceIdentity?.trim() || automation.workspacePath,
    "the scheduled run must retain its account workspace identity",
  );

  await automationCard.getByRole("button", { name: "Hide run history" }).click();
  await automationCard.getByRole("button", { name: "Show run history" }).click();
  await automationCard.getByText("Failed", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Pause", exact: true }).click();
  await automationCard.getByText("Paused", { exact: true }).waitFor();
}

export async function createAndVerifyScheduledHostSuccess(
  page,
  title,
  instructions,
  automationRepo,
  modelRequests,
) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  await page.getByRole("heading", { level: 1, name: "Account automations" }).waitFor();
  await page.getByRole("button", { name: "Create automation", exact: true }).click();

  const form = page.getByRole("region", { name: "Automation details" });
  await form.getByLabel("Name", { exact: true }).fill(title);
  await form.getByLabel("Instructions", { exact: true }).fill(instructions);
  await form.getByRole("combobox").nth(0).selectOption("daily");

  // 给 Electron 表单提交和轮询留出窗口，仍在五分钟 misfire grace 内。
  const scheduledAt = new Date();
  scheduledAt.setSeconds(0, 0);
  scheduledAt.setMinutes(scheduledAt.getMinutes() + 2);
  const localTime = `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`;
  await form.getByLabel("Local time", { exact: true }).fill(localTime);
  await form.getByRole("button", { name: "Create automation", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Automation created for this account." })
    .waitFor();

  const automationCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await automationCard.getByText("Active", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Show run history" }).click();

  const deadline = Date.now() + 4 * 60_000;
  let automation;
  let scheduledRun;
  while (Date.now() < deadline) {
    automation = (await automationRepo.list()).find((candidate) => candidate.title === title);
    if (automation) {
      const workspaceKey = automation.workspaceIdentity?.trim() || automation.workspacePath;
      const runs = await automationRepo.listRuns(automation.automationId, workspaceKey);
      scheduledRun = runs.find(
        (run) =>
          run.trigger === "schedule" &&
          run.dispatchStatus === "dispatched" &&
          run.outcome === "succeeded",
      );
      if (scheduledRun) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  assert.ok(
    automation,
    "the successful scheduled automation must persist in the account repository",
  );
  assert.ok(scheduledRun, "the scheduled Host task must finish successfully");
  assert.ok(scheduledRun.sessionId, "a successful scheduled run must link its Host task");
  assert.equal(
    scheduledRun.workspaceKey,
    automation.workspaceIdentity?.trim() || automation.workspacePath,
  );
  assert.equal(scheduledRun.modelSelection?.providerId, "social-harness-e2e-local");
  assert.equal(scheduledRun.modelSelection?.modelId, "mock-chat");
  assert.ok(
    modelRequests.some(
      (request) =>
        request.model === "mock-chat" && JSON.stringify(request.messages).includes(instructions),
    ),
    "the local model must receive this scheduled automation's prompt",
  );
  assert.ok(
    modelRequests.some((request) => {
      const messages = JSON.stringify(request.messages);
      return (
        request.model === "mock-chat" &&
        messages.includes("Social Harness Account Guidance") &&
        messages.includes("SocialAgentGetContext")
      );
    }),
    "the account runtime must send its stable Social Harness guidance to the model",
  );

  await automationCard.getByRole("button", { name: "Hide run history" }).click();
  await automationCard.getByRole("button", { name: "Show run history" }).click();
  await automationCard.getByText("Completed", { exact: true }).waitFor();
  await automationCard.getByRole("button", { name: "Pause", exact: true }).click();
  await automationCard.getByText("Paused", { exact: true }).waitFor();
}
