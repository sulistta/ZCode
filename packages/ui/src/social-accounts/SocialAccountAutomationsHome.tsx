import { CalendarClock, Plus } from "lucide-react";
import type { SocialAccount } from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { useSocialAccountAutomations } from "@/hooks/useSocialAccountAutomations.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialAccountAutomationForm } from "./SocialAccountAutomationForm.js";
import { SocialAccountAutomationList } from "./SocialAccountAutomationList.js";
import { SocialAccountAutomationNotices } from "./SocialAccountAutomationNotices.js";
import { SocialAccountRecipesPanel } from "./SocialAccountRecipesPanel.js";
import { SocialAccountRecipeReview } from "./SocialAccountRecipeReview.js";
import { AUTOMATION_TEMPLATES } from "./socialAccountAutomationsModel.js";

export function SocialAccountAutomationsHome({
  account,
  accountService,
  onOpenConversation,
}: {
  account: SocialAccount;
  accountService: SocialAccountService;
  onOpenConversation: (sessionId: string) => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const model = useSocialAccountAutomations(account, accountService);
  const {
    workspaceTarget,
    automations,
    runsByAutomation,
    expandedAutomationId,
    setExpandedAutomationId,
    draft,
    setDraft,
    isLoading,
    isSaving,
    busyAutomationId,
    loadFailed,
    workspaceUnavailable,
    actionFailed,
    noticeId,
    loadAutomations,
    loadRuns,
    startCreate,
    saveDraft,
    toggleEnabled,
    restart,
    runNow,
    deleteAutomation,
  } = model;

  return (
    <div className="mx-auto grid max-w-4xl gap-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-ui-xs font-medium text-foreground">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {intl.formatMessage({ id: "socialAccounts.nav.automations" })}
          </div>
          <h1 className="text-ui-xl font-semibold">
            {intl.formatMessage({ id: "socialAccounts.automations.title" })}
          </h1>
          <p className="mt-2 max-w-2xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "socialAccounts.automations.description" },
              { accountName: account.displayName },
            )}
          </p>
          <p className="mt-2 max-w-2xl text-ui-xs text-foreground-subtle">
            {intl.formatMessage(
              { id: "socialAccounts.automations.hostNotice" },
              {
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
            )}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => startCreate()}
          disabled={!workspaceTarget || Boolean(draft || model.replacement) || isSaving}
        >
          <Plus aria-hidden="true" />
          {intl.formatMessage({ id: "socialAccounts.automations.create" })}
        </Button>
      </header>

      <SocialAccountRecipesPanel
        account={account}
        accountService={accountService}
        onOpenConversation={onOpenConversation}
        onSchedule={(snapshot) => void model.prepareRecipe(snapshot)}
        scheduleDisabled={Boolean(draft || model.replacement) || isSaving}
      />

      <SocialAccountAutomationNotices
        actionFailed={actionFailed}
        loadFailed={!isLoading && loadFailed}
        noticeId={noticeId}
        onRetry={() => workspaceTarget && void loadAutomations(workspaceTarget, true)}
        workspaceUnavailable={workspaceUnavailable}
      />

      {model.actionError ? (
        <p role="alert" className="text-ui-sm text-destructive whitespace-pre-wrap break-words">
          {model.actionError}
        </p>
      ) : null}
      {model.replacement ? (
        <SocialAccountRecipeReview
          key={model.replacement.automation.automationId}
          recipe={model.replacement.recipe}
          accountName={account.displayName}
          busy={isSaving}
          onSchedule={(snapshot) => void model.prepareRecipe(snapshot)}
          onCancel={() => model.setReplacement(null)}
        />
      ) : null}
      {draft ? (
        <SocialAccountAutomationForm
          draft={draft}
          isSaving={isSaving}
          accountName={account.displayName}
          onDraftChange={setDraft}
          onSave={() => void saveDraft()}
          onCancel={() => setDraft(null)}
        />
      ) : null}

      {isLoading ? (
        <div
          className="rounded-lg border border-border bg-card px-4 py-6 text-ui-sm text-foreground-subtle"
          role="status"
        >
          {intl.formatMessage({ id: "socialAccounts.automations.loading" })}
        </div>
      ) : loadFailed ? null : automations.length === 0 ? (
        <section className="rounded-lg border border-border bg-card px-5 py-6">
          <h2 className="text-ui-lg font-semibold">
            {intl.formatMessage({ id: "socialAccounts.automations.emptyTitle" })}
          </h2>
          <p className="mt-2 max-w-2xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialAccounts.automations.emptyDescription" })}
          </p>
          {!draft ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {AUTOMATION_TEMPLATES.map((template) => (
                <Button
                  key={template.id}
                  type="button"
                  variant="outline"
                  onClick={() => startCreate(template)}
                >
                  {intl.formatMessage({ id: template.titleId })}
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <SocialAccountAutomationList
          automations={automations}
          busyAutomationId={busyAutomationId}
          busy={isSaving}
          draft={draft}
          expandedAutomationId={expandedAutomationId}
          runsByAutomation={runsByAutomation}
          locale={locale}
          onDraftChange={setDraft}
          onReplaceVersion={(automation) => void model.replaceVersion(automation)}
          onOpenConversation={onOpenConversation}
          onDelete={(automation) => void deleteAutomation(automation)}
          onLoadRuns={(automationId, target) => void loadRuns(automationId, target)}
          onRestart={(automation) => void restart(automation)}
          onRunNow={(automation) => void runNow(automation)}
          onToggleEnabled={(automation) => void toggleEnabled(automation)}
          onToggleHistory={setExpandedAutomationId}
          workspaceTarget={workspaceTarget}
        />
      )}
    </div>
  );
}
