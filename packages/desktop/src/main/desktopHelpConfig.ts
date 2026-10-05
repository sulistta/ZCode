import { resolveHelpAppConfig } from "@social-harness/shared";
import { readLocalAppConfig } from "./desktopCommandHandlers.js";

export function createDesktopHelpConfigReader() {
  return async () => resolveHelpAppConfig(null, await readLocalAppConfig());
}
