import { useId, useState } from "react";
import {
  approvedWorkflowSnapshotSchema,
  type ApprovedWorkflowSnapshot,
} from "@social-harness/shared";
import type { AccountRecipeDraft } from "@/hooks/useSocialAccountRecipes.js";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialAccountRecipeReview({
  recipe,
  accountName,
  busy,
  onRun,
  onCancel,
}: {
  recipe: AccountRecipeDraft;
  accountName: string;
  busy: boolean;
  onRun: (snapshot: ApprovedWorkflowSnapshot) => void;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const id = useId();
  const message = (key: string) => intl.formatMessage({ id: `socialAccounts.recipes.${key}` });
  const [args, setArgs] = useState("{}");
  const [invalid, setInvalid] = useState(false);
  return (
    <section
      aria-label={message("reviewTitle")}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h3 className="text-ui-base font-semibold">{message("reviewTitle")}</h3>
      <p className="text-ui-base">
        {recipe.name} · {accountName}
      </p>
      <p className="text-ui-sm text-foreground-subtle">{recipe.meta.description}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-ui-base">
        {recipe.script}
      </pre>
      {recipe.meta.args && Object.keys(recipe.meta.args).length ? (
        <pre className="overflow-auto whitespace-pre-wrap font-mono text-ui-sm">
          {JSON.stringify(recipe.meta.args, null, 2)}
        </pre>
      ) : null}
      <label htmlFor={id} className="text-ui-base font-medium">
        {message("arguments")}
      </label>
      <Textarea
        id={id}
        value={args}
        onChange={(event) => setArgs(event.target.value)}
        disabled={busy}
        className="min-h-24 font-mono"
      />
      <p className="text-ui-sm text-foreground-subtle">{message("reviewNotice")}</p>
      {invalid ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {message("invalidArguments")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            let snapshot;
            try {
              snapshot = approvedWorkflowSnapshotSchema.parse({
                ...recipe,
                schemaVersion: 1,
                args: JSON.parse(args),
              });
            } catch {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            onRun(snapshot);
          }}
        >
          {message("runReviewed")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </div>
    </section>
  );
}
