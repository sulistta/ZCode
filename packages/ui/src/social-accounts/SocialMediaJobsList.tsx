import { RefreshCw, X } from "lucide-react";
import type { SocialMediaJob } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";

type IntlContext = ReturnType<typeof useZCodeIntl>;

export function SocialMediaJobsList({
  jobs,
  busyJobId,
  intl,
  locale,
  onCancel,
  onRetry,
}: {
  jobs: SocialMediaJob[];
  busyJobId: string | null;
  intl: IntlContext["intl"];
  locale: IntlContext["locale"];
  onCancel(jobId: string): void;
  onRetry(jobId: string): void;
}) {
  if (jobs.length === 0) return null;
  const byteFormatter = new Intl.NumberFormat(locale);
  const statusMessageIds = {
    queued: "socialMedia.job.queued",
    downloading: "socialMedia.job.downloading",
    transcribing: "socialMedia.job.transcribing",
    proxying: "socialMedia.job.proxying",
    finalizing: "socialMedia.job.finalizing",
    cancelling: "socialMedia.job.cancelling",
    completed: "socialMedia.job.completed",
    failed: "socialMedia.job.failed",
    cancelled: "socialMedia.job.cancelled",
  } as const;

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <h2 className="text-ui-lg font-semibold">
        {intl.formatMessage({ id: "socialMedia.jobsTitle" })}
      </h2>
      <ul
        className="mt-3 space-y-2"
        aria-label={intl.formatMessage({ id: "socialMedia.jobsTitle" })}
      >
        {jobs.map((job) => {
          const progress =
            job.sourceKind === "preview-proxy" && job.durationSeconds
              ? Math.min(100, Math.floor(((job.processedSeconds ?? 0) / job.durationSeconds) * 100))
              : job.totalBytes && job.totalBytes > 0
                ? Math.min(100, Math.floor((job.downloadedBytes / job.totalBytes) * 100))
                : null;
          const isBusy = busyJobId === job.jobId;
          const canCancel = [
            "queued",
            "downloading",
            "finalizing",
            "transcribing",
            "proxying",
          ].includes(job.state);
          const canRetry = job.state === "failed" || job.state === "cancelled";
          return (
            <li
              key={job.jobId}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                {job.sourceKind === "preview-proxy" ? (
                  <span className="block text-ui-sm font-medium text-foreground">
                    {intl.formatMessage({ id: "socialMedia.job.previewProxy" })}
                  </span>
                ) : (
                  <a
                    className="block truncate text-ui-sm font-medium text-foreground underline-offset-4 hover:underline"
                    href={job.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {job.sourceUrl}
                  </a>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle">
                  <span>{intl.formatMessage({ id: statusMessageIds[job.state] })}</span>
                  {job.state === "downloading" ? (
                    <span>
                      {intl.formatMessage(
                        { id: "socialMedia.job.bytes" },
                        { bytes: byteFormatter.format(job.downloadedBytes) },
                      )}
                    </span>
                  ) : null}
                  {job.errorCode ? (
                    <span className="text-destructive">
                      {intl.formatMessage({ id: `socialMedia.jobError.${job.errorCode}` })}
                    </span>
                  ) : null}
                </div>
                {progress !== null && (job.state === "downloading" || job.state === "proxying") ? (
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
                    role="progressbar"
                    aria-label={intl.formatMessage({ id: "socialMedia.job.progress" })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                ) : null}
              </div>
              {canCancel || canRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-start sm:self-auto"
                  disabled={isBusy || job.state === "cancelling"}
                  onClick={() => (canCancel ? onCancel(job.jobId) : onRetry(job.jobId))}
                >
                  {isBusy ? (
                    <RefreshCw className="animate-spin" aria-hidden="true" />
                  ) : canCancel ? (
                    <X aria-hidden="true" />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  {intl.formatMessage({
                    id: canCancel ? "socialMedia.job.cancel" : "socialMedia.job.retry",
                  })}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
