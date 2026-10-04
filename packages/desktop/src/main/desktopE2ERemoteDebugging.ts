export interface DesktopE2ERemoteDebuggingConfig {
  port: number;
  appendSwitch: boolean;
}

export function resolveDesktopE2ERemoteDebuggingConfig(options: {
  isPackaged: boolean;
  productFlavor: "production" | "preview";
  env: Record<string, string | undefined>;
}): DesktopE2ERemoteDebuggingConfig | null {
  const requestedPort = options.env.SOCIAL_HARNESS_E2E_CDP_PORT?.trim();
  const developmentAllowed =
    !options.isPackaged && options.env.SOCIAL_HARNESS_DISABLE_FIXED_REMOTE_DEBUGGING_PORT !== "1";
  const packagedPreviewTestAllowed =
    options.isPackaged &&
    options.productFlavor === "preview" &&
    options.env.SOCIAL_HARNESS_E2E_PACKAGED_PREVIEW === "1" &&
    Boolean(requestedPort);

  if (!developmentAllowed && !packagedPreviewTestAllowed) return null;

  const port = requestedPort ? Number(requestedPort) : 9229;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SOCIAL_HARNESS_E2E_CDP_PORT must be an integer from 1 to 65535");
  }

  return {
    port,
    // Dev launcher already puts its dynamically reserved port on Electron's command line.
    // A packaged Preview has no dev launcher, so its explicit opt-in must add the switch here.
    appendSwitch: options.isPackaged || !requestedPort,
  };
}
