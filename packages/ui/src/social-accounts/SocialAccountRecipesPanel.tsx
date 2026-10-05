import { useState } from "react";
import type { SocialAccount } from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import {
  useSocialAccountRecipes,
  type AccountRecipeDraft,
} from "@/hooks/useSocialAccountRecipes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialAccountRecipeEditor } from "./SocialAccountRecipeEditor.js";
import { SocialAccountRecipeReview } from "./SocialAccountRecipeReview.js";

const starterScript = `const editor = agent("editor");
const result = await editor.ask("Using this account's profile and media, prepare a clip proposal for my review. Do not publish.");
await artifact.markdown("proposal", result, { primary: true });
return result;`;

export function SocialAccountRecipesPanel({
  account,
  accountService,
  onOpenConversation,
}: {
  account: SocialAccount;
  accountService: SocialAccountService;
  onOpenConversation: (sessionId: string) => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const model = useSocialAccountRecipes({ account, accountService, onOpenConversation });
  const message = (key: string) => intl.formatMessage({ id: `socialAccounts.recipes.${key}` });
  const [editor, setEditor] = useState<{ draft: AccountRecipeDraft; existing: boolean } | null>(
    null,
  );
  const [review, setReview] = useState<AccountRecipeDraft | null>(null);
  const open = async (name: string, edit: boolean) => {
    const recipe = await model.get(name);
    if (!recipe) return;
    setEditor(edit ? { draft: recipe, existing: true } : null);
    setReview(edit ? null : recipe);
  };
  return (
    <section
      aria-label={message("title")}
      className="grid gap-4 rounded-xl border border-border bg-card p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-ui-lg font-semibold">{message("title")}</h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">{message("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={model.busy || model.loading || !model.available}
            onClick={() => void model.refresh()}
          >
            {message("refresh")}
          </Button>
          <Button
            type="button"
            disabled={model.busy || !model.available || Boolean(editor || review)}
            onClick={() =>
              setEditor({
                existing: false,
                draft: { name: "", meta: { description: "" }, script: starterScript },
              })
            }
          >
            {message("new")}
          </Button>
        </div>
      </header>
      {model.error ? (
        <p role="alert" className="whitespace-pre-wrap break-words text-ui-sm text-destructive">
          {model.error.startsWith("socialAccounts.recipes.")
            ? intl.formatMessage({ id: model.error })
            : model.error}
        </p>
      ) : null}
      {editor ? (
        <SocialAccountRecipeEditor
          key={editor.draft.name}
          initial={editor.draft}
          existing={editor.existing}
          busy={model.busy}
          onSave={model.save}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {review ? (
        <SocialAccountRecipeReview
          key={review.name}
          recipe={review}
          accountName={account.displayName}
          busy={model.busy}
          onRun={(snapshot) => void model.run(snapshot)}
          onCancel={() => setReview(null)}
        />
      ) : null}
      {model.loading ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {message("loading")}
        </p>
      ) : model.recipes.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">{message("empty")}</p>
      ) : (
        <div className="grid gap-2">
          {model.recipes.map((recipe) => (
            <article
              key={recipe.name}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <h3 className="break-words text-ui-base font-medium">{recipe.name}</h3>
                <p className="text-ui-sm text-foreground-subtle">{recipe.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={model.busy || Boolean(editor || review)}
                  onClick={() => void open(recipe.name, true)}
                >
                  {message("edit")}
                </Button>
                <Button
                  type="button"
                  disabled={model.busy || Boolean(editor || review)}
                  onClick={() => void open(recipe.name, false)}
                >
                  {message("review")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="border-t border-border pt-3">
        <h3 className="mb-2 text-ui-base font-medium">{message("history")}</h3>
        {model.runs.length === 0 ? (
          <p className="text-ui-sm text-foreground-subtle">{message("noRuns")}</p>
        ) : (
          <ul className="grid gap-2">
            {model.runs.map((run) => (
              <li
                key={run.runId}
                className="flex flex-wrap items-center justify-between gap-2 text-ui-sm"
              >
                <span>
                  {run.name} ·{" "}
                  <span>
                    {intl.formatMessage({ id: `chat.toolCall.workflow.run.status.${run.status}` })}
                  </span>{" "}
                  ·{" "}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(run.createdAt)}
                </span>
                {run.parentSessionId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenConversation(run.parentSessionId!)}
                  >
                    {message("openConversation")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
