import assert from "node:assert/strict";
import { verifyPreviewExportParityInElectron } from "./socialProjectPreviewExportE2E.mjs";

async function sendSocialAgentPrompt(page, { marker, projectName, captionText, responseText }) {
  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  const conversationInput = page.locator('[data-testid="v4-composer-input"]');
  await conversationInput.waitFor({ state: "visible" });
  const prompt = `${marker}: edit the existing text clip in ${projectName} to read "${captionText}".`;
  // Lexical 挂载期间直接 fill contenteditable 只改 DOM，可能被下一次 editor update 清空；
  // 等待测试桥接就绪并更新真实 Editor state，才能断言用户实际可提交的草稿。
  await page.waitForFunction(() => {
    const editor = document.querySelector('[data-testid="v4-composer-input"]');
    return (
      editor?.getAttribute("data-e2e-lexical-bridge") === "ready" &&
      typeof editor.__zcodeLexicalInputE2E?.setText === "function"
    );
  });
  await page.evaluate((text) => {
    const editor = document.querySelector('[data-testid="v4-composer-input"]');
    editor.__zcodeLexicalInputE2E.setText(text);
  }, prompt);
  await page.waitForFunction((expectedText) => {
    const editor = document.querySelector('[data-testid="v4-composer-input"]');
    return editor?.__zcodeLexicalInputE2E?.getText() === expectedText;
  }, prompt);
  await page.waitForFunction(() => {
    const send = document.querySelector('[data-testid="v4-composer-send"]');
    return send instanceof HTMLButtonElement && !send.disabled;
  });
  await page.getByTestId("v4-composer-send").click();

  const permissionList = page.getByRole("listbox", { name: "Permission required", exact: true });
  await permissionList.waitFor({ state: "visible", timeout: 30_000 });
  const allowOnce = permissionList.locator('[data-permission-option-kind="allowOnce"]');
  const allowOnceWasSelected = (await allowOnce.getAttribute("aria-selected")) === "true";
  await allowOnce.click();
  if (!allowOnceWasSelected) {
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
  }
  await permissionList.waitFor({ state: "hidden", timeout: 15_000 });
  await page.getByText(responseText, { exact: true }).waitFor({ timeout: 90_000 });
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
}
