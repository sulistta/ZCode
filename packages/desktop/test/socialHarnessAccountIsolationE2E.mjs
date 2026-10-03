import assert from "node:assert/strict";
import { createSocialProjectCandidateHandoffScenarios } from "./socialHarnessCandidateHandoffMockE2E.mjs";
import { createCandidateProjectsInElectron } from "./socialProjectAgentEditingE2E.mjs";
import { waitForRuntimeOutput } from "./socialHarnessAccountE2EUtils.mjs";

export async function verifyAccountConversationShell(page) {
  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  assert.equal(
    await page.locator('[data-workspace-terminal-frame="true"]').count(),
    0,
    "Social Harness conversations must not mount an interactive terminal panel",
  );
  assert.equal(
    await page.getByRole("button", { name: /toggle terminal/i }).count(),
    0,
    "Social Harness workspace navigation must not expose an interactive terminal toggle",
  );
  const conversationInput = page.locator('[data-testid="v4-composer-input"]');
  await conversationInput.waitFor({ state: "visible" });
  assert.equal(
    await page.locator('[data-v4-draft-suggested-prompts-slot="true"]').count(),
    0,
    "account drafts must not mount the retired ZCode-backed suggestion surface",
  );
  const conversationPlaceholder = await conversationInput.getAttribute("aria-placeholder");
  assert.equal(
    conversationPlaceholder,
    "Ask the Social Agent to find sources, shape clips, or edit a project",
  );
  assert.doesNotMatch(conversationPlaceholder ?? "", /ZCode|commands or capabilities/i);
  await conversationInput.fill("/");
  assert.equal(
    await page.getByText("Commands and capabilities", { exact: true }).count(),
    0,
    "account conversations must not expose the generic slash catalog",
  );
  await conversationInput.fill("");
  await page.getByRole("button", { name: "Add context", exact: true }).click();
  await page.getByTestId("chat-attachment-menu-item").waitFor({ state: "visible" });
  for (const unsupportedHint of [
    "Choose capabilities",
    "Choose skills",
    "Type to search plugins, files, and chats",
    "Plugins",
    "Files",
    "Sessions",
  ]) {
    assert.equal(
      await page.getByText(unsupportedHint, { exact: true }).count(),
      0,
      `account conversations must not advertise ${unsupportedHint}`,
    );
  }
  await page.keyboard.press("Escape");
}

export async function createAndEditAccount(page, runtime, accountName, editedName) {
  assert.equal(await page.title(), "Social Harness");
  await page.getByTestId("social-model-settings-open").click();
  await page.getByRole("heading", { level: 1, name: "AI model providers" }).waitFor();
  await page.getByRole("button", { name: "Add provider" }).waitFor();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page
    .getByText("No Instagram or AI provider connection is needed to prepare an account.")
    .waitFor();
  await page.getByRole("button", { name: "Create your first account" }).click();
  await page.getByLabel("Account name").fill(accountName);
  await page.getByLabel("Niche").fill("Podcast and music clips");
  await page.getByLabel("Audience").fill("Portuguese-speaking creators");
  await page.getByLabel("Visual style").fill("Bright editorial captions with restrained motion");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("heading", { level: 1, name: accountName, exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Changes saved." }).waitFor();
  const instagramConnection = page.getByRole("region", { name: "Instagram connection" });
  await instagramConnection.getByText("Instagram not connected", { exact: true }).waitFor();
  const connectInstagramButton = instagramConnection.getByRole("button", {
    name: "Connect Instagram",
    exact: true,
  });
  await instagramConnection
    .getByRole("note")
    .filter({
      hasText: "Connect your own Convex project and Meta app using the setup assistant below.",
    })
    .waitFor();
  assert.equal(
    await connectInstagramButton.isEnabled(),
    false,
    "Connect must stay disabled until the Host confirms its bridge is configured",
  );
  const assistant = page.getByTestId("instagram-infrastructure-assistant");
  await assistant.locator("summary").click();
  await assistant.getByLabel("Production deployment URL").waitFor();
  await assistant.getByRole("button", { name: "Deploy the bundled bridge" }).waitFor();
  await assistant.getByRole("button", { name: "Open Meta applications" }).waitFor();
  assert.equal(
    await assistant.getByRole("button", { name: "Continue with Instagram Login" }).count(),
    0,
  );
  await assistant.locator("summary").click();

  await page.getByLabel("Account name").fill(editedName);
  await page.getByLabel("Niche").fill("Edited podcast and music clips");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("heading", { level: 1, name: editedName, exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Changes saved." }).waitFor();

  const autonomySwitch = page.getByRole("switch");
  if (!(await autonomySwitch.isChecked())) await autonomySwitch.click();
  await page.getByLabel("Cadence").selectOption("monthly");
  await page.getByLabel("Maximum publications per day").fill("3");
  await page.getByRole("button", { name: "Save policy" }).click();
  await page.getByRole("status").filter({ hasText: "Changes saved." }).waitFor();
  assert.equal(await autonomySwitch.isChecked(), true);
  assert.equal(await page.getByLabel("Cadence").inputValue(), "monthly");
  assert.equal(await page.getByLabel("Maximum publications per day").inputValue(), "3");

  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  const modelSetupBanner = page.getByTestId("chat-error-banner");
  await modelSetupBanner
    .getByText("No model available. Configure a provider and model in Model Settings.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await modelSetupBanner.getByRole("button", { name: /upgrade/i }).count(),
    0,
    "Social Harness model setup must not offer a Coding Plan upgrade without its owner",
  );
  await modelSetupBanner.getByRole("button", { name: "Set", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "AI model providers" }).waitFor();
  await page.getByRole("button", { name: "Add provider" }).click();
  assert.equal(
    await page.getByTestId("model-provider-template-item-zai-standard-api").count(),
    1,
    "Social Harness must offer the direct Z.ai API-key template",
  );
  assert.equal(
    await page.getByTestId("model-provider-template-item-bigmodel-standard-api").count(),
    1,
    "Social Harness must offer the direct BigModel API-key template",
  );
  assert.equal(
    await page.getByTestId("model-provider-template-item-zai-api").count(),
    0,
    "Social Harness must filter the Z.ai Coding Plan template",
  );
  assert.equal(
    await page.getByTestId("model-provider-template-item-bigmodel-api").count(),
    0,
    "Social Harness must filter the BigModel Coding Plan template",
  );
  assert.equal(
    await page
      .getByRole("button", { name: /Coding Plan|Start Plan|sign in|log in|purchase|upgrade/i })
      .count(),
    0,
    "Social Harness model settings must not expose account login or Coding Plan purchase",
  );
  await page.getByRole("button", { name: "Create custom provider" }).click();
  const newProvider = page.getByRole("button", { name: "New provider", exact: true });
  await newProvider.waitFor();
  await newProvider.click();
  const baseUrl = page.getByTestId("model-provider-base-url-input");
  await baseUrl.fill("https://api.example.invalid/v1");
  await baseUrl.press("Tab");
  await waitForRuntimeOutput(
    runtime,
    "provider-settings.savePersonalProviderOverlay OK",
    "Custom provider endpoint save",
  );
  assert.equal(await baseUrl.inputValue(), "https://api.example.invalid/v1");
}

export async function verifyAccountAfterRelaunch(page, editedName) {
  await page.getByRole("heading", { level: 1, name: editedName, exact: true }).waitFor();
  assert.equal(await page.title(), "Social Harness");
  assert.equal(await page.getByLabel("Niche").inputValue(), "Edited podcast and music clips");
  assert.equal(
    await page.getByLabel("Visual style").inputValue(),
    "Bright editorial captions with restrained motion",
  );
  await page
    .getByRole("region", { name: "Instagram connection" })
    .getByText("Instagram not connected", { exact: true })
    .waitFor();
  assert.equal(await page.getByRole("switch").isChecked(), true);
  assert.equal(await page.getByLabel("Cadence").inputValue(), "monthly");
  assert.equal(await page.getByLabel("Maximum publications per day").inputValue(), "3");

  await page.getByTestId("social-model-settings-open").click();
  await page.getByRole("heading", { level: 1, name: "AI model providers" }).waitFor();
  const newProvider = page.getByRole("button", { name: "New provider", exact: true });
  await newProvider.click();
  assert.equal(
    await page.getByTestId("model-provider-base-url-input").inputValue(),
    "https://api.example.invalid/v1",
  );
}

export async function createSecondAccountAndVerifyIsolation(
  page,
  firstAccountName,
  projectName,
  mediaNames,
  runId,
) {
  const secondAccountName = `Music pilot ${runId}`;
  const accountsNavigation = page.locator('[aria-label="Accounts"]');
  const candidateHandoffs = createSocialProjectCandidateHandoffScenarios(runId);
  await createCandidateProjectsInElectron(page, candidateHandoffs);
  const projectNames = [projectName, ...candidateHandoffs.map((handoff) => handoff.projectName)];
  const isolatedMediaNames = [
    ...mediaNames,
    ...candidateHandoffs.map((handoff) => handoff.mediaName),
  ];

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Account name").fill(secondAccountName);
  await page.getByLabel("Niche").fill("Independent music");
  await page.getByLabel("Audience").fill("Music listeners");
  await page.getByLabel("Visual style").fill("Minimal captions with warm colors");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: secondAccountName, exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Changes saved." }).waitFor();

  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByText("No projects yet.", { exact: true }).waitFor();
  for (const isolatedProjectName of projectNames) {
    assert.equal(
      await page.getByRole("button", { name: isolatedProjectName }).count(),
      0,
      "A second account must not list the first account's project",
    );
  }

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Bring in your first source", exact: true }).waitFor();
  for (const mediaName of isolatedMediaNames) {
    assert.equal(
      await page.getByRole("heading", { name: mediaName, exact: true }).count(),
      0,
      "A second account must not list the first account's media: " + mediaName,
    );
  }

  await accountsNavigation.getByRole("button", { name: firstAccountName }).click();
  for (const mediaName of isolatedMediaNames) {
    await page.getByRole("heading", { name: mediaName, exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Player", exact: true }).click();
  for (const isolatedProjectName of projectNames) {
    await page.getByRole("button", { name: isolatedProjectName }).waitFor();
  }

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  assert.equal(await page.getByLabel("Account name").inputValue(), firstAccountName);
  await accountsNavigation.getByRole("button", { name: secondAccountName }).click();
  assert.equal(await page.getByLabel("Account name").inputValue(), secondAccountName);
  assert.equal(await page.getByLabel("Niche").inputValue(), "Independent music");
  await accountsNavigation.getByRole("button", { name: firstAccountName }).click();
  assert.equal(await page.getByLabel("Account name").inputValue(), firstAccountName);

  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: projectName }).waitFor();
}
