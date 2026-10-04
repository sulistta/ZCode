import { resolveHelpAppConfig, type Locale } from "@social-harness/shared";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  localConfig?: unknown;
}

export async function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  return resolveHelpAppConfig(null, options.localConfig ?? localDefaultAppConfig);
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return (await resolveWebHelpConfig(options)).community_urls?.[locale];
}
