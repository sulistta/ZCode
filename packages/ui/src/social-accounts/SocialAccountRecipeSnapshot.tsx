import type { ApprovedWorkflowSnapshot } from "@social-harness/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 只读版本来自已保存 schedule/run 或待批准 draft；不按定义名称重查 source。 */
export function SocialAccountRecipeSnapshot({
  snapshot,
  invalid = false,
  accountName,
}: {
  snapshot?: ApprovedWorkflowSnapshot;
  invalid?: boolean;
  accountName?: string;
}) {
  const { intl } = useZCodeIntl();
  const message = (key: string) => intl.formatMessage({ id: `socialAccounts.recipes.${key}` });
  return (
    <section
      className="grid gap-2 rounded-md border border-border bg-surface p-3"
      aria-label={message("pinnedVersion")}
    >
      <h3 className="text-ui-base font-medium">{message("pinnedVersion")}</h3>
      {invalid ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {message("invalidDefinitions")}
        </p>
      ) : null}
      {snapshot ? (
        <>
          <p className="text-ui-sm">
            {snapshot.name}
            {accountName ? ` · ${accountName}` : ""}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm">
            {snapshot.script}
          </pre>
          <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm">
            {JSON.stringify(
              { declarations: snapshot.meta.args ?? {}, values: snapshot.args },
              null,
              2,
            )}
          </pre>
        </>
      ) : null}
    </section>
  );
}
