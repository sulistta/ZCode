import { useCallback, useRef, useState, type FormEvent } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import type { SocialAccount } from "@social-harness/shared";
import type {
  SocialMediaJob,
  SocialMediaService,
  SocialMediaYouTubeSearchResult,
} from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.trunc(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function YouTubeResultAction({
  result,
  job,
  busy,
  intl,
  onDownload,
  onRetry,
}: {
  result: SocialMediaYouTubeSearchResult;
  job: SocialMediaJob | undefined;
  busy: boolean;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  onDownload(url: string, busyKey: string): void;
  onRetry(jobId: string): void;
}) {
  const canRetry = job?.state === "failed" || job?.state === "cancelled";
  const complete = job?.state === "completed";
  const active =
    job !== undefined &&
    ["queued", "downloading", "transcribing", "finalizing", "cancelling"].includes(job.state);
  const messageId = complete
    ? "socialMedia.job.completed"
    : canRetry
      ? "socialMedia.job.retry"
      : active
        ? `socialMedia.job.${job.state}`
        : "socialMedia.youtubeAdd";

  return (
    <Button
      type="button"
      size="sm"
      className="mt-3"
      variant={complete || active ? "outline" : "default"}
      disabled={busy || complete || active}
      onClick={() =>
        canRetry && job ? onRetry(job.jobId) : onDownload(result.videoUrl, result.videoId)
      }
    >
      {busy ? (
        <RefreshCw className="animate-spin" aria-hidden="true" />
      ) : canRetry ? (
        <RefreshCw aria-hidden="true" />
      ) : (
        <Download aria-hidden="true" />
      )}
      {intl.formatMessage({ id: messageId })}
    </Button>
  );
}

export function SocialYouTubeDiscoveryPanel({
  account,
  service,
  jobs,
  busyKey,
  onDownload,
  onRetry,
}: {
  account: SocialAccount;
  service: SocialMediaService;
  jobs: SocialMediaJob[];
  busyKey: string | null;
  onDownload(url: string, busyKey: string): void;
  onRetry(jobId: string): void;
}) {
  const { intl, locale } = useZCodeIntl();
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [results, setResults] = useState<SocialMediaYouTubeSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchGeneration = useRef(0);
  const searchForm = useRef<HTMLFormElement>(null);

  const searchYouTube = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedQuery = query.trim();
      if (!normalizedQuery || isSearching) return;
      const generation = ++searchGeneration.current;
      setIsSearching(true);
      setSearchFailed(false);
      setHasSearched(true);
      setResults([]);
      try {
        const found = await service.searchYouTube({
          accountId: account.accountId,
          query: normalizedQuery,
        });
        if (generation === searchGeneration.current) setResults(found);
      } catch {
        if (generation === searchGeneration.current) setSearchFailed(true);
      } finally {
        if (generation === searchGeneration.current) setIsSearching(false);
      }
    },
    [account.accountId, isSearching, query, service],
  );

  const submitUrl = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedUrl = url.trim();
      if (!normalizedUrl || busyKey) return;
      onDownload(normalizedUrl, "manual-url");
    },
    [busyKey, onDownload, url],
  );

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <h2 className="text-ui-lg font-semibold">
        {intl.formatMessage({ id: "socialMedia.youtubeSearchTitle" })}
      </h2>
      <p className="mt-1 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "socialMedia.youtubeSearchDescription" })}
      </p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submitUrl}>
        <Input
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          maxLength={2048}
          aria-label={intl.formatMessage({ id: "socialMedia.youtubeUrlLabel" })}
          placeholder={intl.formatMessage({ id: "socialMedia.youtubeUrlPlaceholder" })}
          disabled={busyKey !== null}
        />
        <Button type="submit" disabled={!url.trim() || busyKey !== null} className="shrink-0">
          {busyKey === "manual-url" ? (
            <RefreshCw className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {intl.formatMessage({
            id: busyKey === "manual-url" ? "socialMedia.youtubeAdding" : "socialMedia.youtubeAdd",
          })}
        </Button>
      </form>
      <form
        ref={searchForm}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => void searchYouTube(event)}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          maxLength={240}
          aria-label={intl.formatMessage({ id: "socialMedia.youtubeSearchLabel" })}
          placeholder={intl.formatMessage({ id: "socialMedia.youtubeSearchPlaceholder" })}
          disabled={isSearching}
        />
        <Button type="submit" disabled={isSearching || !query.trim()} className="shrink-0">
          {isSearching ? (
            <RefreshCw className="animate-spin" aria-hidden="true" />
          ) : (
            <Search aria-hidden="true" />
          )}
          {intl.formatMessage({
            id: isSearching ? "socialMedia.youtubeSearching" : "socialMedia.youtubeSearch",
          })}
        </Button>
      </form>
      {searchFailed ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-background px-3 py-2 text-ui-sm"
          role="alert"
        >
          <span className="text-destructive">
            {intl.formatMessage({ id: "socialMedia.youtubeSearchFailed" })}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={isSearching || !query.trim()}
            onClick={() => searchForm.current?.requestSubmit()}
          >
            <RefreshCw aria-hidden="true" />
            {intl.formatMessage({ id: "socialMedia.retry" })}
          </Button>
        </div>
      ) : null}
      {isSearching ? (
        <p className="mt-4 text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialMedia.youtubeSearchingStatus" })}
        </p>
      ) : null}
      {hasSearched && !isSearching && !searchFailed && results.length === 0 ? (
        <p className="mt-4 text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialMedia.youtubeNoResults" })}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul
          className="mt-4 grid gap-3 sm:grid-cols-2"
          aria-label={intl.formatMessage({ id: "socialMedia.youtubeResults" })}
        >
          {results.map((result) => {
            const job = jobs.find((item) => item.sourceVideoId === result.videoId);
            return (
              <li
                key={result.videoId}
                className="min-w-0 rounded-lg border border-border bg-background p-3"
              >
                <a
                  className="line-clamp-2 text-ui-base font-medium text-foreground underline-offset-4 hover:underline"
                  href={result.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {result.title}
                </a>
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle">
                  {result.channel ? <span>{result.channel}</span> : null}
                  {result.durationSeconds !== null ? (
                    <span>{formatDuration(result.durationSeconds)}</span>
                  ) : null}
                  {result.viewCount !== null ? (
                    <span>
                      {intl.formatMessage(
                        { id: "socialMedia.youtubeViews" },
                        { count: new Intl.NumberFormat(locale).format(result.viewCount) },
                      )}
                    </span>
                  ) : null}
                  {result.uploadDate ? <span>{result.uploadDate}</span> : null}
                </div>
                <YouTubeResultAction
                  result={result}
                  job={job}
                  busy={busyKey === result.videoId || busyKey === job?.jobId}
                  intl={intl}
                  onDownload={onDownload}
                  onRetry={onRetry}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
