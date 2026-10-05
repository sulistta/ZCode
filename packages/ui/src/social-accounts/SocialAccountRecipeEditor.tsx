import { useId, useState } from "react";
import { zcodeSavedWorkflowMetaSchema } from "@social-harness/shared";
import type { AccountRecipeDraft } from "@/hooks/useSocialAccountRecipes.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialAccountRecipeEditor({
  initial,
  existing,
  busy,
  onSave,
  onCancel,
}: {
  initial: AccountRecipeDraft;
  existing: boolean;
  busy: boolean;
  onSave: (draft: AccountRecipeDraft) => Promise<boolean | null>;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const id = useId();
  const message = (key: string) => intl.formatMessage({ id: `socialAccounts.recipes.${key}` });
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.meta.description);
  const [script, setScript] = useState(initial.script);
  const [declarations, setDeclarations] = useState(
    JSON.stringify(initial.meta.args ?? {}, null, 2),
  );
  const [invalid, setInvalid] = useState(false);
  return (
    <section
      aria-label={message("editor")}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          let meta;
          try {
            meta = zcodeSavedWorkflowMetaSchema.parse({
              ...initial.meta,
              description,
              args: JSON.parse(declarations),
            });
          } catch {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          void onSave({ name: name.trim(), meta, script }).then((saved) => {
            if (saved) onCancel();
          });
        }}
      >
        <label htmlFor={`${id}-name`} className="text-ui-base font-medium">
          {message("name")}
        </label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={64}
          readOnly={existing}
          disabled={busy}
        />
        <label htmlFor={`${id}-description`} className="text-ui-base font-medium">
          {message("description")}
        </label>
        <Input
          id={`${id}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          disabled={busy}
        />
        <label htmlFor={`${id}-declarations`} className="text-ui-base font-medium">
          {message("declarations")}
        </label>
        <Textarea
          id={`${id}-declarations`}
          className="min-h-24 font-mono"
          value={declarations}
          onChange={(event) => setDeclarations(event.target.value)}
          disabled={busy}
        />
        <p className="text-ui-sm text-foreground-subtle">{message("declarationsHelp")}</p>
        <label htmlFor={`${id}-script`} className="text-ui-base font-medium">
          {message("script")}
        </label>
        <Textarea
          id={`${id}-script`}
          className="min-h-52 font-mono"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          required
          disabled={busy}
          spellCheck={false}
        />
        {invalid ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {message("invalidMetadata")}
          </p>
        ) : null}
        <p className="text-ui-sm text-foreground-subtle">{message("saveNotice")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {message("save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        </div>
      </form>
    </section>
  );
}
