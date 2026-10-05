import { useMemo } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  AUTOMATION_TEMPLATES,
  WEEKDAY_MESSAGE_IDS,
  type AutomationDraft,
  type AutomationFrequency,
  isRecipeDraft,
} from "./socialAccountAutomationsModel.js";
import { SocialAccountRecipeSnapshot } from "./SocialAccountRecipeSnapshot.js";

export function SocialAccountAutomationForm({
  draft,
  isSaving,
  onDraftChange,
  onSave,
  onCancel,
  accountName,
}: {
  draft: AutomationDraft;
  isSaving: boolean;
  onDraftChange: (draft: AutomationDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  accountName: string;
}) {
  const { intl } = useZCodeIntl();
  const weekdayOptions = useMemo(
    () => WEEKDAY_MESSAGE_IDS.map((id, day) => ({ day, label: intl.formatMessage({ id }) })),
    [intl],
  );

  return (
    <section
      className="grid gap-4 rounded-lg border border-card-border bg-card p-4 md:p-5"
      aria-label={intl.formatMessage({ id: "socialAccounts.automations.form.title" })}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-ui-lg font-semibold">
            {intl.formatMessage({
              id: draft.automationId
                ? "socialAccounts.automations.form.editTitle"
                : "socialAccounts.automations.form.createTitle",
            })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({
              id: isRecipeDraft(draft)
                ? "socialAccounts.recipes.scheduleNotice"
                : draft.mode === "build"
                  ? "socialAccounts.automations.form.policyNoticeBuild"
                  : "socialAccounts.automations.form.policyNoticePlan",
            })}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </div>

      {!draft.automationId && !isRecipeDraft(draft) ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {AUTOMATION_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="rounded-md border border-card-border bg-surface px-3 py-2.5 text-left hover:bg-surface-hover"
              onClick={() =>
                onDraftChange({
                  ...draft,
                  title: intl.formatMessage({ id: template.titleId }),
                  prompt: template.prompt,
                  mode: template.mode,
                })
              }
            >
              <span className="block text-ui-base font-medium">
                {intl.formatMessage({ id: template.titleId })}
              </span>
              <span className="mt-1 block text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: template.descriptionId })}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <label className="grid gap-1.5 text-ui-sm font-medium">
        {intl.formatMessage({ id: "socialAccounts.automations.form.name" })}
        <Input
          value={draft.title}
          maxLength={160}
          onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })}
        />
      </label>
      {isRecipeDraft(draft) ? (
        <SocialAccountRecipeSnapshot
          snapshot={draft.recipeSnapshot}
          invalid={Boolean(draft.recipeSnapshotError)}
          accountName={accountName}
        />
      ) : (
        <label className="grid gap-1.5 text-ui-sm font-medium">
          {intl.formatMessage({ id: "socialAccounts.automations.form.instructions" })}
          <Textarea
            value={draft.prompt}
            rows={6}
            maxLength={12_000}
            onChange={(event) => onDraftChange({ ...draft, prompt: event.currentTarget.value })}
          />
        </label>
      )}

      <div className="grid gap-3 rounded-md border border-border bg-background-alt p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
        {draft.scheduleEditable ? (
          <>
            <label className="grid gap-1.5 text-ui-sm font-medium">
              {intl.formatMessage({ id: "socialAccounts.automations.form.frequency" })}
              <select
                className="h-8 rounded-md border border-input-border bg-input px-2 text-ui-base text-foreground"
                value={draft.frequency}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    frequency: event.currentTarget.value as AutomationFrequency,
                    scheduleDirty: true,
                  })
                }
              >
                <option value="daily">
                  {intl.formatMessage({ id: "socialAccounts.automations.frequency.daily" })}
                </option>
                <option value="weekly">
                  {intl.formatMessage({ id: "socialAccounts.automations.frequency.weekly" })}
                </option>
              </select>
            </label>
            {draft.frequency === "weekly" ? (
              <label className="grid gap-1.5 text-ui-sm font-medium">
                {intl.formatMessage({ id: "socialAccounts.automations.form.weekday" })}
                <select
                  className="h-8 rounded-md border border-input-border bg-input px-2 text-ui-base text-foreground"
                  value={draft.weekday}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      weekday: Number(event.currentTarget.value),
                      scheduleDirty: true,
                    })
                  }
                >
                  {weekdayOptions.map(({ day, label }) => (
                    <option key={day} value={day}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="hidden sm:block" />
            )}
            <label className="grid gap-1.5 text-ui-sm font-medium">
              {intl.formatMessage({ id: "socialAccounts.automations.form.time" })}
              <Input
                type="time"
                value={draft.time}
                onChange={(event) =>
                  onDraftChange({ ...draft, time: event.currentTarget.value, scheduleDirty: true })
                }
              />
            </label>
          </>
        ) : (
          <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialAccounts.automations.form.preserveSchedule" })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onDraftChange({ ...draft, scheduleEditable: true, scheduleDirty: true })
              }
            >
              {intl.formatMessage({ id: "socialAccounts.automations.form.changeSchedule" })}
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={
            isSaving || !draft.title.trim() || (!isRecipeDraft(draft) && !draft.prompt.trim())
          }
        >
          {intl.formatMessage({
            id: draft.automationId
              ? "socialAccounts.automations.form.save"
              : "socialAccounts.automations.form.create",
          })}
        </Button>
      </div>
    </section>
  );
}
