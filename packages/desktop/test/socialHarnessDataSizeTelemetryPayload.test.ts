import assert from "node:assert/strict";
import test from "node:test";
import { buildSocialHarnessDataSizeArmsPayload } from "../src/main/socialHarnessDataSizeTelemetryPayload.js";

test("data size telemetry uses the Social Harness version-2 metric contract", () => {
  const payload = buildSocialHarnessDataSizeArmsPayload({
    context: {
      appVersion: "1.2.3",
      armsEnv: "prod",
      dataRootKind: "default",
      deviceMid: "device-mid",
      platform: "darwin",
    },
    result: {
      bytes: 4096,
      directoriesScanned: 3,
      durationMs: 27,
      filesScanned: 11,
      scanErrorCount: 0,
      status: "complete",
    },
  });

  assert.deepEqual(payload, {
    group: "resource",
    name: "perf_resource_social_harness_data_size",
    properties: {
      app_version: "1.2.3",
      arms_env: "prod",
      data_root_kind: "default",
      device_mid: "device-mid",
      directories_scanned: "3",
      event_name: "perf_resource_social_harness_data_size",
      files_scanned: "11",
      metric_kind: "social_harness_data_bytes",
      metric_value: "4096",
      platform: "macos",
      scan_duration_ms: "27",
      scan_error_count: "0",
      scan_status: "complete",
      schema_version: "2",
      social_harness_data_bytes: "4096",
    },
    type: "custom",
    value: 4096,
  });
  assert.doesNotMatch(JSON.stringify(payload), /zcode/i);
});

test("partial data size telemetry preserves the bounded scan reason", () => {
  const payload = buildSocialHarnessDataSizeArmsPayload({
    context: {
      appVersion: "1.2.3",
      armsEnv: "local",
      dataRootKind: "custom",
      deviceMid: "device-mid",
      platform: "linux",
    },
    result: {
      bytes: 1024,
      directoriesScanned: 2,
      durationMs: 30_000,
      filesScanned: 200_000,
      partialReason: "time_limit",
      scanErrorCount: 1,
      status: "partial",
    },
  });

  assert.equal(payload.properties.partial_reason, "time_limit");
  assert.equal(payload.properties.scan_status, "partial");
  assert.equal(payload.properties.social_harness_data_bytes, "1024");
});
