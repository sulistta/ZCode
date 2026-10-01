import type { ProviderSettingsView } from "@social-harness/services";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";

type ProviderTemplate = ProviderSettingsView["providerTemplates"][number];

export function isSocialModelProviderConfig(config: {
  group?: string | null;
  access?: { type?: string } | null;
}): boolean {
  return (
    (config.group == null || config.group === "standard-personal") &&
    config.access?.type === "api-key"
  );
}

export function filterSocialModelProviderTemplates(
  templates: readonly ProviderTemplate[],
): ProviderTemplate[] {
  return templates.filter((template) => isSocialModelProviderConfig(template.config));
}

export function filterSocialModelProviders(
  providers: readonly ProviderSettingsFormProvider[],
): ProviderSettingsFormProvider[] {
  return providers.filter((provider) => isSocialModelProviderConfig(provider.config));
}
