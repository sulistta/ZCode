import type { SocialProjectHistoryEntry } from "@social-harness/services";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const HISTORY_OPERATION_MESSAGE_IDS: Record<string, string> = {
  "rename-project": "socialProject.history.operation.rename",
  "add-track": "socialProject.history.operation.addTrack",
  "remove-track": "socialProject.history.operation.removeTrack",
  "move-track": "socialProject.history.operation.moveTrack",
  "put-clip": "socialProject.history.operation.putClip",
  "remove-clip": "socialProject.history.operation.removeClip",
  "move-clip": "socialProject.history.operation.moveClip",
  "split-clip": "socialProject.history.operation.splitClip",
  "update-settings": "socialProject.history.operation.updateSettings",
  undo: "socialProject.history.operation.undo",
  redo: "socialProject.history.operation.redo",
  "take-control": "socialProject.history.operation.takeControl",
  "return-to-agent": "socialProject.history.operation.returnControl",
};

export function SocialProjectHistory({ history }: { history: SocialProjectHistoryEntry[] }) {
  const { intl, locale } = useZCodeIntl();
  return (
    <section className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h2 className="text-ui-base font-semibold">
        {intl.formatMessage({ id: "socialProject.history.title" })}
      </h2>
      {history.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.history.empty" })}
        </p>
      ) : (
        <ol className="grid gap-1">
          {[...history]
            .reverse()
            .slice(0, 20)
            .map((entry) => (
              <li key={entry.commandId} className="flex flex-wrap justify-between gap-2 text-ui-sm">
                <span>
                  {intl.formatMessage(
                    { id: "socialProject.history.entry" },
                    {
                      revision: entry.revision,
                      operation: intl.formatMessage({
                        id:
                          HISTORY_OPERATION_MESSAGE_IDS[entry.operation] ??
                          "socialProject.history.operation.other",
                      }),
                      author: intl.formatMessage({
                        id:
                          entry.author === "user"
                            ? "socialProject.author.user"
                            : "socialProject.author.agent",
                      }),
                    },
                  )}
                </span>
                <time
                  className="text-foreground-subtle"
                  dateTime={new Date(entry.updatedAt).toISOString()}
                >
                  {new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(entry.updatedAt)}
                </time>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
