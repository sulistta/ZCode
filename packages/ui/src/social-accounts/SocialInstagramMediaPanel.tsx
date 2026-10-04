import { ExternalLink, RefreshCw } from "lucide-react";
import type { IPlatformService, InstagramMedia } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialInstagramMediaPanel({
  media,
  isLoading,
  errorMessageId,
  platform,
  onReload,
}: {
  media: InstagramMedia[];
  isLoading: boolean;
  errorMessageId: string | null;
  platform: IPlatformService;
  onReload: () => void;
}) {
  const { intl, locale } = useZCodeIntl();

  return (
    <section
      aria-labelledby="social-instagram-media-title"
      className="rounded-xl border border-card-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="social-instagram-media-title" className="text-ui-lg font-semibold">
          {intl.formatMessage({ id: "socialAccounts.media.title" })}
        </h2>
        <Button type="button" size="sm" variant="outline" disabled={isLoading} onClick={onReload}>
          <RefreshCw aria-hidden="true" />
          {intl.formatMessage({ id: "socialAccounts.media.refresh" })}
        </Button>
      </div>
      {isLoading ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialAccounts.media.loading" })}
        </p>
      ) : errorMessageId ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3" role="alert">
          <p className="text-ui-sm text-destructive">
            {intl.formatMessage({ id: errorMessageId })}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onReload}>
            {intl.formatMessage({ id: "socialAccounts.retry" })}
          </Button>
        </div>
      ) : media.length === 0 ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialAccounts.media.empty" })}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {media.map((item) => (
            <li
              key={item.mediaId}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-ui-sm text-foreground">
                  {item.caption?.trim() ||
                    intl.formatMessage({ id: "socialAccounts.media.noCaption" })}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-xs text-foreground-subtle">
                  <span>
                    {intl.formatMessage(
                      { id: "socialAccounts.media.type" },
                      { type: item.mediaType.toLocaleLowerCase(locale) },
                    )}
                  </span>
                  {item.timestamp ? (
                    <time dateTime={item.timestamp}>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(item.timestamp))}
                    </time>
                  ) : null}
                </div>
              </div>
              {item.permalink ? (
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  onClick={() => platform.openExternal(item.permalink!)}
                >
                  <ExternalLink aria-hidden="true" />
                  {intl.formatMessage({ id: "socialAccounts.media.open" })}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
