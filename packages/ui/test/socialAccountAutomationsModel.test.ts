import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeAutomation } from "@social-harness/shared";
import {
  AUTOMATION_TEMPLATES,
  draftFromAutomation,
  scheduleForDraft,
  type AutomationDraft,
} from "../src/social-accounts/socialAccountAutomationsModel.js";

function makeAutomation(overrides: Partial<ZCodeAutomation> = {}): ZCodeAutomation {
  return {
    automationId: "automation-1",
    title: "Weekly discovery",
    cronExpr: "0 9 * * 1",
    prompt: "Find sources for this account.",
    mode: "plan",
    workspaceKey: "social-account:account-1",
    workspacePath: "/tmp/social-harness/account-1",
    locationKind: "local",
    recurring: true,
    runCount: 0,
    enabled: true,
    lifecycleStatus: "active",
    dispatchStatus: "idle",
    dispatchAttempts: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    title: "Weekly discovery",
    prompt: "Find sources for this account.",
    frequency: "weekly",
    time: "17:05",
    weekday: 4,
    scheduleEditable: true,
    scheduleDirty: true,
    ...overrides,
  };
}

test("weekly account automation stores the selected local weekday and time", () => {
  const schedule = scheduleForDraft(makeDraft());

  assert.equal(schedule.cronExpr, "5 17 * * 4");
  assert.equal(schedule.scheduleRule.unit, "weekly");
  assert.equal(schedule.scheduleRule.interval, 1);
  assert.equal(schedule.scheduleRule.hour, 17);
  assert.equal(schedule.scheduleRule.minute, 5);
  assert.deepEqual(schedule.scheduleRule.weekdays, [4]);
  assert.ok(Number.isFinite(schedule.scheduleRule.anchorAt));
});

test("publication automation uses an executable account-scoped workflow template", () => {
  const publication = AUTOMATION_TEMPLATES.find((template) => template.id === "publication");
  assert.ok(publication);
  assert.equal(publication.mode, "build");
  assert.match(publication.prompt, /SocialPublicationRequest/u);
  assert.match(publication.prompt, /current project revision/u);
  assert.equal(draftFromAutomation(makeAutomation({ mode: "build" })).mode, "build");
});

test("daily account automation omits weekday and preserves non-simple schedules on edit", () => {
  const daily = scheduleForDraft(makeDraft({ frequency: "daily" }));
  assert.equal(daily.cronExpr, "5 17 * * *");
  assert.equal(daily.scheduleRule.unit, "daily");
  assert.equal(daily.scheduleRule.weekdays, undefined);

  const yearlyDraft = draftFromAutomation(
    makeAutomation({
      cronExpr: "0 9 1 1 *",
      scheduleRule: {
        unit: "yearly",
        interval: 1,
        hour: 9,
        minute: 0,
        anchorAt: 1,
      },
    }),
  );
  assert.equal(yearlyDraft.scheduleEditable, false);
});
