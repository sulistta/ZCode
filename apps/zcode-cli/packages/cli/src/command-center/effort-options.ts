import { getZCodeCopy, type UiLocale } from "@social-harness/i18n";
import type { CommandCenterEffortOption } from "./contracts.js";
import type { CommandCenterApp } from "./types.js";

export async function listAppEffortOptions(
  app: CommandCenterApp,
): Promise<CommandCenterEffortOption[] | undefined> {
  const levels = app.listThoughtLevels ? await app.listThoughtLevels() : undefined;
  return levels ? thoughtLevelsToEffortOptions(levels, app.getLocale?.()) : undefined;
}

export function thoughtLevelsToEffortOptions(
  levels: readonly string[],
  locale?: UiLocale,
): CommandCenterEffortOption[] {
  const effortCopy = getZCodeCopy(locale).commandCenter.effort;
  return levels.map((level) => ({
    id: level,
    label: effortLabel(level, effortCopy),
  }));
}

function effortLabel(level: string, effortCopy: { disabled: string; enabled: string }): string {
  if (level === "enabled") return effortCopy.enabled;
  if (level === "disabled") return effortCopy.disabled;
  return level;
}
