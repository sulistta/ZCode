import { isAbsolute } from "node:path";

const MAX_FILE_PICKER_RESPONSES = 32;
const MAX_FILES_PER_RESPONSE = 16;

export interface DesktopE2EFilePicker {
  selectFiles(): string[];
}

export function createDesktopE2EFilePicker(options: {
  isPackaged: boolean;
  env: Record<string, string | undefined>;
}): DesktopE2EFilePicker | null {
  const isExplicitDevelopmentE2E =
    !options.isPackaged && Boolean(options.env.SOCIAL_HARNESS_E2E_CDP_PORT?.trim());
  const serializedResponses = options.env.SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES;
  if (!isExplicitDevelopmentE2E || serializedResponses === undefined) return null;

  let parsedResponses: unknown;
  try {
    parsedResponses = JSON.parse(serializedResponses) as unknown;
  } catch {
    throw new Error("SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES must be valid JSON");
  }
  if (!Array.isArray(parsedResponses) || parsedResponses.length > MAX_FILE_PICKER_RESPONSES) {
    throw new Error("SOCIAL_HARNESS_E2E_FILE_PICKER_RESPONSES must be a bounded array");
  }

  const responses = parsedResponses.map((response): string[] => {
    if (
      !Array.isArray(response) ||
      response.length > MAX_FILES_PER_RESPONSE ||
      !response.every((path) => typeof path === "string" && path.length > 0 && isAbsolute(path))
    ) {
      throw new Error("Social Harness E2E file-picker responses must contain absolute file paths");
    }
    return [...response] as string[];
  });

  let responseIndex = 0;
  return {
    selectFiles() {
      const response = responses[responseIndex];
      responseIndex += 1;
      return response ? [...response] : [];
    },
  };
}
