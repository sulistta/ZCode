import { useId } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { EditorialSource, PolicyDraft } from "./socialAccountsModel.js";
import { AccountField } from "./AccountField.js";
import { AccountSourceOptions } from "./AccountSourceOptions.js";
import { updateSourceSelection } from "./socialAccountsModel.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Save } from "lucide-react";

export function SocialAccountPolicyForm({
  draft,
  setDraft,
  preferredSources,
  isSaving,
  onSave,
}: {
  draft: PolicyDraft;
  setDraft: Dispatch<SetStateAction<PolicyDraft>>;
  preferredSources: EditorialSource[];
  isSaving: boolean;
  onSave: () => void;
}) {
  const { intl } = useZCodeIntl();
  const autonomySwitchId = useId();

  const setAllowedSource = (source: EditorialSource, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      allowedSources: updateSourceSelection(current.allowedSources, source, checked),
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };

  return (
    <form
      className="grid gap-4 rounded-lg border border-card-border bg-card p-4 md:p-5"
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-ui-lg font-semibold">
            {intl.formatMessage({ id: "socialAccounts.policy.title" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({
              id: draft.autonomyEnabled
                ? "socialAccounts.policy.autonomous"
                : "socialAccounts.policy.supervised",
            })}
          </p>
        </div>
        <Button type="submit" disabled={isSaving}>
          <Save aria-hidden="true" />
          {intl.formatMessage({ id: "socialAccounts.policy.save" })}
        </Button>
      </div>

      <div className="flex items-center gap-3 text-ui-base">
        <Switch
          id={autonomySwitchId}
          checked={draft.autonomyEnabled}
          onCheckedChange={(checked) =>
            setDraft((current) => ({
              ...current,
              autonomyEnabled: checked,
              allowedSources:
                checked && current.allowedSources.length === 0
                  ? preferredSources.length > 0
                    ? preferredSources
                    : ["youtube-search"]
                  : current.allowedSources,
            }))
          }
        />
        <Label htmlFor={autonomySwitchId}>
          {intl.formatMessage({ id: "socialAccounts.policy.autonomous" })}
        </Label>
      </div>

      {draft.autonomyEnabled ? (
        <>
          <AccountSourceOptions
            legend={intl.formatMessage({ id: "socialAccounts.policy.sources" })}
            selected={draft.allowedSources}
            onToggle={setAllowedSource}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <AccountField label={intl.formatMessage({ id: "socialAccounts.policy.cadence" })}>
              <select
                className="h-8 w-full rounded-md border border-input-border bg-input px-2 text-ui-base text-foreground focus-visible:border-input-border-focused"
                value={draft.cadence}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    cadence: event.target.value as PolicyDraft["cadence"],
                  }))
                }
              >
                <option value="daily">
                  {intl.formatMessage({ id: "socialAccounts.policy.daily" })}
                </option>
                <option value="weekly">
                  {intl.formatMessage({ id: "socialAccounts.policy.weekly" })}
                </option>
                <option value="monthly">
                  {intl.formatMessage({ id: "socialAccounts.policy.monthly" })}
                </option>
              </select>
            </AccountField>
            <AccountField label={intl.formatMessage({ id: "socialAccounts.policy.maxPerDay" })}>
              <Input
                type="number"
                min={1}
                max={25}
                required
                value={draft.maxPublicationsPerDay}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxPublicationsPerDay: event.target.value,
                  }))
                }
              />
            </AccountField>
          </div>
        </>
      ) : null}
    </form>
  );
}
