import { CirclePlay, Clock3, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { ZCodeAutomation, ZCodeAutomationRun } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialAccountRecipeSnapshot } from "./SocialAccountRecipeSnapshot.js";
import {
  draftFromAutomation,
  formatDate,
  runOutcomeMessageId,
  type AutomationDraft,
  type WorkspaceTarget,
} from "./socialAccountAutomationsModel.js";

export function SocialAccountAutomationList({
  automations,
  busyAutomationId,
  busy,
  draft,
  expandedAutomationId,
  runsByAutomation,
  locale,
  onDraftChange,
  onReplaceVersion,
  onOpenConversation,
  onDelete,
  onLoadRuns,
  onRestart,
  onRunNow,
  onToggleEnabled,
  onToggleHistory,
  workspaceTarget,
}: {
  automations: ZCodeAutomation[];
  busyAutomationId: string | null;
  busy: boolean;
  draft: AutomationDraft | null;
  expandedAutomationId: string | null;
  runsByAutomation: Record<string, ZCodeAutomationRun[]>;
  locale: string;
  onDraftChange: (draft: AutomationDraft) => void;
  onReplaceVersion: (automation: ZCodeAutomation) => void;
  onOpenConversation: (sessionId: string) => void;
  onDelete: (automation: ZCodeAutomation) => void;
  onLoadRuns: (automationId: string, target: WorkspaceTarget) => void;
  onRestart: (automation: ZCodeAutomation) => void;
  onRunNow: (automation: ZCodeAutomation) => void;
  onToggleEnabled: (automation: ZCodeAutomation) => void;
  onToggleHistory: (automationId: string | null) => void;
  workspaceTarget: WorkspaceTarget | null;
}) {
  const { intl } = useZCodeIntl();

  return (
    <section
      className="grid gap-3"
      aria-label={intl.formatMessage({ id: "socialAccounts.automations.listTitle" })}
    >
      {automations.map((automation) => {
        const isBusy = busy || busyAutomationId === automation.automationId;
        const expanded = expandedAutomationId === automation.automationId;
        const runs = runsByAutomation[automation.automationId] ?? [];
        return (
          <article
            key={automation.automationId}
            className="grid gap-3 rounded-lg border border-card-border bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-ui-base font-semibold">{automation.title}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-ui-xs ${automation.enabled && automation.lifecycleStatus === "active" ? "bg-success/10 text-success" : "bg-surface text-foreground-subtle"}`}
                  >
                    {intl.formatMessage({
                      id: `socialAccounts.automations.status.${automation.lifecycleStatus}`,
                    })}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-ui-sm text-foreground-subtle">
                  {automation.recipeSnapshot?.meta.description ?? automation.prompt}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ui-xs text-foreground-subtle">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3.5" aria-hidden="true" />
                    {intl.formatMessage(
                      { id: "socialAccounts.automations.nextRun" },
                      {
                        date:
                          formatDate(automation.nextRunAt, locale) ??
                          intl.formatMessage({ id: "socialAccounts.automations.notScheduled" }),
                      },
                    )}
                  </span>
                  {automation.lastRunAt !== undefined ? (
                    <span>
                      {intl.formatMessage(
                        { id: "socialAccounts.automations.lastRun" },
                        { date: formatDate(automation.lastRunAt, locale) ?? "" },
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {automation.recipeSnapshot ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy || Boolean(draft)}
                    onClick={() => onReplaceVersion(automation)}
                  >
                    {intl.formatMessage({ id: "socialAccounts.recipes.replaceVersion" })}
                  </Button>
                ) : null}
                {automation.lifecycleStatus === "failed" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => onRestart(automation)}
                  >
                    <RotateCcw aria-hidden="true" />
                    {intl.formatMessage({ id: "socialAccounts.automations.restart" })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy || automation.lifecycleStatus === "completed"}
                    onClick={() => onToggleEnabled(automation)}
                  >
                    {automation.enabled
                      ? intl.formatMessage({ id: "socialAccounts.automations.pause" })
                      : intl.formatMessage({ id: "socialAccounts.automations.resume" })}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBusy || Boolean(automation.recipeSnapshotError)}
                  onClick={() => onRunNow(automation)}
                >
                  <CirclePlay aria-hidden="true" />
                  {intl.formatMessage({ id: "socialAccounts.automations.runNow" })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "socialAccounts.automations.edit" })}
                  disabled={isBusy || Boolean(draft)}
                  onClick={() => onDraftChange(draftFromAutomation(automation))}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "socialAccounts.automations.delete" })}
                  disabled={isBusy}
                  onClick={() => onDelete(automation)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            {automation.recipeSnapshot || automation.recipeSnapshotError ? (
              <details className="text-ui-sm">
                <summary className="cursor-pointer">
                  {intl.formatMessage({ id: "socialAccounts.recipes.pinnedVersion" })}
                </summary>
                <SocialAccountRecipeSnapshot
                  snapshot={automation.recipeSnapshot}
                  invalid={Boolean(automation.recipeSnapshotError)}
                />
              </details>
            ) : null}
            <div className="border-t border-border pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                onClick={() => {
                  onToggleHistory(expanded ? null : automation.automationId);
                  if (!expanded && workspaceTarget)
                    onLoadRuns(automation.automationId, workspaceTarget);
                }}
              >
                {intl.formatMessage({
                  id: expanded
                    ? "socialAccounts.automations.hideHistory"
                    : "socialAccounts.automations.showHistory",
                })}
              </Button>
              {expanded ? (
                <ul className="mt-2 grid gap-1.5 text-ui-sm text-foreground-subtle">
                  {runs.slice(0, 10).map((run) => (
                    <li key={run.runId} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <span>{intl.formatMessage({ id: runOutcomeMessageId(run) })}</span>
                      <time dateTime={new Date(run.createdAt).toISOString()}>
                        {formatDate(run.createdAt, locale)}
                      </time>
                      {run.error ? (
                        <p className="w-full whitespace-pre-wrap break-words text-destructive">
                          {run.error}
                        </p>
                      ) : null}
                      {run.sessionId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenConversation(run.sessionId!)}
                        >
                          {intl.formatMessage({ id: "socialAccounts.recipes.openConversation" })}
                        </Button>
                      ) : null}
                      {run.recipeSnapshot || run.recipeSnapshotError ? (
                        <details className="w-full">
                          <summary className="cursor-pointer">
                            {intl.formatMessage({ id: "socialAccounts.recipes.pinnedVersion" })}
                          </summary>
                          <SocialAccountRecipeSnapshot
                            snapshot={run.recipeSnapshot}
                            invalid={Boolean(run.recipeSnapshotError)}
                          />
                        </details>
                      ) : null}
                    </li>
                  ))}
                  {runs.length === 0 ? (
                    <li>{intl.formatMessage({ id: "socialAccounts.automations.noRuns" })}</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
