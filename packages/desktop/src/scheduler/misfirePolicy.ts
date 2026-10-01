import type { ZCodeAutomation } from "@social-harness/shared";

export const AUTOMATION_MISFIRE_GRACE_MS = 5 * 60_000;

export function isMissedAutomationFirstDispatch(
  automation: Pick<ZCodeAutomation, "nextRunAt" | "dispatchAttempts">,
  now: number,
): boolean {
  if (automation.dispatchAttempts > 0 || automation.nextRunAt == null) return false;
  // UI 与产品契约将边界定义为“超过五分钟”；等于五分钟仍应获得完整宽限期。
  return automation.nextRunAt < now - AUTOMATION_MISFIRE_GRACE_MS;
}
