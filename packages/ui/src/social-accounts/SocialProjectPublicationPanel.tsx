import { useCallback, useEffect, useState } from "react";
import type {
  InstagramPublication,
  SocialProjectExportJob,
  SocialPublishingService,
} from "@social-harness/services";
import type { SocialProject } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const publicationStatusMessageIds: Record<InstagramPublication["status"], string> = {
  "approval-required": "socialProject.publish.status.approvalRequired",
  "preparing-media": "socialProject.publish.status.preparing",
  "creating-container": "socialProject.publish.status.creating",
  "processing-container": "socialProject.publish.status.processing",
  publishing: "socialProject.publish.status.publishing",
  published: "socialProject.publish.status.published",
  failed: "socialProject.publish.status.failed",
  "reconciliation-required": "socialProject.publish.status.reconciliation",
  "not-published": "socialProject.publish.status.notPublished",
};

export function SocialProjectPublicationPanel({
  accountId,
  project,
  completedExports,
  publishingService,
  instagramConnected,
}: {
  accountId: string;
  project: SocialProject;
  completedExports: SocialProjectExportJob[];
  publishingService?: SocialPublishingService;
  instagramConnected: boolean;
}) {
  const { intl } = useZCodeIntl();
  const [publications, setPublications] = useState<InstagramPublication[]>([]);
  const [caption, setCaption] = useState("");
  const [permalinks, setPermalinks] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publishingService) return;
    try {
      const next = await publishingService.listInstagramPublications(accountId);
      setPublications(next.filter((publication) => publication.projectId === project.projectId));
      setError(null);
    } catch {
      setError(intl.formatMessage({ id: "socialProject.publish.status.loadFailed" }));
    }
  }, [accountId, intl, project.projectId, publishingService]);

  useEffect(() => {
    if (!publishingService) return;
    const subscription = publishingService.onPublicationChanged((change) => {
      if (change.accountId === accountId) void refresh();
    });
    void refresh();
    return () => subscription.dispose();
  }, [accountId, publishingService, refresh]);

  if (!publishingService) return null;

  const eligibleExports = completedExports
    .filter((job) => job.projectRevision === project.revision)
    .slice(0, 1);

  const approve = async (job: SocialProjectExportJob) => {
    if (
      !caption.trim() ||
      !instagramConnected ||
      job.projectRevision !== project.revision ||
      workingId
    ) {
      return;
    }
    setWorkingId(job.exportId);
    setError(null);
    setNotice(null);
    try {
      await publishingService.approveAndPublishInstagramReel({
        accountId,
        exportId: job.exportId,
        caption: caption.trim(),
        requestId: crypto.randomUUID(),
      });
      setCaption("");
      await refresh();
      setNotice(intl.formatMessage({ id: "socialProject.publish.status.approved" }));
    } catch {
      setError(intl.formatMessage({ id: "socialProject.publish.status.startFailed" }));
    } finally {
      setWorkingId(null);
    }
  };

  const resolve = async (
    publication: InstagramPublication,
    outcome: "published" | "not-published",
  ) => {
    if (workingId) return;
    setWorkingId(publication.publicationId);
    setError(null);
    setNotice(null);
    try {
      if (outcome === "published") {
        await publishingService.resolveInstagramPublication({
          accountId,
          publicationId: publication.publicationId,
          outcome,
          permalink: permalinks[publication.publicationId]?.trim() ?? "",
        });
      } else {
        await publishingService.resolveInstagramPublication({
          accountId,
          publicationId: publication.publicationId,
          outcome,
        });
      }
      await refresh();
    } catch {
      setError(intl.formatMessage({ id: "socialProject.publish.status.resolveFailed" }));
    } finally {
      setWorkingId(null);
    }
  };

  const approveProposal = async (publication: InstagramPublication) => {
    if (workingId || !instagramConnected) return;
    setWorkingId(publication.publicationId);
    setError(null);
    setNotice(null);
    try {
      await publishingService.approveInstagramPublicationProposal({
        accountId,
        publicationId: publication.publicationId,
      });
      await refresh();
      setNotice(intl.formatMessage({ id: "socialProject.publish.status.approved" }));
    } catch {
      setError(intl.formatMessage({ id: "socialProject.publish.status.startFailed" }));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="grid gap-3 border-t border-border pt-3">
      <div className="grid gap-1">
        <label className="grid gap-1 text-ui-sm font-medium" htmlFor="social-project-caption">
          {intl.formatMessage({ id: "socialProject.publish.caption" })}
          <textarea
            id="social-project-caption"
            className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-ui-sm font-normal"
            value={caption}
            maxLength={2_200}
            onChange={(event) => setCaption(event.currentTarget.value)}
            placeholder={intl.formatMessage({ id: "socialProject.publish.captionPlaceholder" })}
          />
        </label>
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage(
            { id: "socialProject.publish.captionCount" },
            { count: caption.length },
          )}
        </p>
        <p className="text-ui-sm text-foreground-subtle" role="note">
          {intl.formatMessage({ id: "socialProject.publish.formatLimits" })}
        </p>
        <p className="text-ui-sm text-foreground-subtle" role="note">
          {intl.formatMessage({ id: "socialConvex.mediaLimits" })}
        </p>
      </div>
      {!instagramConnected ? (
        <p className="text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialProject.publish.connectFirst" })}
        </p>
      ) : null}
      {eligibleExports.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {eligibleExports.map((job) => (
            <Button
              key={job.exportId}
              type="button"
              size="sm"
              disabled={!caption.trim() || !instagramConnected || Boolean(workingId)}
              onClick={() => void approve(job)}
            >
              {intl.formatMessage(
                {
                  id:
                    workingId === job.exportId
                      ? "socialProject.publish.approving"
                      : "socialProject.publish.approveRevision",
                },
                { revision: job.projectRevision },
              )}
            </Button>
          ))}
        </div>
      ) : null}
      {publications.length ? (
        <ul
          className="grid gap-2"
          aria-label={intl.formatMessage({ id: "socialProject.publish.history" })}
        >
          {publications.slice(0, 5).map((publication) => (
            <li
              key={publication.publicationId}
              className="grid gap-2 rounded-md border border-border bg-background p-3"
            >
              <p className="text-ui-sm font-medium" role="status">
                {intl.formatMessage({ id: publicationStatusMessageIds[publication.status] })}
              </p>
              {publication.errorCode === "capacity-unavailable" ? (
                <p role="alert" className="text-ui-sm text-destructive">
                  {intl.formatMessage({ id: "socialConvex.error.capacity-unavailable" })}
                </p>
              ) : null}
              {publication.status === "approval-required" ? (
                <>
                  <p className="whitespace-pre-wrap text-ui-sm">{publication.caption}</p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!instagramConnected || Boolean(workingId)}
                    onClick={() => void approveProposal(publication)}
                  >
                    {intl.formatMessage({
                      id:
                        workingId === publication.publicationId
                          ? "socialProject.publish.approving"
                          : "socialProject.publish.approveProposal",
                    })}
                  </Button>
                </>
              ) : null}
              {publication.status === "reconciliation-required" ? (
                <div className="grid gap-2">
                  <p className="text-ui-xs text-foreground-subtle">
                    {intl.formatMessage({ id: "socialProject.publish.reconciliationHelp" })}
                  </p>
                  <input
                    className="h-9 rounded-md border border-input bg-background px-3 text-ui-sm"
                    type="url"
                    value={permalinks[publication.publicationId] ?? ""}
                    placeholder="https://www.instagram.com/reel/..."
                    aria-label={intl.formatMessage({ id: "socialProject.publish.permalink" })}
                    onChange={(event) =>
                      setPermalinks((current) => ({
                        ...current,
                        [publication.publicationId]: event.currentTarget.value,
                      }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        Boolean(workingId) || !permalinks[publication.publicationId]?.trim()
                      }
                      onClick={() => void resolve(publication, "published")}
                    >
                      {intl.formatMessage({ id: "socialProject.publish.foundPost" })}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(workingId)}
                      onClick={() => void resolve(publication, "not-published")}
                    >
                      {intl.formatMessage({ id: "socialProject.publish.confirmNoPost" })}
                    </Button>
                  </div>
                </div>
              ) : null}
              {publication.status === "published" && publication.permalink ? (
                <a
                  className="text-ui-sm text-primary underline"
                  href={publication.permalink}
                  target="_blank"
                  rel="noreferrer"
                >
                  {intl.formatMessage({ id: "socialProject.publish.openPost" })}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
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
