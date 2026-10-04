import type { ArmsRumEnv, FinalArmsCustomEventPayload } from "@social-harness/shared";

import type { SocialHarnessDataSizeScanResult } from "./socialHarnessDataSizeScanner.js";

function normalizeOsCategory(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

function stringifyProperties(
  properties: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

/**
 * 此统计现在只描述 Social Harness 的数据根；使用新产品事件名，避免新数据进入旧 ZCode 指标。
 */
export function buildSocialHarnessDataSizeArmsPayload(params: {
  context: {
    appVersion: string;
    armsEnv: ArmsRumEnv;
    dataRootKind: "custom" | "default";
    deviceMid: string;
    platform: NodeJS.Platform;
  };
  result: SocialHarnessDataSizeScanResult;
}): FinalArmsCustomEventPayload {
  const eventName = "perf_resource_social_harness_data_size";
  return {
    group: "resource",
    name: eventName,
    properties: stringifyProperties({
      app_version: params.context.appVersion,
      arms_env: params.context.armsEnv,
      data_root_kind: params.context.dataRootKind,
      device_mid: params.context.deviceMid,
      directories_scanned: params.result.directoriesScanned,
      event_name: eventName,
      files_scanned: params.result.filesScanned,
      metric_kind: "social_harness_data_bytes",
      metric_value: params.result.bytes,
      partial_reason: params.result.partialReason,
      platform: normalizeOsCategory(params.context.platform),
      scan_duration_ms: params.result.durationMs,
      scan_error_count: params.result.scanErrorCount,
      scan_status: params.result.status,
      schema_version: 2,
      social_harness_data_bytes: params.result.bytes,
    }),
    type: "custom",
    value: params.result.bytes,
  };
}
