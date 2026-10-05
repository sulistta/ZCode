import { Plus, Save, Trash2 } from "lucide-react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { EditorialSource } from "./socialAccountsModel.js";
import type { EditorialDraft } from "./socialAccountsModel.js";
import { updateSourceSelection } from "./socialAccountsModel.js";
import { AccountField } from "./AccountField.js";
import { AccountSourceOptions } from "./AccountSourceOptions.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialAccountProfileForm({
  draft,
  setDraft,
  isCreating,
  isSaving,
  onSave,
}: {
  draft: EditorialDraft;
  setDraft: Dispatch<SetStateAction<EditorialDraft>>;
  isCreating: boolean;
  isSaving: boolean;
  onSave: () => void;
}) {
  const { intl } = useZCodeIntl();

  const setSource = (source: EditorialSource, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      preferredSources: updateSourceSelection(current.preferredSources, source, checked),
    }));
  };

  const addMemory = () => {
    const now = Date.now();
    setDraft((current) => ({
      ...current,
      memory: [
        ...current.memory,
        {
          id: globalThis.crypto.randomUUID(),
          text: "",
          source: "user",
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
  };

  const updateMemory = (id: string, text: string) => {
    setDraft((current) => ({
      ...current,
      memory: current.memory.map((entry) => (entry.id === id ? { ...entry, text } : entry)),
    }));
  };

  const removeMemory = (id: string) => {
    setDraft((current) => ({
      ...current,
      memory: current.memory.filter((entry) => entry.id !== id),
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };

  return (
    <form
      className="grid gap-5 rounded-lg border border-card-border bg-card p-4 md:p-5"
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-ui-lg font-semibold">
          {intl.formatMessage({ id: "socialAccounts.profile.title" })}
        </h2>
        <Button type="submit" disabled={isSaving}>
          <Save aria-hidden="true" />
          {intl.formatMessage({ id: "socialAccounts.profile.save" })}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AccountField label={intl.formatMessage({ id: "socialAccounts.accountName" })}>
          <Input
            autoFocus={isCreating}
            required
            maxLength={1200}
            value={draft.displayName}
            onChange={(event) =>
              setDraft((current) => ({ ...current, displayName: event.target.value }))
            }
          />
        </AccountField>
        <AccountField label={intl.formatMessage({ id: "socialAccounts.profile.niche" })}>
          <Input
            required
            value={draft.niche}
            onChange={(event) => setDraft((current) => ({ ...current, niche: event.target.value }))}
          />
        </AccountField>
        <AccountField label={intl.formatMessage({ id: "socialAccounts.profile.audience" })}>
          <Input
            required
            value={draft.audience}
            onChange={(event) =>
              setDraft((current) => ({ ...current, audience: event.target.value }))
            }
          />
        </AccountField>
        <AccountField label={intl.formatMessage({ id: "socialAccounts.profile.language" })}>
          <Input
            required
            maxLength={48}
            value={draft.language}
            onChange={(event) =>
              setDraft((current) => ({ ...current, language: event.target.value }))
            }
          />
        </AccountField>
        <AccountField
          label={intl.formatMessage({ id: "socialAccounts.profile.tone" })}
          hint={intl.formatMessage({ id: "socialAccounts.profile.listHint" })}
        >
          <Textarea
            value={draft.tone}
            onChange={(event) => setDraft((current) => ({ ...current, tone: event.target.value }))}
          />
        </AccountField>
        <AccountField
          label={intl.formatMessage({ id: "socialAccounts.profile.references" })}
          hint={intl.formatMessage({ id: "socialAccounts.profile.listHint" })}
        >
          <Textarea
            value={draft.references}
            onChange={(event) =>
              setDraft((current) => ({ ...current, references: event.target.value }))
            }
          />
        </AccountField>
      </div>

      <AccountSourceOptions
        legend={intl.formatMessage({ id: "socialAccounts.profile.sources" })}
        selected={draft.preferredSources}
        onToggle={setSource}
      />

      <AccountField label={intl.formatMessage({ id: "socialAccounts.profile.visualStyle" })}>
        <Textarea
          required
          value={draft.visualStyle}
          onChange={(event) =>
            setDraft((current) => ({ ...current, visualStyle: event.target.value }))
          }
        />
      </AccountField>

      <section className="grid gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-ui-base font-semibold">
              {intl.formatMessage({ id: "socialAccounts.profile.memory" })}
            </h3>
            <p className="mt-1 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialAccounts.profile.memoryHint" })}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addMemory}>
            <Plus aria-hidden="true" />
            {intl.formatMessage({ id: "socialAccounts.profile.addMemory" })}
          </Button>
        </div>
        {draft.memory.length === 0 ? (
          <p className="text-ui-sm text-foreground-subtlest">—</p>
        ) : (
          <div className="grid gap-3">
            {draft.memory.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
              >
                <AccountField
                  label={intl.formatMessage({
                    id:
                      entry.source === "learned"
                        ? "socialAccounts.profile.memoryLearned"
                        : "socialAccounts.profile.memoryUser",
                  })}
                >
                  <Textarea
                    required
                    value={entry.text}
                    onChange={(event) => updateMemory(entry.id, event.target.value)}
                  />
                </AccountField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "socialAccounts.profile.removeMemory" })}
                  onClick={() => removeMemory(entry.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </form>
  );
}
