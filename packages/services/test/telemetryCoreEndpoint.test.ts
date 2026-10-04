import assert from "node:assert/strict";
import test from "node:test";
import { resolveSocialHarnessTelemetryReportEndpoint } from "../src/telemetry/telemetryCore.js";

test("Social Harness telemetry uses an explicit absolute HTTP(S) endpoint directly", () => {
  const endpoint = "https://telemetry.social.example.test/v1/report?source=desktop";

  assert.equal(resolveSocialHarnessTelemetryReportEndpoint(endpoint), endpoint);
  assert.equal(
    resolveSocialHarnessTelemetryReportEndpoint("http://127.0.0.1:4318/v1/report"),
    "http://127.0.0.1:4318/v1/report",
  );
  assert.equal(resolveSocialHarnessTelemetryReportEndpoint(""), null);
  assert.equal(resolveSocialHarnessTelemetryReportEndpoint("/v1/report"), null);
});

test("telemetry refuses the retired ZCode API host instead of rewriting its destination", () => {
  assert.equal(
    resolveSocialHarnessTelemetryReportEndpoint("https://zcode.z.ai/api/v1/event/report"),
    null,
  );
  assert.equal(
    resolveSocialHarnessTelemetryReportEndpoint("https://telemetry.zcode.z.ai/api/v1/event/report"),
    null,
  );
});
