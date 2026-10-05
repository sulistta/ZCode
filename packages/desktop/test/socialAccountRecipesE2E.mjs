import assert from "node:assert/strict";

export async function createAndRunAccountRecipe(page) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  const recipes = page.getByRole("region", { name: "Saved script recipes", exact: true });
  await recipes.getByRole("button", { name: "New recipe", exact: true }).click();
  const editor = page.getByRole("region", { name: "Recipe editor", exact: true });
  await editor.getByLabel("Recipe name", { exact: true }).fill("reviewed-daily");
  await editor.getByLabel("Description", { exact: true }).fill("Reviewed account fixture");
  await editor
    .getByLabel("Script", { exact: true })
    .fill("log('REVIEWED_ACCOUNT_RECIPE'); return 'reviewed';");
  await editor.getByRole("button", { name: "Save recipe", exact: true }).click();
  await recipes.getByRole("heading", { name: "reviewed-daily", exact: true }).waitFor();
  await recipes.getByRole("button", { name: "Edit recipe", exact: true }).click();
  await editor.getByLabel("Script", { exact: true }).fill("return invalidAccountRecipe;");
  await editor.getByRole("button", { name: "Save recipe", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "invalidAccountRecipe" }).waitFor();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await recipes.getByRole("button", { name: "Review and run", exact: true }).click();
  const review = page.getByRole("region", { name: "Review recipe execution", exact: true });
  await review
    .getByText("log('REVIEWED_ACCOUNT_RECIPE'); return 'reviewed';", { exact: true })
    .waitFor();
  assert.equal(await review.getByText("invalidAccountRecipe", { exact: true }).count(), 0);
  await review.getByRole("button", { name: "Run reviewed version", exact: true }).click();
  await page.getByRole("heading", { name: "Conversations", exact: true }).waitFor();
  // 引擎日志属于详情投影，不保证在会话卡展开前可见；检查真正被选中的父会话及 journal 历史。
  const conversation = page.getByRole("button", { name: "reviewed-daily", exact: true });
  await conversation.waitFor();
  assert.equal(await conversation.getAttribute("aria-current"), "page");
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  await recipes.getByRole("button", { name: "Refresh recipes", exact: true }).click();
  await recipes.getByText("Completed", { exact: true }).first().waitFor();
  await recipes.getByRole("button", { name: "Open conversation", exact: true }).first().click();
  await page.getByRole("heading", { name: "Conversations", exact: true }).waitFor();
  await conversation.waitFor();
  assert.equal(await conversation.getAttribute("aria-current"), "page");
}

export async function verifyAccountRecipeAfterRelaunch(page) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  const recipes = page.getByRole("region", { name: "Saved script recipes", exact: true });
  await recipes.getByRole("heading", { name: "reviewed-daily", exact: true }).waitFor();
  await recipes.getByText("Completed", { exact: true }).first().waitFor();
}

export async function verifyAccountRecipeIsolation(page) {
  await page
    .getByRole("navigation", { name: "Social Harness" })
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  const recipes = page.getByRole("region", { name: "Saved script recipes", exact: true });
  await recipes
    .getByText("No saved script recipes in this account yet.", { exact: true })
    .waitFor();
  assert.equal(await recipes.getByRole("heading", { name: "reviewed-daily" }).count(), 0);
  assert.equal(
    await recipes.getByRole("button", { name: "Open conversation", exact: true }).count(),
    0,
  );
}
