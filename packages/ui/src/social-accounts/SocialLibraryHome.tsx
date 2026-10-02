import { useCallback, useEffect, useRef, useState } from "react";
import { FileAudio, FileImage, FileVideo, RefreshCw, Upload } from "lucide-react";
import type { SocialAccount } from "@social-harness/shared";
import type {
  SocialMediaAsset,
  SocialMediaJob,
  SocialMediaService,
} from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialMediaJobsList } from "./SocialMediaJobsList.js";
import { SocialMediaClipAnalysis } from "./SocialMediaClipAnalysis.js";
import { SocialMediaTranscriptionSetup } from "./SocialMediaTranscriptionSetup.js";
import { SocialYouTubeDiscoveryPanel } from "./SocialYouTubeDiscoveryPanel.js";

const MEDIA_KIND_MESSAGE_IDS = {
  audio: "socialMedia.kind.audio",
  image: "socialMedia.kind.image",
  video: "socialMedia.kind.video",
} as const;

function formatByteCount(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale).format(bytes)} bytes`;
}

function areJobsEqual(first: SocialMediaJob[], second: SocialMediaJob[]): boolean {
  return (
    first.length === second.length &&
    first.every((job, index) => {
      const next = second[index];
      return (
        job.jobId === next?.jobId &&
        job.updatedAt === next.updatedAt &&
        job.state === next.state &&
        job.downloadedBytes === next.downloadedBytes
      );
    })
  );
}

export function SocialLibraryHome({
  account,
  service,
}: {
  account: SocialAccount;
  service: SocialMediaService;
}) {
  const platform = usePlatform();
  const { intl, locale } = useZCodeIntl();
  const [assets, setAssets] = useState<SocialMediaAsset[]>([]);
  // 快照变化只更新 ref；若让 loadJobs 捕获 assets，刷新会改变回调身份并反复重启 Library 加载 effect。
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  const [jobs, setJobs] = useState<SocialMediaJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canPickLocalPath = platform.canSelectFilePath === true;

  const loadAssets = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setAssets(await service.list(account.accountId));
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [account.accountId, service]);

  const loadJobs = useCallback(async () => {
    try {
      const nextJobs = await service.listJobs(account.accountId);
      setJobs((current) => (areJobsEqual(current, nextJobs) ? current : nextJobs));
      if (
        nextJobs.some(
          (job) =>
            job.state === "completed" &&
            job.mediaId &&
            !assetsRef.current.some((asset) => asset.mediaId === job.mediaId),
        )
      ) {
        void loadAssets();
      }
    } catch {
      // onJobChanged and the next snapshot poll will reconcile after transient Host errors.
    }
  }, [account.accountId, loadAssets, service]);

  useEffect(() => {
    const assetSubscription = service.onChanged((change) => {
      if (change.accountId === account.accountId) void loadAssets();
    });
    const jobSubscription = service.onJobChanged((change) => {
      if (change.accountId === account.accountId) void loadJobs();
    });
    void loadAssets();
    void loadJobs();
    // Separate window Hosts share durable jobs but not in-memory emitters; snapshots reconcile that view.
    const poll = setInterval(() => void loadJobs(), 2_000);
    return () => {
      clearInterval(poll);
      assetSubscription.dispose();
      jobSubscription.dispose();
    };
  }, [account.accountId, loadAssets, loadJobs, service]);

  const importFiles = useCallback(async () => {
    if (isWorking || platform.canSelectFilePath !== true) return;
    setIsWorking(true);
    setError(null);
    setNotice(null);
    try {
      const selectedPaths = platform.selectFiles
        ? await platform.selectFiles()
        : [await platform.selectFile()].filter((path): path is string => path !== null);
      if (selectedPaths.length === 0) return;

      let importedCount = 0;
      let failedCount = 0;
      for (const sourcePath of selectedPaths) {
        try {
          await service.importLocalFile({ accountId: account.accountId, sourcePath });
          importedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      await loadAssets();
      if (failedCount > 0) {
        setError(intl.formatMessage({ id: "socialMedia.importFailed" }, { count: failedCount }));
      } else if (importedCount > 0) {
        setNotice(intl.formatMessage({ id: "socialMedia.imported" }, { count: importedCount }));
      }
    } catch {
      setError(intl.formatMessage({ id: "socialMedia.importFailed" }, { count: 1 }));
    } finally {
      setIsWorking(false);
    }
  }, [account.accountId, intl, isWorking, loadAssets, platform, service]);

  const addVideoSource = useCallback(
    async (url: string, busyKey: string) => {
      if (busyActionKey) return;
      setBusyActionKey(busyKey);
      setError(null);
      setNotice(null);
      try {
        const job = await service.downloadSourceUrl({ accountId: account.accountId, url });
        await Promise.all([loadJobs(), loadAssets()]);
        setNotice(
          intl.formatMessage({
            id:
              job.state === "completed"
                ? "socialMedia.job.completedNotice"
                : job.state === "failed" || job.state === "cancelled"
                  ? "socialMedia.job.existingFailedNotice"
                  : "socialMedia.job.queuedNotice",
          }),
        );
      } catch {
        setError(intl.formatMessage({ id: "socialMedia.youtubeDownloadFailed" }));
      } finally {
        setBusyActionKey(null);
      }
    },
    [account.accountId, busyActionKey, intl, loadAssets, loadJobs, service],
  );

  const changeJob = useCallback(
    async (jobId: string, action: "cancel" | "retry") => {
      if (busyActionKey) return;
      setBusyActionKey(jobId);
      setError(null);
      setNotice(null);
      try {
        if (action === "cancel") {
          await service.cancelJob({ accountId: account.accountId, jobId });
        } else {
          await service.retryJob({ accountId: account.accountId, jobId });
        }
        await loadJobs();
      } catch {
        setError(intl.formatMessage({ id: "socialMedia.youtubeDownloadFailed" }));
      } finally {
        setBusyActionKey(null);
      }
    },
    [account.accountId, busyActionKey, intl, loadJobs, service],
  );

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-ui-xs font-medium text-foreground">
            {account.displayName}
          </div>
          <h1 className="text-ui-xl font-semibold">
            {intl.formatMessage({ id: "socialMedia.title" })}
          </h1>
          <p className="mt-2 max-w-2xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "socialMedia.description" },
              { accountName: account.displayName },
            )}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void importFiles()}
          disabled={isWorking || !canPickLocalPath}
        >
          {isWorking ? (
            <RefreshCw className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {intl.formatMessage({ id: isWorking ? "socialMedia.importing" : "socialMedia.import" })}
        </Button>
      </header>

      {!canPickLocalPath ? (
        <p className="mb-4 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialMedia.desktopOnly" })}
        </p>
      ) : null}

      <SocialYouTubeDiscoveryPanel
        account={account}
        service={service}
        jobs={jobs}
        busyKey={busyActionKey}
        onDownload={(url, busyKey) => void addVideoSource(url, busyKey)}
        onRetry={(jobId) => void changeJob(jobId, "retry")}
      />
      <SocialMediaTranscriptionSetup service={service} />
      <SocialMediaJobsList
        jobs={jobs}
        busyJobId={busyActionKey}
        intl={intl}
        locale={locale}
        onCancel={(jobId) => void changeJob(jobId, "cancel")}
        onRetry={(jobId) => void changeJob(jobId, "retry")}
      />

      {error ? (
        <div
          className="mb-4 rounded-md border border-destructive/30 bg-card px-3 py-2 text-ui-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <p
          className="mb-4 rounded-md border border-success/30 bg-card px-3 py-2 text-ui-sm text-success"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {isLoading && assets.length === 0 ? (
        <div
          className="rounded-lg border border-border bg-card px-4 py-6 text-ui-base text-foreground-subtle"
          role="status"
        >
          {intl.formatMessage({ id: "socialMedia.loading" })}
        </div>
      ) : loadFailed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-4"
          role="alert"
        >
          <span className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "socialMedia.loadFailed" })}
          </span>
          <Button type="button" variant="outline" onClick={() => void loadAssets()}>
            <RefreshCw aria-hidden="true" />
            {intl.formatMessage({ id: "socialMedia.retry" })}
          </Button>
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-5 py-8">
          <h2 className="text-ui-lg font-semibold">
            {intl.formatMessage({ id: "socialMedia.emptyTitle" })}
          </h2>
          <p className="mt-2 max-w-xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialMedia.emptyDescription" })}
          </p>
          <Button
            type="button"
            className="mt-5"
            onClick={() => void importFiles()}
            disabled={isWorking || !canPickLocalPath}
          >
            <Upload aria-hidden="true" />
            {intl.formatMessage({ id: "socialMedia.import" })}
          </Button>
        </div>
      ) : (
        <ul
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-label={intl.formatMessage({ id: "socialMedia.title" })}
        >
          {assets.map((asset) => {
            const Icon =
              asset.mediaKind === "audio"
                ? FileAudio
                : asset.mediaKind === "image"
                  ? FileImage
                  : FileVideo;
            return (
              <li
                key={asset.mediaId}
                className="min-w-0 rounded-xl border border-card-border bg-card p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-foreground-subtle">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-ui-base font-medium" title={asset.originalName}>
                      {asset.originalName}
                    </h2>
                    <p className="mt-1 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: MEDIA_KIND_MESSAGE_IDS[asset.mediaKind] })}
                      <span aria-hidden="true"> · </span>
                      {formatByteCount(asset.sizeBytes, locale)}
                    </p>
                    <p className="mt-1 text-ui-sm text-foreground-subtle">
                      {dateFormatter.format(asset.importedAt)}
                    </p>
                    {asset.mediaKind !== "image" ? (
                      <SocialMediaClipAnalysis
                        key={asset.mediaId}
                        accountId={account.accountId}
                        asset={asset}
                        service={service}
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
