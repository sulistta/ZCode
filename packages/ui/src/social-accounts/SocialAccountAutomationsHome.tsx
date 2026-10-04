import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import type { SocialAccount, ZCodeAutomation, ZCodeAutomationRun } from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialAccountAutomationForm } from "./SocialAccountAutomationForm.js";
import { SocialAccountAutomationList } from "./SocialAccountAutomationList.js";
import { SocialAccountAutomationNotices } from "./SocialAccountAutomationNotices.js";
import {
  AUTOMATION_TEMPLATES,
  scheduleForDraft,
  type AutomationDraft,
  type WorkspaceTarget,
} from "./socialAccountAutomationsModel.js";

export function SocialAccountAutomationsHome({
  account,
  accountService,
}: {
  account: SocialAccount;
  accountService: SocialAccountService;
}) {
  const { intl, locale } = useZCodeIntl();
  const { zcodeAgentService } = useServices();
  const confirmDialog = useConfirmDialog();
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget | null>(null);
  const [automations, setAutomations] = useState<ZCodeAutomation[]>([]);
  const [runsByAutomation, setRunsByAutomation] = useState<Record<string, ZCodeAutomationRun[]>>(
    {},
  );
  const [expandedAutomationId, setExpandedAutomationId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyAutomationId, setBusyAutomationId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [noticeId, setNoticeId] = useState<string | null>(null);

  const loadAutomations = useCallback(
    async (target: WorkspaceTarget, showSpinner = false) => {
      if (showSpinner) setIsLoading(true);
      try {
        // Account-scoped view must never use listAllAutomations: the Host-derived target is the boundary.
        const items = await zcodeAgentService.listAutomations(target);
        setAutomations(items);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      } finally {
        if (showSpinner) setIsLoading(false);
      }
    },
    [zcodeAgentService],
  );

  useEffect(() => {
    let active = true;
    setWorkspaceTarget(null);
    setWorkspaceUnavailable(false);
    setLoadFailed(false);
    setIsLoading(true);
    void accountService
      .resolveConversationWorkspace(account.accountId)
      .then((workspace) => {
        if (!active) return;
        if (!workspace || workspace.workspaceIdentity !== account.workspaceIdentity) {
          setWorkspaceUnavailable(true);
          setIsLoading(false);
          return;
        }
        const target = {
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
        };
        setWorkspaceTarget(target);
        void loadAutomations(target, true);
      })
      .catch(() => {
        if (active) {
          setWorkspaceUnavailable(true);
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [account.accountId, account.workspaceIdentity, accountService, loadAutomations]);

  useEffect(() => {
    if (!workspaceTarget) return;
    const poll = setInterval(() => void loadAutomations(workspaceTarget), 15_000);
    return () => clearInterval(poll);
  }, [loadAutomations, workspaceTarget]);

  const loadRuns = useCallback(
    async (automationId: string, target: WorkspaceTarget) => {
      try {
        const runs = await zcodeAgentService.listAutomationRuns({ ...target, automationId });
        setRunsByAutomation((current) => ({ ...current, [automationId]: runs }));
      } catch {
        setActionFailed(true);
      }
    },
    [zcodeAgentService],
  );

  const startCreate = useCallback(
    (template?: (typeof AUTOMATION_TEMPLATES)[number]) => {
      setActionFailed(false);
      setNoticeId(null);
      setDraft({
        title: template ? intl.formatMessage({ id: template.titleId }) : "",
        prompt: template?.prompt ?? "",
        mode: template?.mode ?? "plan",
        frequency: "daily",
        time: "09:00",
        weekday: 1,
        scheduleEditable: true,
        scheduleDirty: true,
      });
    },
    [intl],
  );

  const saveDraft = useCallback(async () => {
    if (!workspaceTarget || !draft || !draft.title.trim() || !draft.prompt.trim()) return;
    setIsSaving(true);
    setActionFailed(false);
    setNoticeId(null);
    try {
      const schedule = scheduleForDraft(draft);
      if (draft.automationId) {
        const result = await zcodeAgentService.updateAutomation({
          ...workspaceTarget,
          automationId: draft.automationId,
          title: draft.title.trim(),
          prompt: draft.prompt.trim(),
          ...(draft.scheduleDirty ? schedule : {}),
          ...(draft.scheduleDirty ? { scheduleEditedByUser: true } : {}),
        });
        if (!result) throw new Error("Account automation no longer exists.");
      } else {
        await zcodeAgentService.createAutomation({
          ...workspaceTarget,
          title: draft.title.trim(),
          prompt: draft.prompt.trim(),
          ...schedule,
          recurring: true,
          mode: draft.mode,
        });
        setNoticeId("socialAccounts.automations.created");
      }
      setDraft(null);
      await loadAutomations(workspaceTarget);
    } catch {
      setActionFailed(true);
    } finally {
      setIsSaving(false);
    }
  }, [draft, loadAutomations, workspaceTarget, zcodeAgentService]);

  const toggleEnabled = useCallback(
    async (automation: ZCodeAutomation) => {
      if (!workspaceTarget) return;
      setBusyAutomationId(automation.automationId);
      setActionFailed(false);
      try {
        await zcodeAgentService.setAutomationEnabled({
          ...workspaceTarget,
          automationId: automation.automationId,
          enabled: !automation.enabled,
        });
        await loadAutomations(workspaceTarget);
      } catch {
        setActionFailed(true);
      } finally {
        setBusyAutomationId(null);
      }
    },
    [loadAutomations, workspaceTarget, zcodeAgentService],
  );

  const restart = useCallback(
    async (automation: ZCodeAutomation) => {
      if (!workspaceTarget) return;
      setBusyAutomationId(automation.automationId);
      setActionFailed(false);
      try {
        await zcodeAgentService.restartAutomation({
          ...workspaceTarget,
          automationId: automation.automationId,
        });
        await loadAutomations(workspaceTarget);
      } catch {
        setActionFailed(true);
      } finally {
        setBusyAutomationId(null);
      }
    },
    [loadAutomations, workspaceTarget, zcodeAgentService],
  );

  const runNow = useCallback(
    async (automation: ZCodeAutomation) => {
      if (!workspaceTarget) return;
      setBusyAutomationId(automation.automationId);
      setActionFailed(false);
      setNoticeId(null);
      try {
        const result = await zcodeAgentService.runAutomationNow({
          ...workspaceTarget,
          automationId: automation.automationId,
        });
        setNoticeId(
          result.status === "queued"
            ? "socialAccounts.automations.runNowQueued"
            : "socialAccounts.automations.runNowDuplicate",
        );
        await Promise.all([
          loadAutomations(workspaceTarget),
          loadRuns(automation.automationId, workspaceTarget),
        ]);
      } catch {
        setActionFailed(true);
      } finally {
        setBusyAutomationId(null);
      }
    },
    [loadAutomations, loadRuns, workspaceTarget, zcodeAgentService],
  );

  const deleteAutomation = useCallback(
    async (automation: ZCodeAutomation) => {
      if (!workspaceTarget) return;
      const confirmed = await confirmDialog({
        presentation: "automation-confirmation",
        title: intl.formatMessage({ id: "automations.delete.title" }),
        description: intl.formatMessage(
          { id: "automations.delete.description" },
          { title: automation.title },
        ),
        confirmLabel: intl.formatMessage({ id: "common.delete" }),
        confirmVariant: "destructive",
        showKeyboardHints: false,
      });
      if (!confirmed) return;
      setBusyAutomationId(automation.automationId);
      setActionFailed(false);
      try {
        await zcodeAgentService.deleteAutomation({
          ...workspaceTarget,
          automationId: automation.automationId,
        });
        setRunsByAutomation((current) => {
          const next = { ...current };
          delete next[automation.automationId];
          return next;
        });
        if (expandedAutomationId === automation.automationId) setExpandedAutomationId(null);
        if (draft?.automationId === automation.automationId) setDraft(null);
        await loadAutomations(workspaceTarget);
      } catch {
        setActionFailed(true);
      } finally {
        setBusyAutomationId(null);
      }
    },
    [
      confirmDialog,
      draft?.automationId,
      expandedAutomationId,
      intl,
      loadAutomations,
      workspaceTarget,
      zcodeAgentService,
    ],
  );

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
          disabled={!workspaceTarget || Boolean(draft)}
        >
          <Plus aria-hidden="true" />
          {intl.formatMessage({ id: "socialAccounts.automations.create" })}
        </Button>
      </header>

      <SocialAccountAutomationNotices
        actionFailed={actionFailed}
        loadFailed={!isLoading && loadFailed}
        noticeId={noticeId}
        onRetry={() => workspaceTarget && void loadAutomations(workspaceTarget, true)}
        workspaceUnavailable={workspaceUnavailable}
      />

      {draft ? (
        <SocialAccountAutomationForm
          draft={draft}
          isSaving={isSaving}
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
          draft={draft}
          expandedAutomationId={expandedAutomationId}
          runsByAutomation={runsByAutomation}
          locale={locale}
          onDraftChange={setDraft}
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
