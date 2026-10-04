import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialAccountAutomationNotices({
  actionFailed,
  loadFailed,
  noticeId,
  onRetry,
  workspaceUnavailable,
}: {
  actionFailed: boolean;
  loadFailed: boolean;
  noticeId: string | null;
  onRetry: () => void;
  workspaceUnavailable: boolean;
}) {
  const { intl } = useZCodeIntl();

  return (
    <>
      {noticeId ? (
        <p
          className="rounded-md border border-success/30 bg-card px-3 py-2 text-ui-sm text-success"
          role="status"
        >
          {intl.formatMessage({ id: noticeId })}
        </p>
      ) : null}
      {actionFailed ? (
        <p
          className="rounded-md border border-destructive/30 bg-card px-3 py-2 text-ui-sm text-destructive"
          role="alert"
        >
          {intl.formatMessage({ id: "socialAccounts.automations.actionFailed" })}
        </p>
      ) : null}
      {workspaceUnavailable ? (
        <p
          className="rounded-md border border-destructive/30 bg-card px-3 py-3 text-ui-sm text-destructive"
          role="alert"
        >
          {intl.formatMessage({ id: "socialAccounts.automations.workspaceUnavailable" })}
        </p>
      ) : null}
      {loadFailed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-4"
          role="alert"
        >
          <span className="text-ui-sm text-foreground">
            {intl.formatMessage({ id: "socialAccounts.automations.loadFailed" })}
          </span>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        </div>
      ) : null}
    </>
  );
}
