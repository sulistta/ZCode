import type { SocialMediaJob } from "@social-harness/shared";
import type { SocialMediaStore } from "./ports/socialMediaStore.js";
import type { SocialMediaPreviewProxyRenderer } from "./ports/socialMediaPreviewProxyRenderer.js";
import { SocialMediaPreviewProxyToolUnavailableError } from "./errors.js";

export async function processSocialMediaPreviewProxy(input: {
  job: SocialMediaJob;
  workingDirectory: string;
  store: SocialMediaStore;
  renderer?: SocialMediaPreviewProxyRenderer;
  now(): number;
  observeTask<T>(
    job: SocialMediaJob,
    task: { completion: Promise<T>; cancel(): Promise<void> },
  ): Promise<T>;
  onJobChanged(job: SocialMediaJob): void;
  onMediaChanged(asset: Awaited<ReturnType<SocialMediaStore["finalizeSourceUrlDownload"]>>): void;
}) {
  const { job, store } = input;
  if (!input.renderer) throw new SocialMediaPreviewProxyToolUnavailableError();
  if (!job.mediaId) throw new Error("Preview job has no media");
  const asset = await store.getAsset(job.accountId, job.mediaId);
  if (!asset || asset.mediaKind !== "video") throw new Error("Preview media is unavailable");
  const mediaPath = await store.getManagedOriginalPath(asset);
  let latestProgress: { processedSeconds: number; durationSeconds: number } | null = null;
  let progressWrite = Promise.resolve();
  const task = input.renderer.start({
    mediaPath,
    workingDirectory: input.workingDirectory,
    onProgress(progress) {
      latestProgress = progress;
    },
  });
  const timer = setInterval(() => {
    const progress = latestProgress;
    if (
      !progress ||
      !Number.isFinite(progress.processedSeconds) ||
      !Number.isFinite(progress.durationSeconds) ||
      progress.durationSeconds <= 0
    )
      return;
    latestProgress = null;
    progressWrite = progressWrite.then(async () => {
      const update = await store.updateJob(job.accountId, job.jobId, ["proxying"], {
        processedSeconds: Math.max(
          0,
          Math.min(progress.processedSeconds, progress.durationSeconds),
        ),
        durationSeconds: progress.durationSeconds,
        updatedAt: input.now(),
      });
      if (update?.state === "proxying") input.onJobChanged(update);
    });
  }, 1_000);
  timer.unref?.();
  try {
    const output = await input.observeTask(job, task);
    clearInterval(timer);
    await progressWrite;
    const completed = await store.completePreviewProxy({
      job,
      asset,
      ...output,
      updatedAt: input.now(),
    });
    // 提交拒绝不能留下永远 proxying 的工作；队列统一收口失败，已持久化取消仍优先。
    if (!completed) throw new Error("Preview commit was rejected");
    input.onJobChanged(completed.job);
    input.onMediaChanged(completed.asset);
    await store.cleanupJobWorkingDirectory(job.jobId);
  } finally {
    clearInterval(timer);
    await progressWrite.catch(() => undefined);
  }
}
