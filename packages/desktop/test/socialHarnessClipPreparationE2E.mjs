import { verifyOnDemandPreviewProxyInElectron } from "./socialMediaPreviewProxyE2E.mjs";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AutomationRepo } from "@social-harness/services/node";
import { waitForSocialAgentResponse } from "./socialProjectAgentEditingE2E.mjs";
import { verifySocialAgentProductionInElectron } from "./socialHarnessAgentProductionE2E.mjs";

export async function verifySocialProductionWorkflowsInElectron(page, options) {
  await verifySocialAgentProductionInElectron(page, options);
  await verifyClipPreparationAutomationInElectron(page, {
    ...options,
    scenario: options.clipPreparationScenario,
  });
  await verifyOnDemandPreviewProxyInElectron(page, options);
}

export function createClipPreparationScenario(runId) {
  return {
    kind: "clips",
    marker: `CLIP_PREPARATION_${runId}`,
    accountName: `Preparation pilot ${runId}`,
    automationTitle: `Prepare reviewable clips ${runId}`,
    projectName: `Automated review Reel ${runId}`,
    finalResponseText: "E2E saved clip automation exported for review without publication.",
  };
}

export async function verifyClipPreparationAutomationInElectron(
  page,
  { scenario, mockProvider, dataBaseDir, firstAccountName },
) {
  const root = join(dataBaseDir, ".social-harness", "v1");
  const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
  const beforeMedia = await readJson("social-media/catalog.json");
  const beforeProjects = await readJson("social-projects/projects.json");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Account name").fill(scenario.accountName);
  await page.getByLabel("Niche").fill("Measured music clips");
  await page.getByLabel("Audience").fill("Music listeners");
  await page.getByLabel("Visual style").fill("Minimal captions");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: scenario.accountName, exact: true }).waitFor();
  const account = (await readJson("social-accounts/accounts.json")).find(
    (item) => item.displayName === scenario.accountName,
  );
  assert.ok(account);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const url = page.getByLabel("Video URL", { exact: true });
  await url.fill("https://www.youtube.com/watch?v=SHE2E000002");
  await page
    .locator("form")
    .filter({ has: url })
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Local fake YouTube video.mp4", exact: true })
    .waitFor({ timeout: 45_000 });

  await page.getByRole("button", { name: "Automations", exact: true }).click();
  await page.getByRole("button", { name: "Create automation", exact: true }).click();
  const form = page.getByRole("region", { name: "Automation details" });
  await form
    .getByRole("button", { name: /^(Review clip candidates|Prepare clips for review)/u })
    .click();
  await form.getByLabel("Name", { exact: true }).fill(scenario.automationTitle);
  // React 的受控 textarea 把默认值写入 label.textContent；按控件的可访问名称定位，
  // 避免精确 label 文本被已填充的模板内容污染。已用真实 Chromium 验证此差异。
  const instructions = form.getByRole("textbox", { name: "Instructions", exact: true });
  // 只标记本地模型场景，不补充建项目或导出指令；这些能力必须来自真正的内置模板。
  const prompt = `${await instructions.inputValue()}\n${scenario.marker}: use music analysis.`;
  await instructions.fill(prompt);
  await form.getByLabel("Local time", { exact: true }).fill("23:59");
  await form.getByRole("button", { name: "Create automation", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Automation created for this account." })
    .waitFor();
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: scenario.automationTitle, exact: true }) });
  await card.getByRole("button", { name: "Pause", exact: true }).click();
  await card.getByText("Paused", { exact: true }).waitFor();
  const repo = new AutomationRepo(join(root, "config/tasks-index.sqlite"));
  await repo.ensureReady();
  try {
    const automation = (await repo.list()).find((item) => item.title === scenario.automationTitle);
    assert.ok(automation);
    assert.equal(automation.prompt, prompt);
    assert.equal(automation.mode, "build");
    const workspaceKey = automation.workspaceIdentity?.trim() || automation.workspacePath;
    assert.equal(
      workspaceKey,
      account.workspaceIdentity,
      "The saved workflow must retain account identity",
    );
    await card.getByRole("button", { name: "Run now", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Run queued for this account." }).waitFor();
    await page.getByRole("button", { name: "Conversations", exact: true }).click();
    // Run now 创建后台任务；选择此新账号唯一的真实会话，不能另发一条消息替代调度。
    const conversations = page.locator('aside [aria-label="Conversations"]').getByRole("button");
    await conversations.first().waitFor();
    assert.equal(await conversations.count(), 1);
    await conversations.first().click();
    await waitForSocialAgentResponse(page, {
      responseText: scenario.finalResponseText,
      approveToolNames: ["SocialProjectCreate", "SocialProjectCommand", "SocialProjectExport"],
    });
    let runs;
    const deadline = Date.now() + 30_000;
    do {
      runs = await repo.listRuns(automation.automationId, workspaceKey);
      if (runs.some((run) => run.outcome === "succeeded")) break;
      await delay(100);
    } while (Date.now() < deadline);
    assert.equal(runs.length, 1, "One manual claim must produce one terminal run");
    assert.equal(runs[0].trigger, "manual");
    assert.equal(runs[0].dispatchStatus, "dispatched");
    assert.equal(runs[0].outcome, "succeeded");
    assert.equal(runs[0].workspaceKey, workspaceKey);
    assert.ok(runs[0].sessionId);
    assert.ok(
      mockProvider.requests.some((body) =>
        (body.messages ?? []).some((message) =>
          typeof message.content === "string"
            ? message.content.includes(prompt)
            : message.content?.some((part) => part.text?.includes(prompt)),
        ),
      ),
      "The model must receive the saved template instructions",
    );
  } finally {
    repo.close();
  }
  const calls = mockProvider.clipPreparationToolCalls.map((call) => call.name);
  for (const name of [
    "SocialAgentGetContext",
    "SocialMediaList",
    "SocialClipCandidates",
    "SocialProjectCreate",
    "SocialProjectRead",
    "SocialProjectCommand",
    "SocialProjectExport",
    "SocialProjectExports",
  ])
    assert.ok(calls.includes(name), `Saved preparation must exercise ${name}`);
  assert.ok(
    !calls.includes("SocialPublicationRequest"),
    "Preparation must not request publication",
  );
  assert.ok(!calls.includes("SocialMediaImportUrl"), "Preparation uses existing managed media");
  const afterMedia = await readJson("social-media/catalog.json");
  const afterProjects = await readJson("social-projects/projects.json");
  assert.deepEqual(
    afterMedia.assets.filter((asset) => asset.accountId !== account.accountId),
    beforeMedia.assets,
  );
  assert.deepEqual(
    afterProjects.projects.filter((record) => record.project.accountId !== account.accountId),
    beforeProjects.projects,
  );
  const prepared = afterProjects.projects.filter(
    (record) => record.project.accountId === account.accountId,
  );
  assert.equal(prepared.length, 1);
  const project = prepared[0].project;
  assert.equal(project.displayName, scenario.projectName);
  assert.equal(project.revision, 1);
  const exports = (await readJson("social-projects/exports.json")).exports.filter(
    (record) => record.job.accountId === account.accountId,
  );
  assert.equal(exports.length, 1);
  assert.equal(exports[0].job.status, "completed");
  assert.equal(exports[0].snapshot.revision, project.revision);
  assert.ok(
    (await stat(join(root, "social-projects/exports", `${exports[0].job.exportId}.mp4`))).size > 0,
  );
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: scenario.projectName }).click();
  await page.getByText(`Ready · revision ${project.revision}`, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  await card.getByRole("button", { name: "Show run history" }).click();
  await card.getByText("Completed", { exact: true }).waitFor();
  await page
    .locator('[aria-label="Accounts"]')
    .getByRole("button", { name: firstAccountName })
    .click();
  console.log(
    "[social-e2e] Saved clip template dispatched by Run now created/edited/exported a measured Reel, settled one account-bound run, preserved other accounts and made no publication request",
  );
}
