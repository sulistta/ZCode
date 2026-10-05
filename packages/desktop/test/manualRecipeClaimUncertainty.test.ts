import assert from "node:assert/strict";
import { test } from "node:test";
import { settleManualClaimForDispatchResult } from "../src/scheduler/manualClaimRelease.js";
import { hostCronRunResultResponseSchema } from "@social-harness/shared";

test("an uncertain recipe ACK preserves the manual claim while normal dispatch failures release it", async () => {
  let releases = 0;
  const params = {
    repo: {
      async get() {
        return { workspaceKey: "social-account:a" };
      },
      async getRun() {
        return { workspaceKey: "social-account:a" };
      },
      async releaseManualClaim() {
        releases++;
      },
    },
    automationId: "recipe",
    runId: "recipe:manual:one",
    logError() {},
  };
  await settleManualClaimForDispatchResult({ ...params, ok: false, admissionUncertain: true });
  assert.equal(releases, 0);
  await settleManualClaimForDispatchResult({ ...params, ok: true });
  assert.equal(releases, 0);
  await settleManualClaimForDispatchResult({ ...params, ok: false });
  assert.equal(releases, 1);
});

test("cron result validation carries uncertainty only when confirmation failed", () => {
  const result = {
    type: "cron-run-result",
    runId: "recipe:100",
    ok: false,
    admissionUncertain: true,
  };
  assert.equal(hostCronRunResultResponseSchema.parse(result).admissionUncertain, true);
  assert.equal(hostCronRunResultResponseSchema.safeParse({ ...result, ok: true }).success, false);
  assert.equal(
    hostCronRunResultResponseSchema.safeParse({ ...result, admissionUncertain: "yes" }).success,
    false,
  );
  assert.equal(
    hostCronRunResultResponseSchema.safeParse({
      type: "cron-run-result",
      runId: "legacy:100",
      ok: true,
    }).success,
    true,
  );
});
