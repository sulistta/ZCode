export interface DesktopE2ESaveDialog {
  showSaveDialog(): { canceled: true };
}

export function createDesktopE2ESaveDialog(options: {
  isPackaged: boolean;
  env: Record<string, string | undefined>;
}): DesktopE2ESaveDialog | null {
  const isExplicitDevelopmentE2E =
    !options.isPackaged && Boolean(options.env.SOCIAL_HARNESS_E2E_CDP_PORT?.trim());
  const response = options.env.SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE;
  if (!isExplicitDevelopmentE2E || response === undefined) return null;
  if (response !== "cancel") {
    throw new Error('SOCIAL_HARNESS_E2E_SAVE_DIALOG_RESPONSE only supports "cancel"');
  }

  return {
    showSaveDialog: () => ({ canceled: true }),
  };
}
