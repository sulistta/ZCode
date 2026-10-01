import { useCallback, useEffect, useState } from "react";
import type {
  SocialProjectExportJob,
  SocialProjectService,
  SocialPublishingService,
} from "@social-harness/services";
import type { SocialProject } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialProjectPublicationPanel } from "./SocialProjectPublicationPanel.js";

const statusMessageIds: Record<SocialProjectExportJob["status"], string> = {
  queued: "socialProject.export.status.queued",
  rendering: "socialProject.export.status.rendering",
  completed: "socialProject.export.status.completed",
  failed: "socialProject.export.status.failed",
  cancelled: "socialProject.export.status.cancelled",
};

function isActive(job: SocialProjectExportJob): boolean {
  return job.status === "queued" || job.status === "rendering";
}

export function SocialProjectExportPanel({
  accountId,
  project,
  service,
  publishingService,
  instagramConnected,
}: {
  accountId: string;
  project: SocialProject;
  service: SocialProjectService;
  publishingService?: SocialPublishingService;
  instagramConnected: boolean;
}) {
  const { intl } = useZCodeIntl();
  const platform = useOptionalPlatform();
  const [jobs, setJobs] = useState<SocialProjectExportJob[]>([]);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextJobs = await service.listExports(accountId, project.projectId);
      setJobs(nextJobs);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [accountId, project.projectId, service]);

  useEffect(() => {
    const subscription = service.onExportChanged((change) => {
      if (change.accountId === accountId && change.projectId === project.projectId) {
        void refresh();
      }
    });
    void refresh();
    return () => subscription.dispose();
  }, [accountId, project.projectId, refresh, service]);

  const startExport = async () => {
    if (!platform || workingId) return;
    setWorkingId("start");
    setError(null);
    setNotice(null);
    try {
      await service.startExport({
        accountId,
        projectId: project.projectId,
        expectedRevision: project.revision,
        requestId: crypto.randomUUID(),
      });
      await refresh();
    } catch (caught) {
      setError(
        intl.formatMessage({
          id:
            caught instanceof Error && caught.name === "SocialProjectExportRevisionConflictError"
              ? "socialProject.export.status.stale"
              : "socialProject.export.status.startFailed",
        }),
      );
    } finally {
      setWorkingId(null);
    }
  };

  const cancelExport = async (job: SocialProjectExportJob) => {
    if (workingId) return;
    setWorkingId(job.exportId);
    setError(null);
    setNotice(null);
    try {
      const updated = await service.cancelExport({ accountId, exportId: job.exportId });
      setJobs((current) =>
        current.map((candidate) => (candidate.exportId === updated.exportId ? updated : candidate)),
      );
    } catch {
      setError(intl.formatMessage({ id: "socialProject.export.status.cancelFailed" }));
    } finally {
      setWorkingId(null);
    }
  };

  const saveExport = async (job: SocialProjectExportJob) => {
    if (!platform?.saveFile || workingId) return;
    const saveFile = platform.saveFile;
    setWorkingId(job.exportId);
    setError(null);
    setNotice(null);
    try {
      const download = await service.prepareExportDownload({ accountId, exportId: job.exportId });
      const result = await saveFile({
        sourceUrl: download.url,
        suggestedName: download.suggestedName,
      });
      if (result.canceled) {
        setNotice(intl.formatMessage({ id: "socialProject.export.status.saveCancelled" }));
      } else if (result.success) {
        setNotice(intl.formatMessage({ id: "socialProject.export.status.saved" }));
      } else {
        setError(intl.formatMessage({ id: "socialProject.export.status.downloadFailed" }));
      }
    } catch {
      setError(intl.formatMessage({ id: "socialProject.export.status.downloadFailed" }));
    } finally {
      setWorkingId(null);
    }
  };

  const hasActiveCurrentRevision = jobs.some(
    (job) => job.projectRevision === project.revision && isActive(job),
  );

  return (
    <section className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ui-base font-semibold">
            {intl.formatMessage({ id: "socialProject.export.title" })}
          </h2>
          <p className="mt-1 max-w-2xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.export.description" })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!platform || Boolean(workingId) || hasActiveCurrentRevision}
          onClick={() => void startExport()}
        >
          {intl.formatMessage(
            {
              id:
                workingId === "start"
                  ? "socialProject.export.starting"
                  : "socialProject.export.start",
            },
            { revision: project.revision },
          )}
        </Button>
      </div>

      {!platform ? (
        <p className="text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialProject.export.desktopOnly" })}
        </p>
      ) : null}
      {loadFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
          <span className="text-ui-sm text-destructive">
            {intl.formatMessage({ id: "socialProject.export.status.loadFailed" })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            {intl.formatMessage({ id: "socialAccounts.retry" })}
          </Button>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <ul className="grid gap-2">
          {jobs.slice(0, 5).map((job) => (
            <li
              key={job.exportId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="grid min-w-40 flex-1 gap-1">
                <p className="text-ui-sm font-medium">
                  {intl.formatMessage(
                    { id: statusMessageIds[job.status] },
                    {
                      revision: job.projectRevision,
                      progress: job.progressPercent,
                    },
                  )}
                </p>
                {job.status === "rendering" ? (
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-surface"
                    role="progressbar"
                    aria-label={intl.formatMessage({ id: "socialProject.export.progress" })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={job.progressPercent}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${job.progressPercent}%` }}
                    />
                  </div>
                ) : null}
                {job.status === "failed" && job.errorCode ? (
                  <p className="text-ui-xs text-foreground-subtle">
                    {intl.formatMessage({ id: `socialProject.export.error.${job.errorCode}` })}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {isActive(job) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(workingId)}
                    onClick={() => void cancelExport(job)}
                  >
                    {intl.formatMessage({ id: "socialProject.export.cancel" })}
                  </Button>
                ) : null}
                {job.status === "completed" ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(workingId) || !platform}
                      onClick={() => void saveExport(job)}
                    >
                      {intl.formatMessage({ id: "socialProject.export.save" })}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <SocialProjectPublicationPanel
        accountId={accountId}
        project={project}
        completedExports={jobs.filter((job) => job.status === "completed")}
        publishingService={publishingService}
        instagramConnected={instagramConnected}
      />
      {error ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-ui-sm text-foreground-subtle" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
