import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { InlineEditableProviderCard } from "@/settings/model-provider-section/InlineEditableProviderCard.js";
import { ProviderTemplatePicker } from "@/settings/model-provider-section/ProviderTemplatePicker.js";
import {
  filterSocialModelProviderTemplates,
  filterSocialModelProviders,
} from "./socialModelSettingsModel.js";

export function SocialModelSettings() {
  const { intl, locale } = useZCodeIntl();
  const {
    modelProviders,
    providerTemplates,
    loading,
    loadError,
    reload,
    saveProvider,
    createPersonalProvider,
    addPersonalModel,
    savePersonalModelDraft,
    setPersonalModelEnabled,
    deletePersonalModel,
    reorderProviderModels,
  } = useModelProviders({ workspacePath: "" });
  const providers = useMemo(() => filterSocialModelProviders(modelProviders), [modelProviders]);
  const templates = useMemo(
    () => filterSocialModelProviderTemplates(providerTemplates),
    [providerTemplates],
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [pendingCreatedProviderId, setPendingCreatedProviderId] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [creatingProvider, setCreatingProvider] = useState(false);

  useEffect(() => {
    const pendingProvider = providers.find(
      (provider) => provider.providerId === pendingCreatedProviderId,
    );
    const currentProvider = providers.find(
      (provider) => provider.providerId === selectedProviderId,
    );
    const nextProviderId =
      pendingProvider?.providerId ??
      currentProvider?.providerId ??
      providers[0]?.providerId ??
      null;
    if (selectedProviderId !== nextProviderId) setSelectedProviderId(nextProviderId);
    if (pendingProvider) setPendingCreatedProviderId(null);
  }, [pendingCreatedProviderId, providers, selectedProviderId]);

  const selectedProvider =
    providers.find((provider) => provider.providerId === selectedProviderId) ?? null;

  const handleCreateProvider = useCallback(
    async (input: { templateId?: string; providerName?: string }) => {
      setCreatingProvider(true);
      try {
        const created = await createPersonalProvider({ ...input, locale });
        setPendingCreatedProviderId(created.providerId);
        setTemplatePickerOpen(false);
      } finally {
        setCreatingProvider(false);
      }
    },
    [createPersonalProvider, locale],
  );

  return (
    <section className="mx-auto max-w-6xl space-y-5" aria-labelledby="social-model-settings-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="social-model-settings-title" className="text-ui-xl font-semibold">
            {intl.formatMessage({ id: "socialAccounts.models.title" })}
          </h1>
          <p className="mt-2 max-w-3xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialAccounts.models.description" })}
          </p>
        </div>
        <Button type="button" onClick={() => setTemplatePickerOpen(true)}>
          <Plus aria-hidden="true" />
          {intl.formatMessage({ id: "socialAccounts.models.addProvider" })}
        </Button>
      </header>

      {loadError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-4"
          role="alert"
        >
          <span className="text-ui-sm text-destructive">{loadError.message}</span>
          <Button type="button" variant="outline" onClick={() => void reload()}>
            <RefreshCw aria-hidden="true" />
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        </div>
      ) : (
        <div className="grid min-h-[32rem] overflow-clip rounded-xl border border-border bg-card md:grid-cols-[240px_minmax(0,1fr)]">
          <nav
            aria-label={intl.formatMessage({ id: "socialAccounts.models.configuredProviders" })}
            className="min-w-0 border-b border-border p-3 md:border-r md:border-b-0"
          >
            <h2 className="mb-3 px-2 text-ui-sm font-medium text-foreground-subtle">
              {intl.formatMessage({ id: "socialAccounts.models.configuredProviders" })}
            </h2>
            <div className="grid gap-1">
              {providers.map((provider) => {
                const active = provider.providerId === selectedProviderId;
                return (
                  <button
                    key={provider.providerId}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setSelectedProviderId(provider.providerId)}
                    className={`min-h-10 truncate rounded-md px-3 text-left text-ui-sm ${active ? "bg-selected text-foreground" : "text-foreground hover:bg-surface-hover"}`}
                  >
                    {getProviderFormLabel(provider)}
                  </button>
                );
              })}
              {!loading && providers.length === 0 ? (
                <p className="px-2 py-2 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "socialAccounts.models.empty" })}
                </p>
              ) : null}
            </div>
          </nav>

          <main className="relative min-w-0 p-4 sm:p-6">
            {templatePickerOpen ? (
              <ProviderTemplatePicker
                templates={templates}
                creating={creatingProvider}
                onBack={() => setTemplatePickerOpen(false)}
                onCreateFromTemplate={(templateId) => handleCreateProvider({ templateId })}
                onCreateCustom={(providerName) => handleCreateProvider({ providerName })}
              />
            ) : loading && !selectedProvider ? (
              <p className="py-8 text-center text-ui-sm text-foreground-subtle" role="status">
                {intl.formatMessage({ id: "common.loading" })}
              </p>
            ) : selectedProvider ? (
              <InlineEditableProviderCard
                key={selectedProvider.providerId}
                provider={selectedProvider}
                onSave={async (provider) => {
                  await saveProvider(provider);
                }}
                onAddPersonalModel={addPersonalModel}
                onSavePersonalModelDraft={savePersonalModelDraft}
                onSetPersonalModelEnabled={setPersonalModelEnabled}
                onDeletePersonalModel={deletePersonalModel}
                onReorderModelIds={(modelIds) =>
                  reorderProviderModels(selectedProvider.providerId, modelIds)
                }
                settingsRevision={undefined}
              />
            ) : (
              <p className="py-8 text-center text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "socialAccounts.models.empty" })}
              </p>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
