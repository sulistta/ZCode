import type {
  SocialMediaJobQueue,
  SocialMediaJobQueueOptions,
} from "./ports/socialMediaJobQueue.js";
export type { SocialMediaJobQueue } from "./ports/socialMediaJobQueue.js";
import {
  socialMediaAssetSchema,
  socialMediaTranscriptSchema,
  type SocialMediaJob,
} from "@social-harness/shared";
import type {
  SocialMediaSourceDownloadProgress,
  SocialMediaSourceDownloadTask,
} from "./ports/socialMediaSourceDownload.js";
import {
  SocialMediaTranscriptionFailedError,
  SocialMediaTranscriptionModelUnavailableError,
  SocialMediaTranscriptionOutputError,
  SocialMediaSourceDownloadOutputError,
} from "./errors.js";
import { errorCodeFor, toProgressUpdate } from "./socialMediaJobErrors.js";
import { selectYouTubeSubtitleTranscript } from "../domain/webVttTranscript.js";

import { processSocialMediaPreviewProxy } from "./socialMediaPreviewProxyJob.js";
import { SocialMediaPreviewProxyToolUnavailableError } from "./errors.js";

interface ActiveTask {
  job: SocialMediaJob;
  cancel(): Promise<void>;
}

interface CancellableTask<T> {
  completion: Promise<T>;
  cancel(): Promise<void>;
}

const PROGRESS_PERSIST_INTERVAL_MS = 1_000;
const CANCEL_POLL_INTERVAL_MS = 500;
const QUEUE_RETRY_INTERVAL_MS = 1_500;

export function createSocialMediaJobQueue(
  options: SocialMediaJobQueueOptions,
): SocialMediaJobQueue {
  let disposed = false;
  let queueRunner: Promise<void> | null = null;
  let queueRequested = false;
  let queueRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTask: ActiveTask | null = null;

  function sourceKeyOf(job: SocialMediaJob): string {
    const sourceKey = job.sourceKey ?? job.sourceVideoId;
    if (!sourceKey) throw new Error("A media download job has no stable source key");
    return sourceKey;
  }

  function emitJob(job: SocialMediaJob): void {
    options.onJobChanged(job);
  }

  async function observeTask<T>(job: SocialMediaJob, task: CancellableTask<T>): Promise<T> {
    activeTask = { job, cancel: () => task.cancel() };
    let cancelCheckRunning = false;
    const cancelTimer = setInterval(() => {
      if (cancelCheckRunning) return;
      cancelCheckRunning = true;
      void options.store
        .getJob(job.accountId, job.jobId)
        .then((latest) => (latest?.state === "cancelling" ? task.cancel() : undefined))
        .catch(() => undefined)
        .finally(() => {
          cancelCheckRunning = false;
        });
    }, CANCEL_POLL_INTERVAL_MS);
    cancelTimer.unref?.();
    try {
      // 关闭可能发生在解析文件期间、activeTask 注册之前；不能只依赖 dispose 当时的句柄快照。
      const stopOnShutdown = async () => {
        if (!disposed) return;
        await options.store.requestCancel(job.accountId, job.jobId, options.now());
        await task.cancel();
      };
      const [result] = await Promise.all([task.completion, stopOnShutdown()]);
      return result;
    } finally {
      clearInterval(cancelTimer);
      if (activeTask?.job.jobId === job.jobId) activeTask = null;
    }
  }

  async function finishCancelledJob(job: SocialMediaJob): Promise<void> {
    const latest = await options.store.getJob(job.accountId, job.jobId);
    if (
      !latest ||
      !["cancelling", "downloading", "finalizing", "transcribing", "proxying"].includes(
        latest.state,
      )
    )
      return;
    if (latest.mediaId) await options.store.cleanupJobWorkingDirectory(job.jobId);
    else await options.store.discardNonResumableJobOutput(job.jobId, sourceKeyOf(job));
    const updated = await options.store.updateJob(
      job.accountId,
      job.jobId,
      ["cancelling", "downloading", "finalizing", "transcribing", "proxying"],
      {
        state: disposed ? "queued" : "cancelled",
        errorCode: null,
        updatedAt: Math.max(0, Math.trunc(options.now())),
      },
    );
    if (updated) emitJob(updated);
  }

  async function downloadAsset(
    job: SocialMediaJob,
    language: string,
    workingDirectory: string,
  ): Promise<void> {
    if (!job.sourceUrl || job.sourceKind === "preview-proxy")
      throw new SocialMediaSourceDownloadOutputError();
    const sourceUrl = job.sourceUrl;
    let latestProgress: SocialMediaSourceDownloadProgress | null = null;
    let progressWrite = Promise.resolve();
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let task: SocialMediaSourceDownloadTask | null = null;
    try {
      task = options.sourceUrlDownload.start({
        sourceKey: sourceKeyOf(job),
        sourceUrl,
        workingDirectory,
        language,
        onProgress(progress) {
          latestProgress = progress;
        },
      });
      progressTimer = setInterval(() => {
        const progress = latestProgress;
        if (!progress) return;
        latestProgress = null;
        progressWrite = progressWrite.then(async () => {
          const update = await options.store.updateJob(job.accountId, job.jobId, ["downloading"], {
            ...toProgressUpdate(progress),
            updatedAt: Math.max(0, Math.trunc(options.now())),
          });
          if (update?.state === "downloading") emitJob(update);
        });
      }, PROGRESS_PERSIST_INTERVAL_MS);
      progressTimer.unref?.();
      const output = await observeTask(job, task);
      if (progressTimer) clearInterval(progressTimer);
      await progressWrite;
      const latestJob = await options.store.getJob(job.accountId, job.jobId);
      if (latestJob?.state === "cancelling") {
        await finishCancelledJob(job);
        return;
      }
      const finalizing = await options.store.updateJob(job.accountId, job.jobId, ["downloading"], {
        ...(latestProgress ? toProgressUpdate(latestProgress) : {}),
        state: "finalizing",
        updatedAt: Math.max(0, Math.trunc(options.now())),
      });
      if (finalizing?.state !== "finalizing") {
        if (finalizing?.state === "cancelling") await finishCancelledJob(job);
        return;
      }
      emitJob(finalizing);
      const asset = socialMediaAssetSchema.parse(
        await options.store.finalizeSourceUrlDownload({
          job: finalizing,
          mediaPath: output.mediaPath,
          title: output.title,
          channel: output.channel,
          durationSeconds: output.durationSeconds,
          viewCount: output.viewCount,
          uploadDate: output.uploadDate,
          heatmap: output.heatmap,
          subtitles: output.subtitles,
          importedAt: Math.max(0, Math.trunc(options.now())),
        }),
      );
      const transcribing = await options.store.getJob(job.accountId, job.jobId);
      if (transcribing) emitJob(transcribing);
      options.onMediaImported(asset);
      if (transcribing?.state === "cancelling") await finishCancelledJob(job);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      await progressWrite.catch(() => undefined);
    }
  }

  async function transcribeAsset(
    job: SocialMediaJob,
    languageCode: string,
    workingDirectory: string,
  ): Promise<void> {
    if (!job.mediaId) throw new SocialMediaTranscriptionFailedError();
    const asset = await options.store.getAsset(job.accountId, job.mediaId);
    if (!asset) throw new SocialMediaTranscriptionFailedError();
    let transcript = selectYouTubeSubtitleTranscript({
      subtitles: await options.store.readValidSubtitleContents(asset),
      accountLanguage: languageCode,
      createdAt: Math.max(0, Math.trunc(options.now())),
    });

    if (!transcript) {
      const setup = await options.transcriptionModelManager.getSetup();
      const modelId = setup.selectedModelId;
      const modelPath = await options.transcriptionModelManager.getInstalledModelPath(modelId);
      if (!modelPath) throw new SocialMediaTranscriptionModelUnavailableError();
      const latest = await options.store.getJob(job.accountId, job.jobId);
      if (disposed || latest?.state === "cancelling") {
        await finishCancelledJob(job);
        return;
      }
      const mediaPath = await options.store.getManagedOriginalPath(asset);
      const task = options.transcriber.start({
        mediaPath,
        workingDirectory,
        modelPath,
        modelId,
        languageCode,
        createdAt: Math.max(0, Math.trunc(options.now())),
      });
      transcript = await observeTask(job, task);
      if (transcript.method !== "whisper-local" || transcript.modelId !== modelId) {
        throw new SocialMediaTranscriptionOutputError();
      }
    }

    const validated = socialMediaTranscriptSchema.safeParse(transcript);
    if (!validated.success) throw new SocialMediaTranscriptionOutputError();
    const completed = await options.store.completeTranscription({
      accountId: job.accountId,
      jobId: job.jobId,
      mediaId: job.mediaId,
      transcript: validated.data,
      updatedAt: Math.max(0, Math.trunc(options.now())),
    });
    if (!completed) {
      const latest = await options.store.getJob(job.accountId, job.jobId);
      if (disposed || latest?.state === "cancelling") await finishCancelledJob(job);
      return;
    }
    emitJob(completed.job);
    options.onMediaImported(completed.asset);
  }

  async function processJob(job: SocialMediaJob): Promise<void> {
    try {
      const workingDirectory = await options.store.createJobWorkingDirectory(job.jobId);
      const account = await options.socialAccountService.get(job.accountId);
      if (!account) throw new Error("Social account disappeared while a media job was queued");
      if (job.sourceKind === "preview-proxy") {
        await processSocialMediaPreviewProxy({
          job,
          workingDirectory,
          store: options.store,
          renderer: options.previewProxyRenderer,
          now: options.now,
          observeTask,
          onJobChanged: emitJob,
          onMediaChanged: options.onMediaImported,
        });
        const latest = await options.store.getJob(job.accountId, job.jobId);
        if (latest?.state === "cancelling") await finishCancelledJob(job);
        return;
      }
      if (!job.mediaId)
        await downloadAsset(job, account.editorialProfile.language, workingDirectory);
      const latest = await options.store.getJob(job.accountId, job.jobId);
      if (latest?.state === "transcribing") {
        await transcribeAsset(latest, account.editorialProfile.language, workingDirectory);
        const completed = await options.store.getJob(job.accountId, job.jobId);
        if (completed?.state === "completed") {
          await options.store.cleanupJobWorkingDirectory(job.jobId);
        }
      } else if (latest?.state === "cancelling") {
        await finishCancelledJob(job);
      }
    } catch (error) {
      const latest = await options.store.getJob(job.accountId, job.jobId).catch(() => null);
      if (disposed || latest?.state === "cancelling") {
        await finishCancelledJob(job);
        return;
      }
      if (
        !latest ||
        !["downloading", "finalizing", "transcribing", "proxying"].includes(latest.state)
      )
        return;
      if (latest.mediaId) await options.store.cleanupJobWorkingDirectory(job.jobId);
      else await options.store.discardNonResumableJobOutput(job.jobId, sourceKeyOf(job));
      const failed = await options.store.updateJob(
        job.accountId,
        job.jobId,
        ["downloading", "finalizing", "transcribing", "proxying"],
        {
          state: "failed",
          errorCode:
            job.sourceKind === "preview-proxy"
              ? error instanceof SocialMediaPreviewProxyToolUnavailableError
                ? "preview-proxy-tool-unavailable"
                : "preview-proxy-failed"
              : errorCodeFor(error, Boolean(latest.mediaId)),
          updatedAt: Math.max(0, Math.trunc(options.now())),
        },
      );
      if (failed) emitJob(failed);
    }
  }

  async function runQueueWhileOwner(): Promise<void> {
    if (disposed) return;
    const recovered = await options.store.recoverInterruptedJobs(
      Math.max(0, Math.trunc(options.now())),
    );
    for (const job of recovered) emitJob(job);
    while (!disposed) {
      const job = await options.store.claimNextQueuedJob(Math.max(0, Math.trunc(options.now())));
      if (!job) return;
      emitJob(job);
      await processJob(job);
    }
  }

  function scheduleQueueRetry(): void {
    if (disposed || queueRetryTimer) return;
    queueRetryTimer = setTimeout(() => {
      queueRetryTimer = null;
      requestQueueRun();
    }, QUEUE_RETRY_INTERVAL_MS);
    queueRetryTimer.unref?.();
  }

  function requestQueueRun(): void {
    queueRequested = true;
    if (disposed || queueRunner) return;
    queueRunner = (async () => {
      do {
        queueRequested = false;
        try {
          await options.store.withJobQueueLock(runQueueWhileOwner);
        } catch {
          scheduleQueueRetry();
          return;
        }
      } while (queueRequested && !disposed);
    })()
      .catch(() => scheduleQueueRetry())
      .finally(() => {
        queueRunner = null;
        if (queueRequested && !disposed) requestQueueRun();
      });
  }

  return {
    requestQueueRun,
    async cancelActiveJob(job) {
      if (job.state === "cancelling" && activeTask?.job.jobId === job.jobId) {
        await activeTask.cancel().catch(() => undefined);
      }
    },
    disposeAll() {
      void this.disposeAllAndWait();
    },
    async disposeAllAndWait() {
      if (disposed) {
        await queueRunner;
        return;
      }
      disposed = true;
      if (queueRetryTimer) clearTimeout(queueRetryTimer);
      queueRetryTimer = null;
      if (activeTask) {
        // 先持久化取消再终止进程，避免关闭窗口时已完成的子进程继续提交预览输出。
        await options.store.requestCancel(
          activeTask.job.accountId,
          activeTask.job.jobId,
          options.now(),
        );
        await activeTask.cancel().catch(() => undefined);
      }
      await queueRunner;
    },
  };
}
