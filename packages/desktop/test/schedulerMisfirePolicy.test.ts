import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_MISFIRE_GRACE_MS,
  isMissedAutomationFirstDispatch,
} from "../src/scheduler/misfirePolicy.js";

test("a first scheduled dispatch stays eligible through the exact five-minute boundary", () => {
  const scheduledAt = 1_000_000;
  const automation = { nextRunAt: scheduledAt, dispatchAttempts: 0 };

  assert.equal(
    isMissedAutomationFirstDispatch(automation, scheduledAt + AUTOMATION_MISFIRE_GRACE_MS - 1),
    false,
  );
  assert.equal(
    isMissedAutomationFirstDispatch(automation, scheduledAt + AUTOMATION_MISFIRE_GRACE_MS),
    false,
  );
  assert.equal(
    isMissedAutomationFirstDispatch(automation, scheduledAt + AUTOMATION_MISFIRE_GRACE_MS + 1),
    true,
  );
});

test("a retry is not reclassified as a missed first dispatch", () => {
  const scheduledAt = 1_000_000;

  assert.equal(
    isMissedAutomationFirstDispatch(
      { nextRunAt: scheduledAt, dispatchAttempts: 1 },
      scheduledAt + AUTOMATION_MISFIRE_GRACE_MS + 60_000,
    ),
    false,
  );
});

test("an automation without a scheduled timestamp is not a missed run", () => {
  assert.equal(
    isMissedAutomationFirstDispatch({ nextRunAt: null, dispatchAttempts: 0 }, 2_000_000),
    false,
  );
});
