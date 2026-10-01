import { getZCodeCopy } from "@social-harness/i18n";

export function loginRequiredResponse(locale?: string): string {
  const copy = getZCodeCopy(locale).commandCenter.loginRequired;
  return [copy.message, copy.help].join("\n");
}
