import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { verifyPreviewExportParityInElectron } from "./socialProjectPreviewExportE2E.mjs";
import { fillSocialAgentDraft } from "./socialHarnessComposerDraftE2E.mjs";

async function answerPermission(page, permissionList, approveToolNames) {
  const requestId = await permissionList.getAttribute("data-permission-request-id");
  assert.ok(requestId, "A permission must expose its existing request identity");
  if (approveToolNames) {
    const text = await permissionList.locator("..").locator("..").innerText();
    assert.ok(
      approveToolNames.some((name) => text.includes(name)),
      `Unexpected preparation permission: ${text}`,
    );
  }
  const option = permissionList.locator('[data-permission-option-kind="allowOnce"]');
  const selected = (await option.getAttribute("aria-selected")) === "true";
  await option.click();
  if (!selected) await page.getByRole("button", { name: "Confirm", exact: true }).click();
  // 连续请求会复用同一可见弹窗；等待当前 requestId 被消费，不能等待弹窗隐藏。
  await page.waitForFunction(
    (answeredId) => {
      const list = document.querySelector('[role="listbox"][data-permission-request-id]');
      return !list || list.getAttribute("data-permission-request-id") !== answeredId;
    },
    requestId,
    { timeout: 15_000 },
  );
}

export async function waitForSocialAgentResponse(page, { responseText, approveToolNames }) {
  const permissionList = page.getByRole("listbox", { name: "Permission required", exact: true });
  const response = page.getByText(responseText, { exact: true });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await response.isVisible()) return;
    if (await permissionList.isVisible())
      await answerPermission(page, permissionList, approveToolNames);
    await delay(50);
  }
  assert.fail(`The account conversation did not return ${responseText}`);
}

export async function sendSocialAgentPrompt(
  page,
  { marker, projectName, captionText, promptText, responseText, approveToolNames },
) {
  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  const conversationInput = page.locator('[data-testid="v4-composer-input"]');
  await conversationInput.waitFor({ state: "visible" });
  const prompt =
    promptText ??
    `${marker}: edit the existing text clip in ${projectName} to read "${captionText}".`;
  await fillSocialAgentDraft(page, prompt);
  await page.waitForFunction(() => {
    const send = document.querySelector('[data-testid="v4-composer-send"]');
    return send instanceof HTMLButtonElement && !send.disabled;
  });
  await page.getByTestId("v4-composer-send").click();

  const permissionList = page.getByRole("listbox", { name: "Permission required", exact: true });
  await permissionList.waitFor({ state: "visible", timeout: 30_000 });
  await answerPermission(page, permissionList, approveToolNames);
  if (!approveToolNames) {
    await page.getByText(responseText, { exact: true }).waitFor({ timeout: 90_000 });
    return;
  }
  await waitForSocialAgentResponse(page, { responseText, approveToolNames });
}

export async function createCandidateProjectsInElectron(page, handoffs) {
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Player", exact: true }).waitFor();
  for (const handoff of handoffs) {
    await page.getByPlaceholder("New Reel", { exact: true }).fill(handoff.projectName);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.getByRole("button", { name: handoff.projectName }).waitFor();
    const editor = page.getByTestId("social-project-editor");
    await editor.waitFor({ state: "visible" });
    assert.equal(
      await editor.getAttribute("data-project-revision"),
      "0",
      "A new candidate project starts at revision zero",
    );
  }
}

export async function verifySocialAgentCandidateHandoffsInElectron(page, handoffs, mockProvider) {
  for (const handoff of handoffs) {
    await sendSocialAgentPrompt(page, {
      marker: handoff.marker,
      projectName: handoff.projectName,
      promptText:
        `${handoff.marker}: analyze ${handoff.mediaName} in ${handoff.mode} mode, ` +
        `then place a measured candidate into ${handoff.projectName}.`,
      responseText: handoff.finalResponseText,
    });

    const calls = mockProvider.candidateHandoffToolCalls.filter(
      (toolCall) => toolCall.marker === handoff.marker,
    );
    assert.deepEqual(
      calls.map((toolCall) => toolCall.name),
      [
        "SocialAgentGetContext",
        "SocialMediaList",
        "SocialClipCandidates",
        "SocialProjectList",
        "SocialProjectRead",
        "SocialProjectCommand",
      ],
      "Candidate placement must read account context, media, measured candidates, and project state before writing",
    );

    const accepted = mockProvider.candidateHandoffResults.find(
      (result) => result.marker === handoff.marker,
    );
    assert.ok(accepted, `Expected the Host to accept ${handoff.mode} candidate placement`);
    const candidateCall = calls.find((toolCall) => toolCall.name === "SocialClipCandidates");
    assert.equal(candidateCall?.arguments.mode, handoff.mode);
    assert.equal(candidateCall?.arguments.mediaId, accepted.mediaId);
    const readCall = calls.find((toolCall) => toolCall.name === "SocialProjectRead");
    assert.equal(readCall?.arguments.projectId, accepted.projectId);
    const command = calls.at(-1).arguments;
    assert.equal(command.projectId, accepted.projectId);
    assert.equal(command.expectedRevision, 0);
    assert.equal(command.operation.type, "put-clip");
    assert.equal(command.operation.clip.mediaId, accepted.mediaId);
    assert.equal(command.operation.clip.sourceStartMs, accepted.sourceStartMs);
    assert.equal(command.operation.clip.sourceEndMs, accepted.sourceEndMs);
    assert.equal(accepted.sourceStartMs, Math.round(accepted.candidate.startSeconds * 1_000));
    assert.equal(accepted.sourceEndMs, Math.round(accepted.candidate.endSeconds * 1_000));
    assert.equal(accepted.revision, 1);
  }
}

export async function verifySocialAgentCandidateProjectsAfterRelaunch(page, mockProvider) {
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Player", exact: true }).waitFor();
  for (const handoff of mockProvider.candidateHandoffs ?? []) {
    const accepted = mockProvider.candidateHandoffResults.find(
      (result) => result.marker === handoff.marker,
    );
    assert.ok(accepted, `Expected saved ${handoff.mode} candidate project metadata`);
    await page.getByRole("button", { name: handoff.projectName }).click();
    const editor = page.getByTestId("social-project-editor");
    await editor.waitFor();
    assert.equal(await editor.getAttribute("data-project-revision"), String(accepted.revision));
    const timelineClips = page.locator("[data-social-timeline-clip]");
    await timelineClips.first().waitFor();
    assert.equal(
      await timelineClips.count(),
      1,
      "The accepted candidate clip must persist after relaunch",
    );
    const clip = timelineClips.first();
    const clipId = await clip.getAttribute("data-social-timeline-clip");
    assert.ok(clipId);
    await clip.locator("button").first().click();
    const actions = page.getByTestId(`social-project-clip-actions-${clipId}`);
    await actions.waitFor();
    const sourceStart = Number(
      await actions
        .getByRole("spinbutton", { name: "Source in (seconds)", exact: true })
        .inputValue(),
    );
    const sourceEnd = Number(
      await actions
        .getByRole("spinbutton", { name: "Source out (seconds)", exact: true })
        .inputValue(),
    );
    assert.ok(Math.abs(sourceStart - accepted.sourceStartMs / 1_000) < 0.001);
    assert.ok(Math.abs(sourceEnd - accepted.sourceEndMs / 1_000) < 0.001);
  }
}

function projectToolCallsFor(mockProvider, marker) {
  const calls = mockProvider.projectEditToolCalls.filter((toolCall) => toolCall.marker === marker);
  assert.deepEqual(
    calls.map((toolCall) => toolCall.name),
    ["SocialAgentGetContext", "SocialProjectList", "SocialProjectRead", "SocialProjectCommand"],
    "The account conversation must use the real Social Agent project tool chain",
  );
  return calls;
}

async function waitForClipText(page, clipId, expectedText, previousRevision) {
  await page.waitForFunction(
    ({ expectedText: expected, clipId: id, previousRevision: revision }) => {
      const editor = document.querySelector('[data-testid="social-project-editor"]');
      const actions = document.querySelector(`[data-testid="social-project-clip-actions-${id}"]`);
      const text = actions?.querySelector("textarea");
      return (
        Number(editor?.getAttribute("data-project-revision")) > revision &&
        text instanceof HTMLTextAreaElement &&
        text.value === expected
      );
    },
    { clipId, expectedText, previousRevision },
  );
}

async function openEditedProject(page, projectName, clipId) {
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Player", exact: true }).waitFor();
  await page.getByRole("button", { name: projectName }).click();
  await page.getByTestId("social-project-editor").waitFor();
  const clip = page.locator(`[data-social-timeline-clip="${clipId}"]`);
  await clip.waitFor();
  await clip.click();
  return {
    editor: page.getByTestId("social-project-editor"),
    actions: page.getByTestId(`social-project-clip-actions-${clipId}`),
  };
}

export async function verifySocialAgentProjectEditInElectron(page, options) {
  const {
    blockedCaptionText,
    blockedMarker,
    blockedResponseText,
    captionText,
    clipIds,
    dataBaseDir,
    finalResponseText,
    ffmpegExecutable,
    ffprobeExecutable,
    manualCaptionText,
    marker,
    mockProvider,
    projectName,
    resumeMarker,
    resumeResponseText,
    runId,
  } = options;

  const initialProject = await openEditedProject(page, projectName, clipIds.textClipId);
  await page
    .getByRole("note")
    .filter({ hasText: "The supported file ceiling stays 1 GiB." })
    .waitFor();
  await page
    .getByText(
      "Instagram Reels support up to 1920 px on each side and 23–60 fps. Change Project settings and export again if needed.",
      { exact: true },
    )
    .waitFor();
  await initialProject.editor
    .getByRole("button", { name: "Return control to agent", exact: true })
    .click();
  await initialProject.editor.getByText("The agent has edit control", { exact: true }).waitFor();
  const revisionBeforeAgentEdit = Number(
    await initialProject.editor.getAttribute("data-project-revision"),
  );
  assert.ok(Number.isInteger(revisionBeforeAgentEdit) && revisionBeforeAgentEdit > 0);

  await sendSocialAgentPrompt(page, {
    marker,
    projectName,
    captionText,
    responseText: finalResponseText,
  });
  const agentCalls = projectToolCallsFor(mockProvider, marker);
  const agentCommand = agentCalls.at(-1).arguments;
  assert.equal(agentCommand.expectedRevision, revisionBeforeAgentEdit);
  assert.equal(agentCommand.operation.type, "put-clip");
  assert.equal(agentCommand.operation.clip.text, captionText);

  const editedProject = await openEditedProject(page, projectName, clipIds.textClipId);
  await page.waitForFunction((previousRevision) => {
    const editor = document.querySelector('[data-testid="social-project-editor"]');
    return Number(editor?.getAttribute("data-project-revision")) > previousRevision;
  }, revisionBeforeAgentEdit);
  const agentEditedText = editedProject.actions.getByRole("textbox", { name: "Overlay text" });
  assert.equal(await agentEditedText.inputValue(), captionText);
  assert.ok(
    Number(await editedProject.editor.getAttribute("data-project-revision")) >
      revisionBeforeAgentEdit,
  );
  assert.equal(await agentEditedText.isDisabled(), true);

  await editedProject.editor.getByRole("button", { name: "Take control", exact: true }).click();
  await editedProject.editor.getByText("You have edit control", { exact: true }).waitFor();
  const revisionBeforeManualEdit = Number(
    await editedProject.editor.getAttribute("data-project-revision"),
  );
  const manualText = editedProject.actions.getByRole("textbox", { name: "Overlay text" });
  await manualText.fill(manualCaptionText);
  await editedProject.actions
    .getByRole("button", { name: "Save clip changes", exact: true })
    .click();
  await waitForClipText(page, clipIds.textClipId, manualCaptionText, revisionBeforeManualEdit);

  let revisionBeforeHistory = Number(
    await editedProject.editor.getAttribute("data-project-revision"),
  );
  await editedProject.editor.getByRole("button", { name: "Undo", exact: true }).click();
  await waitForClipText(page, clipIds.textClipId, captionText, revisionBeforeHistory);
  revisionBeforeHistory = Number(await editedProject.editor.getAttribute("data-project-revision"));
  await editedProject.editor.getByRole("button", { name: "Redo", exact: true }).click();
  await waitForClipText(page, clipIds.textClipId, manualCaptionText, revisionBeforeHistory);

  const revisionBeforeBlockedAgentEdit = Number(
    await editedProject.editor.getAttribute("data-project-revision"),
  );
  await sendSocialAgentPrompt(page, {
    marker: blockedMarker,
    projectName,
    captionText: blockedCaptionText,
    responseText: blockedResponseText,
  });
  const blockedCalls = projectToolCallsFor(mockProvider, blockedMarker);
  const blockedCommand = blockedCalls.at(-1).arguments;
  assert.equal(blockedCommand.expectedRevision, revisionBeforeBlockedAgentEdit);
  assert.equal(blockedCommand.operation.clip.text, blockedCaptionText);

  const blockedProject = await openEditedProject(page, projectName, clipIds.textClipId);
  assert.equal(
    Number(await blockedProject.editor.getAttribute("data-project-revision")),
    revisionBeforeBlockedAgentEdit,
    "A rejected Agent command must not advance the project revision",
  );
  assert.equal(
    await blockedProject.actions.getByRole("textbox", { name: "Overlay text" }).inputValue(),
    manualCaptionText,
    "A rejected Agent command must preserve the user's accepted edit",
  );
  await blockedProject.editor
    .getByRole("button", { name: "Return control to agent", exact: true })
    .click();
  await blockedProject.editor.getByText("The agent has edit control", { exact: true }).waitFor();
  const revisionBeforeResume = Number(
    await blockedProject.editor.getAttribute("data-project-revision"),
  );

  await sendSocialAgentPrompt(page, {
    marker: resumeMarker,
    projectName,
    captionText,
    responseText: resumeResponseText,
  });
  const resumedCalls = projectToolCallsFor(mockProvider, resumeMarker);
  const resumedCommand = resumedCalls.at(-1).arguments;
  assert.equal(resumedCommand.expectedRevision, revisionBeforeResume);
  assert.equal(resumedCommand.operation.clip.text, captionText);

  await openEditedProject(page, projectName, clipIds.textClipId);
  await waitForClipText(page, clipIds.textClipId, captionText, revisionBeforeResume);
  await verifyPreviewExportParityInElectron(page, runId, {
    dataBaseDir,
    projectName,
    captionText,
    mediaClipId: clipIds.mediaClipId,
    ffmpegExecutable,
    ffprobeExecutable,
  });
  if (mockProvider.candidateHandoffs?.length) {
    await verifySocialAgentCandidateHandoffsInElectron(
      page,
      mockProvider.candidateHandoffs,
      mockProvider,
    );
  }
}
