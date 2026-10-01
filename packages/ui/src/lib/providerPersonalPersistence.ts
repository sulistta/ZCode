import type { IProviderSettingsService, ProviderSettingsView } from "@social-harness/services";

export async function persistPersonalProviderDeletion(params: {
  providerId: string;
  providerSettingsService: Pick<IProviderSettingsService, "deletePersonalProvider">;
}): Promise<ProviderSettingsView> {
  return params.providerSettingsService.deletePersonalProvider(params.providerId);
}
