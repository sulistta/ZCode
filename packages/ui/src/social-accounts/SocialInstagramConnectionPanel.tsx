import type { InstagramConnection } from "@social-harness/shared";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SocialInstagramAuthorizationAvailability } from "./useSocialInstagramConnections.js";

const CONNECTION_LABELS: Record<InstagramConnection["status"], string> = {
  disconnected: "socialAccounts.connection.disconnected",
  connecting: "socialAccounts.connection.connecting",
  connected: "socialAccounts.connection.connected",
  "reauth-required": "socialAccounts.connection.reauthRequired",
};

export function SocialInstagramConnectionPanel({
  connection,
  isDesktop,
  authorizationAvailability,
  isBusy,
  errorMessageId,
  noticeMessageId,
  onConnect,
  onDisconnect,
  onRetryAuthorizationAvailability,
}: {
  connection: InstagramConnection;
  isDesktop: boolean;
  authorizationAvailability: SocialInstagramAuthorizationAvailability;
  isBusy: boolean;
  errorMessageId: string | null;
  noticeMessageId: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetryAuthorizationAvailability: () => void;
}) {
  const { intl } = useZCodeIntl();
  const connected = connection.status === "connected";

  return (
    <section
      aria-labelledby="social-instagram-connection-title"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="social-instagram-connection-title" className="text-ui-lg font-semibold">
            {intl.formatMessage({ id: "socialAccounts.connection.title" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {connected && connection.profile
              ? `${intl.formatMessage({ id: CONNECTION_LABELS.connected })} · @${connection.profile.username}`
              : intl.formatMessage({ id: CONNECTION_LABELS[connection.status] })}
          </p>
        </div>
        {connected ? (
          <Button type="button" variant="outline" disabled={isBusy} onClick={onDisconnect}>
            {intl.formatMessage({ id: "socialAccounts.connection.disconnect" })}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              !isDesktop ||
              authorizationAvailability !== "available" ||
              isBusy ||
              connection.status === "connecting"
            }
            onClick={onConnect}
          >
            {intl.formatMessage({
              id:
                connection.status === "reauth-required"
                  ? "socialAccounts.connection.reauthorize"
                  : "socialAccounts.connection.connect",
            })}
          </Button>
        )}
      </div>
      {!isDesktop ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle" role="note">
          {intl.formatMessage({ id: "socialAccounts.connection.desktopRequired" })}
        </p>
      ) : null}
      {isDesktop && authorizationAvailability === "checking" ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialAccounts.connection.availabilityChecking" })}
        </p>
      ) : null}
      {isDesktop && authorizationAvailability === "unavailable" ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle" role="note">
          {intl.formatMessage({ id: "socialAccounts.connection.notConfigured" })}
        </p>
      ) : null}
      {isDesktop && authorizationAvailability === "failed" ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-background px-3 py-2"
          role="alert"
        >
          <span className="text-ui-sm text-destructive">
            {intl.formatMessage({ id: "socialAccounts.connection.availabilityFailed" })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryAuthorizationAvailability}
          >
            <RefreshCw aria-hidden="true" />
            {intl.formatMessage({ id: "socialAccounts.retry" })}
          </Button>
        </div>
      ) : null}
      {errorMessageId ? (
        <p className="mt-3 text-ui-sm text-destructive" role="alert">
          {intl.formatMessage({ id: errorMessageId })}
        </p>
      ) : null}
      {noticeMessageId ? (
        <p className="mt-3 text-ui-sm text-success" role="status">
          {intl.formatMessage({ id: noticeMessageId })}
        </p>
      ) : null}
    </section>
  );
}
