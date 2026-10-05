import type { CommandCenterPromptInput, CommandCenterSubmitPromptResult } from "./contracts.js";
import type { CommandCenterApp, CommandCenterDeps } from "./types.js";

export function normalizeCommandCenterPromptInput(input: CommandCenterPromptInput): Exclude<CommandCenterPromptInput, string> {
  if (typeof input === "string") return { text: input };
  return input;
}

export function attachCurrentSessionMetadata(
  result: CommandCenterSubmitPromptResult,
  deps: CommandCenterDeps,
  app?: CommandCenterApp,
): CommandCenterSubmitPromptResult {
  return {
    ...result,
    locale: result.locale ?? app?.getLocale?.(),
    mode: result.mode ?? deps.getMode?.(),
    model: result.model ?? app?.getModel?.(),
    theme: result.theme ?? app?.getTheme?.(),
    thoughtLevel: result.thoughtLevel ?? app?.getThoughtLevel?.(),
  };
}
