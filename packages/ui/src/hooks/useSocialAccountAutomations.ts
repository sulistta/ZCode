import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovedWorkflowSnapshot,
  SocialAccount,
  ZCodeAutomation,
  ZCodeAutomationRun,
} from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { useServices } from "./useServices.js";
import { useConfirmDialog } from "./useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { AccountRecipeDraft } from "./useSocialAccountRecipes.js";
import {
  AUTOMATION_TEMPLATES,
  automationWriteForDraft,
  draftFromAutomation,
  draftFromRecipe,
  isRecipeDraft,
  scheduleForDraft,
  type AutomationDraft,
  type WorkspaceTarget,
} from "@/social-accounts/socialAccountAutomationsModel.js";

export function useSocialAccountAutomations(
  account: SocialAccount,
  accountService: SocialAccountService,
) {
  const { intl } = useZCodeIntl();
  const { zcodeAgentService } = useServices();
  const confirmDialog = useConfirmDialog();
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget | null>(null);
  const [automations, setAutomations] = useState<ZCodeAutomation[]>([]);
  const [runsByAutomation, setRunsByAutomation] = useState<Record<string, ZCodeAutomationRun[]>>(
    {},
  );
  const [expandedAutomationId, setExpandedAutomationId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [replacement, setReplacement] = useState<{
    automation: ZCodeAutomation;
    recipe: AccountRecipeDraft;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyAutomationId, setBusyAutomationId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const active = useRef(false);
  const targetRef = useRef<WorkspaceTarget | null>(null);
  const readId = useRef(0);
  const runReadIds = useRef(new Map<string, number>());
  const action = useRef(false);
  const current = useCallback(
    (target: WorkspaceTarget) => active.current && targetRef.current === target,
    [],
  );

  const loadAutomations = useCallback(
    async (target: WorkspaceTarget, spinner = false) => {
      const request = ++readId.current;
      if (spinner && current(target)) setIsLoading(true);
      try {
        const items = await zcodeAgentService.listAutomations(target);
        if (!current(target) || request !== readId.current) return;
        setAutomations(items);
        setLoadFailed(false);
      } catch {
        if (current(target) && request === readId.current) setLoadFailed(true);
      } finally {
        if (spinner && current(target) && request === readId.current) setIsLoading(false);
      }
    },
    [current, zcodeAgentService],
  );

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void accountService
      .resolveConversationWorkspace(account.accountId)
      .then(async (workspace) => {
        if (cancelled) return;
        if (!workspace || workspace.workspaceIdentity !== account.workspaceIdentity)
          throw new Error("Account unavailable");
        const target = {
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
        };
        targetRef.current = target;
        setWorkspaceTarget(target);
        await loadAutomations(target, true);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceUnavailable(true);
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
      active.current = false;
      targetRef.current = null;
    };
  }, [account.accountId, account.workspaceIdentity, accountService, loadAutomations]);

  useEffect(() => {
    if (!workspaceTarget) return;
    const poll = setInterval(() => void loadAutomations(workspaceTarget), 15_000);
    return () => clearInterval(poll);
  }, [loadAutomations, workspaceTarget]);

  const loadRuns = useCallback(
    async (automationId: string, target: WorkspaceTarget) => {
      const request = (runReadIds.current.get(automationId) ?? 0) + 1;
      runReadIds.current.set(automationId, request);
      try {
        const runs = await zcodeAgentService.listAutomationRuns({ ...target, automationId });
        if (current(target) && runReadIds.current.get(automationId) === request)
          setRunsByAutomation((value) => ({ ...value, [automationId]: runs }));
      } catch {
        if (current(target) && runReadIds.current.get(automationId) === request)
          setActionFailed(true);
      }
    },
    [current, zcodeAgentService],
  );

  // 历史是 Host 投影；已有轮询同时刷新展开记录，不能把 control turn 当作脚本完成。
  useEffect(() => {
    if (workspaceTarget && expandedAutomationId)
      void loadRuns(expandedAutomationId, workspaceTarget);
  }, [automations, expandedAutomationId, loadRuns, workspaceTarget]);

  const perform = useCallback(
    async (id: string | null, operation: (target: WorkspaceTarget) => Promise<void>) => {
      const target = targetRef.current;
      if (!target || action.current) return;
      action.current = true;
      setBusyAutomationId(id);
      setIsSaving(true);
      setActionFailed(false);
      setActionError(null);
      setNoticeId(null);
      try {
        await operation(target);
      } catch (error) {
        if (current(target)) {
          setActionFailed(true);
          if (error instanceof Error) setActionError(error.message);
        }
      } finally {
        action.current = false;
        if (current(target)) {
          setBusyAutomationId(null);
          setIsSaving(false);
        }
      }
    },
    [current],
  );

  const startCreate = (template?: (typeof AUTOMATION_TEMPLATES)[number]) => {
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
    setReplacement(null);
  };

  const prepareRecipe = (snapshot: ApprovedWorkflowSnapshot) =>
    perform(null, async (target) => {
      const result = await zcodeAgentService.validateSavedWorkflow({
        ...target,
        approvedSnapshot: snapshot,
      });
      if (!result.ok) throw new Error(result.message);
      if (!current(target)) return;
      setDraft(
        replacement
          ? {
              ...draftFromAutomation(replacement.automation),
              recipeSnapshot: result.approvedSnapshot,
              recipeSnapshotError: undefined,
              recipeVersionDirty: true,
            }
          : draftFromRecipe(result.approvedSnapshot),
      );
      setReplacement(null);
    });

  const saveDraft = () =>
    perform(draft?.automationId ?? null, async (target) => {
      if (!draft || !draft.title.trim() || (!isRecipeDraft(draft) && !draft.prompt.trim())) return;
      const fields = automationWriteForDraft(draft);
      const schedule = scheduleForDraft(draft);
      if (draft.automationId) {
        const result = await zcodeAgentService.updateAutomation({
          ...target,
          automationId: draft.automationId,
          ...fields,
          ...(draft.scheduleDirty ? { ...schedule, scheduleEditedByUser: true } : {}),
        });
        if (!result) throw new Error("Account automation no longer exists.");
      } else {
        await zcodeAgentService.createAutomation({
          ...target,
          ...fields,
          prompt: fields.prompt ?? "",
          ...schedule,
          recurring: true,
          mode: draft.mode,
        });
        if (current(target)) setNoticeId("socialAccounts.automations.created");
      }
      if (!current(target)) return;
      setDraft(null);
      await loadAutomations(target);
    });

  const replaceVersion = (automation: ZCodeAutomation) =>
    perform(automation.automationId, async (target) => {
      if (!automation.recipeSnapshot)
        throw new Error(intl.formatMessage({ id: "socialAccounts.recipes.invalidDefinitions" }));
      const result = await zcodeAgentService.getSavedWorkflow({
        ...target,
        scope: "project",
        name: automation.recipeSnapshot.name,
      });
      if (!result.ok || result.scope !== "project")
        throw new Error(intl.formatMessage({ id: "socialAccounts.recipes.actionFailed" }));
      if (current(target)) {
        setDraft(null);
        setReplacement({
          automation,
          recipe: { name: result.name, meta: result.meta, script: result.script },
        });
      }
    });

  const toggleEnabled = (automation: ZCodeAutomation) =>
    perform(automation.automationId, async (target) => {
      await zcodeAgentService.setAutomationEnabled({
        ...target,
        automationId: automation.automationId,
        enabled: !automation.enabled,
      });
      await loadAutomations(target);
    });
  const restart = (automation: ZCodeAutomation) =>
    perform(automation.automationId, async (target) => {
      await zcodeAgentService.restartAutomation({
        ...target,
        automationId: automation.automationId,
      });
      await loadAutomations(target);
    });
  const runNow = (automation: ZCodeAutomation) =>
    perform(automation.automationId, async (target) => {
      const result = await zcodeAgentService.runAutomationNow({
        ...target,
        automationId: automation.automationId,
      });
      if (current(target))
        setNoticeId(
          result.status === "queued"
            ? "socialAccounts.automations.runNowQueued"
            : "socialAccounts.automations.runNowDuplicate",
        );
      await Promise.all([loadAutomations(target), loadRuns(automation.automationId, target)]);
    });
  const deleteAutomation = (automation: ZCodeAutomation) =>
    perform(automation.automationId, async (target) => {
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
      if (!confirmed || !current(target)) return;
      await zcodeAgentService.deleteAutomation({
        ...target,
        automationId: automation.automationId,
      });
      if (!current(target)) return;
      setRunsByAutomation((value) => {
        const next = { ...value };
        delete next[automation.automationId];
        return next;
      });
      if (expandedAutomationId === automation.automationId) setExpandedAutomationId(null);
      if (draft?.automationId === automation.automationId) setDraft(null);
      await loadAutomations(target);
    });

  return {
    workspaceTarget,
    automations,
    runsByAutomation,
    expandedAutomationId,
    setExpandedAutomationId,
    draft,
    setDraft,
    replacement,
    setReplacement,
    isLoading,
    isSaving,
    busyAutomationId,
    loadFailed,
    workspaceUnavailable,
    actionFailed,
    actionError,
    noticeId,
    loadAutomations,
    loadRuns,
    startCreate,
    prepareRecipe,
    saveDraft,
    replaceVersion,
    toggleEnabled,
    restart,
    runNow,
    deleteAutomation,
  };
}
