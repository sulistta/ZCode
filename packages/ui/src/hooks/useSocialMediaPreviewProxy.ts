import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SocialMediaJob,
  SocialMediaPreviewService,
  SocialMediaService,
} from "@social-harness/services";

/** Decoder observations are local; accepted conversion state always comes from the Host catalog. */
export function useSocialMediaPreviewProxy(input: {
  accountId: string;
  previewService?: SocialMediaPreviewService;
  mediaService?: SocialMediaService;
  onCompleted(mediaId: string): void;
}) {
  const { accountId, previewService, mediaService, onCompleted } = input;
  const [jobs, setJobs] = useState<SocialMediaJob[]>([]);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const observed = useRef(new Set<string>());
  const completed = useRef(new Set<string>());
  const generation = useRef(0);
  const completionCallback = useRef(onCompleted);
  completionCallback.current = onCompleted;

  const accept = useCallback((job: SocialMediaJob) => {
    setJobs((current) => {
      const previous = current.find((record) => record.jobId === job.jobId);
      if (
        previous?.updatedAt === job.updatedAt &&
        previous.state === job.state &&
        previous.processedSeconds === job.processedSeconds &&
        previous.durationSeconds === job.durationSeconds &&
        previous.downloadedBytes === job.downloadedBytes
      )
        return current;
      return [...current.filter((record) => record.jobId !== job.jobId), job];
    });
    if (job.state === "completed" && job.mediaId && !completed.current.has(job.jobId)) {
      completed.current.add(job.jobId);
      completionCallback.current(job.mediaId);
    }
  }, []);

  const load = useCallback(async () => {
    if (!mediaService) return;
    const currentGeneration = generation.current;
    const snapshot = await mediaService.listJobs(accountId);
    if (generation.current !== currentGeneration) return;
    for (const job of snapshot) {
      if (job.sourceKind === "preview-proxy" && job.mediaId && observed.current.has(job.mediaId))
        accept(job);
    }
  }, [accountId, accept, mediaService]);

  useEffect(() => {
    generation.current++;
    observed.current.clear();
    completed.current.clear();
    setJobs([]);
    setBusyJobId(null);
    const subscription = mediaService?.onJobChanged((change) => {
      if (change.accountId === accountId && observed.current.size)
        void load().catch(() => undefined);
    });
    // 其他窗口的 Host 不共享 emitter；快照只更新本地投影，不重新提交转换工作。
    const timer = setInterval(() => {
      if (observed.current.size) void load().catch(() => undefined);
    }, 2_000);
    return () => {
      generation.current++;
      subscription?.dispose();
      clearInterval(timer);
    };
  }, [accountId, load, mediaService, previewService]);

  const observeDecoderFailure = useCallback(
    (mediaId: string) => {
      if (!previewService || !mediaService || observed.current.has(mediaId)) return;
      observed.current.add(mediaId);
      const currentGeneration = generation.current;
      void previewService
        .requestProxy({ accountId, mediaId })
        .then((job) => {
          if (generation.current === currentGeneration) accept(job);
        })
        .catch(() => {
          // Admission failed before a durable job existed; explicit preview Retry may try admission again.
          if (generation.current === currentGeneration) observed.current.delete(mediaId);
        });
    },
    [accountId, accept, mediaService, previewService],
  );

  const changeJob = useCallback(
    async (jobId: string, action: "cancel" | "retry") => {
      if (!mediaService || busyJobId) return;
      const currentGeneration = generation.current;
      setBusyJobId(jobId);
      try {
        const job = await mediaService[action === "cancel" ? "cancelJob" : "retryJob"]({
          accountId,
          jobId,
        });
        if (generation.current === currentGeneration) accept(job);
      } finally {
        if (generation.current === currentGeneration) setBusyJobId(null);
      }
    },
    [accountId, accept, busyJobId, mediaService],
  );

  return { jobs, busyJobId, observeDecoderFailure, changeJob };
}
