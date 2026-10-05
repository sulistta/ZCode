import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { IPlatformService, InstagramConnection } from "@social-harness/shared";
import type {
  SocialAccountService,
  SocialMediaService,
  SocialMediaPreviewService,
  SocialProjectService,
  SocialPublishingService,
} from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import { DesktopWindowFrame } from "@/DesktopWindowFrame.js";
import { WindowsTopLeftLogo } from "@/WindowsTopLeftLogo.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialAccountPolicyForm } from "./SocialAccountPolicyForm.js";
import { SocialAccountProfileForm } from "./SocialAccountProfileForm.js";
import { SocialAccountsNavigation } from "./SocialAccountsNavigation.js";
import type { SocialMediaView } from "./socialAccountsModel.js";
import { SocialLibraryHome } from "./SocialLibraryHome.js";
import { SocialConversationsHome } from "./SocialConversationsHome.js";
import { SocialProjectWorkbench } from "./SocialProjectWorkbench.js";
import { useSocialInstagramConnections } from "./useSocialInstagramConnections.js";
import { SocialInstagramConnectionPanel } from "./SocialInstagramConnectionPanel.js";
import { SocialInstagramMediaPanel } from "./SocialInstagramMediaPanel.js";
import { useSocialInstagramMedia } from "./useSocialInstagramMedia.js";
import { useSocialAccountEditor } from "./useSocialAccountEditor.js";
import { SocialAccountAutomationsHome } from "./SocialAccountAutomationsHome.js";
import { SocialInstagramSetup } from "./SocialInstagramSetup.js";
import { SocialModelSettings } from "./SocialModelSettings.js";

export function SocialAccountsHome({
  service,
  mediaService,
  mediaPreviewService,
  projectService,
  publishingService,
  platform,
  isDesktop = false,
  isMacDesktop = false,
  isWindowsDesktop = false,
}: {
  service: SocialAccountService;
  mediaService?: SocialMediaService;
  mediaPreviewService?: SocialMediaPreviewService;
  projectService?: SocialProjectService;
  publishingService?: SocialPublishingService;
  platform: IPlatformService;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const setupService = useOptionalServices()?.socialInstagramSetupService;
  const {
    accounts,
    beginCreate,
    draft,
    formError,
    isCreating,
    isLoading,
    isSaving,
    loadAccounts,
    loadFailed,
    notice,
    policyDraft,
    reloadSelectedAccount,
    savePolicy,
    saveProfile,
    selectedAccount,
    selectedAccountId,
    selectAccount,
    setDraft,
    setPolicyDraft,
  } = useSocialAccountEditor(service);
  const [activeView, setActiveView] = useState<SocialMediaView>("accounts");
  const [conversationRequest, setConversationRequest] = useState<{
    accountId: string;
    sessionId: string;
  } | null>(null);
  const openAccountConversation = useCallback(
    (accountId: string, sessionId: string) => {
      selectAccount(accountId);
      setConversationRequest({ accountId, sessionId });
      setActiveView("conversations");
    },
    [selectAccount],
  );
  const openModelSettings = useCallback(() => setActiveView("model-settings"), []);
  const instagramConnections = useSocialInstagramConnections({
    accounts,
    service: publishingService,
    platform,
    isDesktop,
  });
  const selectedConnection = useMemo<InstagramConnection | null>(() => {
    if (!selectedAccount) return null;
    return (
      instagramConnections.connectionByAccount[selectedAccount.accountId] ?? {
        accountId: selectedAccount.accountId,
        status: "disconnected",
        profile: null,
        connectedAt: null,
      }
    );
  }, [instagramConnections.connectionByAccount, selectedAccount]);
  const instagramMedia = useSocialInstagramMedia({
    accountId: selectedAccount?.accountId ?? null,
    connectionStatus: selectedConnection?.status ?? "disconnected",
    enabled: activeView === "accounts" && !isCreating,
    service: publishingService,
  });

  const handleBeginCreate = () => {
    setActiveView("accounts");
    beginCreate();
  };

  const contentTitle = isCreating
    ? intl.formatMessage({ id: "socialAccounts.newAccount" })
    : (selectedAccount?.displayName ?? intl.formatMessage({ id: "socialAccounts.title" }));

  return (
    <DesktopWindowFrame
      title={intl.formatMessage({ id: "socialAccounts.brand" })}
      isDesktop={isDesktop}
      isMacDesktop={isMacDesktop}
      isWindowsDesktop={isWindowsDesktop}
    >
      <main className="relative h-full min-h-0 bg-background text-foreground">
        {isDesktop ? (
          <div className="absolute inset-x-0 top-0 z-20 h-12 [app-region:drag]" />
        ) : null}
        {isWindowsDesktop ? <WindowsTopLeftLogo /> : null}
        {isDesktop && !isMacDesktop ? (
          <div className="pointer-events-auto absolute right-1 top-1 z-30 mt-px mr-px flex h-12 items-center gap-0.5 px-2 [app-region:no-drag]">
            <DesktopWindowControls />
          </div>
        ) : null}
        <div className="mx-auto grid h-full min-h-0 max-w-[1680px] grid-cols-1 md:grid-cols-[208px_264px_minmax(0,1fr)]">
          <SocialAccountsNavigation
            accounts={accounts}
            connectionByAccount={instagramConnections.connectionByAccount}
            selectedAccountId={selectedAccountId}
            isCreating={isCreating}
            activeView={activeView}
            canOpenConversations={Boolean(selectedAccount && !isCreating)}
            canOpenLibrary={Boolean(mediaService && selectedAccount && !isCreating)}
            canOpenPlayer={Boolean(isDesktop && projectService && selectedAccount && !isCreating)}
            canOpenAutomations={Boolean(isDesktop && selectedAccount && !isCreating)}
            isDesktop={isDesktop}
            onNavigate={setActiveView}
            onCreate={handleBeginCreate}
            onSelect={selectAccount}
          />
          <section
            className={`min-h-0 min-w-0 px-4 md:px-8 ${activeView === "conversations" ? "overflow-hidden" : "overflow-y-auto"} ${isDesktop ? (activeView === "conversations" ? "pt-14" : "pt-14 pb-8") : activeView === "conversations" ? "" : "py-5 md:py-8"}`}
          >
            {activeView === "conversations" && selectedAccount ? (
              <SocialConversationsHome
                key={selectedAccount.accountId}
                account={selectedAccount}
                service={service}
                isDesktop={isDesktop}
                onOpenModelSettings={openModelSettings}
                requestedSessionId={
                  conversationRequest?.accountId === selectedAccount.accountId
                    ? conversationRequest.sessionId
                    : undefined
                }
              />
            ) : activeView === "library" && mediaService && selectedAccount ? (
              <SocialLibraryHome
                key={selectedAccount.accountId}
                account={selectedAccount}
                service={mediaService}
              />
            ) : activeView === "player" && projectService && selectedAccount ? (
              <SocialProjectWorkbench
                key={selectedAccount.accountId}
                account={selectedAccount}
                service={projectService}
                mediaService={mediaService}
                mediaPreviewService={mediaPreviewService}
                publishingService={publishingService}
                instagramConnected={selectedConnection?.status === "connected"}
              />
            ) : activeView === "automations" && selectedAccount ? (
              <SocialAccountAutomationsHome
                key={selectedAccount.accountId}
                account={selectedAccount}
                accountService={service}
                onOpenConversation={(sessionId) =>
                  openAccountConversation(selectedAccount.accountId, sessionId)
                }
              />
            ) : activeView === "model-settings" ? (
              <SocialModelSettings />
            ) : (
              <div className="mx-auto max-w-4xl">
                <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-ui-xs font-medium text-foreground">
                      {intl.formatMessage({ id: "socialAccounts.localFirst" })}
                    </div>
                    <h1 className="text-ui-xl font-semibold">
                      {isCreating || selectedAccount
                        ? contentTitle
                        : intl.formatMessage({ id: "socialAccounts.title" })}
                    </h1>
                    <p className="mt-2 max-w-2xl text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: "socialAccounts.description" })}
                    </p>
                  </div>
                  <p className="max-w-sm text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "socialAccounts.noProviderRequired" })}
                  </p>
                </header>

                {isLoading && accounts.length === 0 ? (
                  <div
                    className="rounded-lg border border-border bg-card px-4 py-6 text-ui-base text-foreground-subtle"
                    role="status"
                  >
                    {intl.formatMessage({ id: "socialAccounts.status.loading" })}
                  </div>
                ) : loadFailed ? (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-4"
                    role="alert"
                  >
                    <span className="text-ui-base text-foreground">
                      {intl.formatMessage({ id: "socialAccounts.status.loadFailed" })}
                    </span>
                    <Button type="button" variant="outline" onClick={() => void loadAccounts()}>
                      <RefreshCw aria-hidden="true" />
                      {intl.formatMessage({ id: "socialAccounts.retry" })}
                    </Button>
                  </div>
                ) : !isCreating && !selectedAccount ? (
                  <div className="rounded-lg border border-border bg-card px-5 py-8">
                    <h2 className="text-ui-lg font-semibold">
                      {intl.formatMessage({ id: "socialAccounts.emptyTitle" })}
                    </h2>
                    <p className="mt-2 max-w-xl text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: "socialAccounts.emptyDescription" })}
                    </p>
                    <Button type="button" className="mt-5" onClick={beginCreate}>
                      {intl.formatMessage({ id: "socialAccounts.createFirst" })}
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-5">
                    {!isCreating && selectedAccount && selectedConnection ? (
                      <SocialInstagramConnectionPanel
                        connection={selectedConnection}
                        isDesktop={isDesktop}
                        authorizationAvailability={instagramConnections.authorizationAvailability}
                        isBusy={instagramConnections.busyAccountId === selectedAccount.accountId}
                        errorMessageId={instagramConnections.errorMessageId}
                        noticeMessageId={instagramConnections.noticeMessageId}
                        onConnect={() =>
                          void instagramConnections.connect(selectedAccount.accountId)
                        }
                        onDisconnect={() =>
                          void instagramConnections.disconnect(selectedAccount.accountId)
                        }
                        onRetryAuthorizationAvailability={() =>
                          void instagramConnections.reloadAuthorizationAvailability()
                        }
                      />
                    ) : null}
                    {!isCreating &&
                    selectedAccount &&
                    setupService &&
                    isDesktop &&
                    selectedConnection ? (
                      <SocialInstagramSetup
                        service={setupService}
                        platform={platform}
                        onReady={instagramConnections.reloadAuthorizationAvailability}
                        onConnect={() =>
                          void instagramConnections.connect(selectedAccount.accountId)
                        }
                        connectionStatus={selectedConnection.status}
                      />
                    ) : null}
                    {!isCreating &&
                    selectedAccount &&
                    publishingService &&
                    selectedConnection?.status === "connected" ? (
                      <SocialInstagramMediaPanel
                        media={instagramMedia.media}
                        isLoading={instagramMedia.isLoading}
                        errorMessageId={instagramMedia.errorMessageId}
                        platform={platform}
                        onReload={instagramMedia.reload}
                      />
                    ) : null}
                    <SocialAccountProfileForm
                      draft={draft}
                      setDraft={setDraft}
                      isCreating={isCreating}
                      isSaving={isSaving}
                      onSave={() => void saveProfile()}
                    />
                    {!isCreating ? (
                      <SocialAccountPolicyForm
                        draft={policyDraft}
                        setDraft={setPolicyDraft}
                        preferredSources={draft.preferredSources}
                        isSaving={isSaving}
                        onSave={() => void savePolicy()}
                      />
                    ) : null}
                    {formError ? (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-card px-3 py-2"
                        role="alert"
                      >
                        <span className="text-ui-sm text-destructive">{formError}</span>
                        {!isCreating && selectedAccount ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void reloadSelectedAccount()}
                          >
                            <RefreshCw aria-hidden="true" />
                            {intl.formatMessage({ id: "socialAccounts.retry" })}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {notice ? (
                      <p
                        className="rounded-md border border-success/30 bg-card px-3 py-2 text-ui-sm text-success"
                        role="status"
                      >
                        {notice}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </DesktopWindowFrame>
  );
}
