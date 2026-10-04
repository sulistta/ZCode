import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { normalizeSocialMediaYouTubeVideoUrl } from "@social-harness/shared";
import type { SocialMediaTranscript } from "@social-harness/shared";
import { createSocialAccountFileStore } from "../src/social-account/adapters/socialAccountFileStore.js";
import { createSocialAccountService } from "../src/social-account/app/socialAccountService.js";
import { createSocialMediaFileStore } from "../src/social-media/adapters/socialMediaFileStore.js";
import { buildYtDlpSourceDownloadArgs } from "../src/social-media/adapters/ytDlpSourceDownload.js";
import { SocialMediaJobNotFoundError } from "../src/social-media/app/errors.js";
import { createSocialMediaService } from "../src/social-media/app/socialMediaService.js";
import type {
  SocialMediaSourceUrlDownload,
  SocialMediaSourceDownloadOutput,
} from "../src/social-media/app/ports/socialMediaSourceDownload.js";
import type { SocialMediaTranscriber } from "../src/social-media/app/ports/socialMediaTranscriber.js";
import type { SocialMediaTranscriptionModelManager } from "../src/social-media/app/ports/socialMediaTranscriptionModelManager.js";
import {
  createTestTranscriber,
  createTestTranscriptionModelManager,
} from "./helpers/socialMediaTestDoubles.js";

const VIDEO_ID = "dQw4w9WgXcQ";

function successfulDownloadAdapter(
  subtitleContent: string | null = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOlá\n",
): SocialMediaSourceUrlDownload {
  return {
    start(input) {
      const completion = (async (): Promise<SocialMediaSourceDownloadOutput> => {
        const mediaPath = join(input.workingDirectory, `${input.sourceKey}.mp4`);
        await writeFile(mediaPath, Buffer.from("private test video bytes"), { mode: 0o600 });
        const subtitles: SocialMediaSourceDownloadOutput["subtitles"] = [];
        if (subtitleContent !== null) {
          const subtitlePath = join(input.workingDirectory, `${input.sourceKey}.pt.vtt`);
          const subtitleBytes = Buffer.from(subtitleContent);
          await writeFile(subtitlePath, subtitleBytes, { mode: 0o600 });
          subtitles.push({
            languageCode: "pt",
            automatic: false,
            extension: ".vtt",
            path: subtitlePath,
            sizeBytes: subtitleBytes.byteLength,
            sha256: createHash("sha256").update(subtitleBytes).digest("hex"),
          });
        }
        input.onProgress({ downloadedBytes: 64, totalBytes: 256, etaSeconds: 1 });
        return {
          mediaPath,
          title: "A sample YouTube video",
          channel: "Sample channel",
          durationSeconds: 42,
          viewCount: 123,
          uploadDate: "2025-05-17",
          heatmap: [{ startSeconds: 0, endSeconds: 4, intensity: 0.7 }],
          subtitles,
        };
      })();
      return { completion, async cancel() {} };
    },
  };
}

async function createTestContext(
  root: string,
  sourceUrlDownload: SocialMediaSourceUrlDownload,
  overrides: {
    transcriptionModelManager?: SocialMediaTranscriptionModelManager;
    transcriber?: SocialMediaTranscriber;
  } = {},
) {
  const socialAccountService = createSocialAccountService({
    store: createSocialAccountFileStore({ filePath: join(root, "accounts.json") }),
    now: () => 100,
  });
  const mediaRoot = join(root, "social-media");
  const createMediaService = () =>
    createSocialMediaService({
      store: createSocialMediaFileStore({
        catalogPath: join(mediaRoot, "catalog.json"),
        originalsDir: join(mediaRoot, "originals"),
        jobsDir: join(mediaRoot, "jobs"),
        jobQueueLockPath: join(mediaRoot, "jobs", ".queue"),
      }),
      socialAccountService,
      transcriptionModelManager:
        overrides.transcriptionModelManager ?? createTestTranscriptionModelManager(),
      transcriber: overrides.transcriber ?? createTestTranscriber(),
      youTubeSearch: {
        async search() {
          return [];
        },
      },
      sourceUrlDownload,
      now: () => Date.now(),
    });
  const socialMediaService = createMediaService();
  const createAccount = (displayName: string) =>
    socialAccountService.create({
      displayName,
      editorialProfile: {
        niche: "Podcast",
        audience: "Listeners",
        language: "pt-BR",
        tone: [],
        references: [],
        preferredSources: ["youtube-search"],
        visualStyle: "Subtitles",
        memory: [],
      },
    });
  return { createAccount, createMediaService, mediaRoot, socialAccountService, socialMediaService };
}

async function waitForJobState(
  service: ReturnType<typeof createSocialMediaService>,
  accountId: string,
  jobId: string,
  expected: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = (await service.listJobs(accountId)).find((item) => item.jobId === jobId);
    if (job?.state === expected) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Job ${jobId} did not reach ${expected}`);
}

test("YouTube URL normalization rejects playlists and constructs a canonical URL before spawn", () => {
  const canonical = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
  assert.equal(
    normalizeSocialMediaYouTubeVideoUrl(`https://youtu.be/${VIDEO_ID}?si=share`),
    canonical,
  );
  assert.equal(
    normalizeSocialMediaYouTubeVideoUrl(`https://m.youtube.com/shorts/${VIDEO_ID}`),
    canonical,
  );
  assert.equal(
    normalizeSocialMediaYouTubeVideoUrl(`https://youtube.com/watch?v=${VIDEO_ID}&list=playlist`),
    null,
  );
  assert.equal(
    normalizeSocialMediaYouTubeVideoUrl(`https://youtu.be/${VIDEO_ID}?list=playlist`),
    null,
  );
  assert.equal(normalizeSocialMediaYouTubeVideoUrl(`http://youtube.com/watch?v=${VIDEO_ID}`), null);
  assert.equal(
    normalizeSocialMediaYouTubeVideoUrl(`https://user@youtube.com/watch?v=${VIDEO_ID}`),
    null,
  );
  assert.equal(
    normalizeSocialMediaYouTubeVideoUrl("https://example.com/watch?v=dQw4w9WgXcQ"),
    null,
  );

  const args = buildYtDlpSourceDownloadArgs({
    sourceKey: VIDEO_ID,
    sourceUrl: canonical,
    workingDirectory: "/private/jobs/job-id",
    language: "pt-BR",
    proxyUrl: "http://127.0.0.1:43210",
    ffmpegExecutablePath: "/bundled/tools/ffmpeg/ffmpeg",
  });
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--proxy"));
  assert.ok(args.includes("--"));
  assert.equal(args.at(-1), canonical);
  assert.equal(args[args.indexOf("--format") + 1], "bv*+ba/b");
  assert.equal(args[args.indexOf("--merge-output-format") + 1], "mkv");
  assert.equal(args[args.indexOf("--ffmpeg-location") + 1], "/bundled/tools/ffmpeg/ffmpeg");
  const outputRoot = resolve("/private/jobs/job-id");
  assert.ok(args.includes(join(outputRoot, `${VIDEO_ID}.%(ext)s`)));
  assert.ok(args.includes(`infojson:${join(outputRoot, `${VIDEO_ID}.%(ext)s`)}`));
  assert.equal(
    args.some((arg) => arg.startsWith("video:")),
    false,
  );
});

test("YouTube jobs are idempotent per account and persist media, subtitle, provenance, and heatmap", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-youtube-jobs-"));
  const context = await createTestContext(root, successfulDownloadAdapter());
  try {
    const first = await context.createAccount("First account");
    const second = await context.createAccount("Second account");
    const changes: string[] = [];
    const subscription = context.socialMediaService.onJobChanged((change) =>
      changes.push(change.jobId),
    );
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: first.accountId,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    const duplicate = await context.socialMediaService.downloadSourceUrl({
      accountId: first.accountId,
      url: `https://youtube.com/watch?v=${VIDEO_ID}&t=30`,
    });
    const otherAccountJob = await context.socialMediaService.downloadSourceUrl({
      accountId: second.accountId,
      url: `https://www.youtube.com/shorts/${VIDEO_ID}`,
    });
    assert.equal(duplicate.jobId, job.jobId);
    assert.equal(job.sourceOrigin, "video-url");
    assert.notEqual(otherAccountJob.jobId, job.jobId);

    const completed = await waitForJobState(
      context.socialMediaService,
      first.accountId,
      job.jobId,
      "completed",
    );
    await waitForJobState(
      context.socialMediaService,
      second.accountId,
      otherAccountJob.jobId,
      "completed",
    );
    subscription.dispose();

    const firstAssets = await context.socialMediaService.list(first.accountId);
    const secondAssets = await context.socialMediaService.list(second.accountId);
    assert.equal(firstAssets.length, 1);
    assert.equal(secondAssets.length, 1);
    assert.equal(firstAssets[0]?.sourceKind, "youtube");
    assert.equal(firstAssets[0]?.sourceOrigin, "video-url");
    assert.equal(firstAssets[0]?.sourceVideoId, VIDEO_ID);
    assert.equal(firstAssets[0]?.sourceTitle, "A sample YouTube video");
    assert.equal(firstAssets[0]?.subtitleTracks?.[0]?.languageCode, "pt");
    assert.equal(firstAssets[0]?.transcript?.method, "youtube-subtitles");
    assert.equal(firstAssets[0]?.transcript?.languageCode, "pt");
    assert.deepEqual(firstAssets[0]?.transcript?.segments, [
      { startSeconds: 0, endSeconds: 1, text: "Olá" },
    ]);
    assert.equal(firstAssets[0]?.heatmap?.[0]?.intensity, 0.7);
    assert.equal("path" in (firstAssets[0] ?? {}), false);
    assert.equal(completed.mediaId, firstAssets[0]?.mediaId);
    assert.equal(changes.includes(job.jobId), true);

    const catalog = JSON.parse(await readFile(join(context.mediaRoot, "catalog.json"), "utf8")) as {
      version: number;
      assets: unknown[];
      jobs: unknown[];
    };
    assert.equal(catalog.version, 1);
    assert.equal(catalog.assets.length, 2);
    assert.equal(catalog.jobs.length, 2);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("supported HTTPS source jobs deduplicate by canonical URL and reject unsafe URL forms", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-source-url-jobs-"));
  const context = await createTestContext(root, successfulDownloadAdapter(null));
  try {
    const account = await context.createAccount("Source URL account");
    const sourceUrl = "https://media.example.test/interview.mp4?download=1";
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: sourceUrl,
    });
    const duplicate = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: "https://MEDIA.example.test/interview.mp4?download=1",
    });
    assert.equal(duplicate.jobId, job.jobId);
    assert.equal(job.sourceKind, "remote-url");
    assert.equal(job.sourceKey, `url-${createHash("sha256").update(sourceUrl).digest("hex")}`);
    assert.equal(job.sourceVideoId, undefined);

    await waitForJobState(context.socialMediaService, account.accountId, job.jobId, "completed");
    const [asset] = await context.socialMediaService.list(account.accountId);
    assert.equal(asset?.sourceKind, "remote-url");
    assert.equal(asset?.sourceOrigin, "video-url");
    assert.equal(asset?.sourceUrl, sourceUrl);
    assert.equal(asset?.sourceVideoId, undefined);
    assert.equal(asset?.sourceTitle, "A sample YouTube video");

    for (const invalidUrl of [
      "http://media.example.test/video.mp4",
      "https://user:password@media.example.test/video.mp4",
      "https://media.example.test:8443/video.mp4",
      "https://media.example.test/video.mp4#section",
      "https://media.example.test/video.mp4?access_token=private",
      "https://media.example.test./video.mp4",
    ]) {
      await assert.rejects(
        context.socialMediaService.downloadSourceUrl({
          accountId: account.accountId,
          url: invalidUrl,
        }),
      );
    }
    assert.equal((await context.socialMediaService.listJobs(account.accountId)).length, 1);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid subtitle cues fall back to the selected local transcription model", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-local-transcription-"));
  let transcriptionStarts = 0;
  const transcriber: SocialMediaTranscriber = {
    start(input) {
      transcriptionStarts += 1;
      return createTestTranscriber().start(input);
    },
  };
  const context = await createTestContext(root, successfulDownloadAdapter("not WebVTT"), {
    transcriber,
  });
  try {
    const account = await context.createAccount("Podcast account");
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    const completed = await waitForJobState(
      context.socialMediaService,
      account.accountId,
      job.jobId,
      "completed",
    );
    const [asset] = await context.socialMediaService.list(account.accountId);
    assert.equal(completed.mediaId, asset?.mediaId);
    assert.equal(asset?.transcript?.method, "whisper-local");
    assert.equal(asset?.transcript?.languageCode, "pt-BR");
    assert.equal(transcriptionStarts, 1);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing model keeps the original and retry resumes transcription without redownloading", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-model-unavailable-"));
  const manager = createTestTranscriptionModelManager();
  let modelAvailable = false;
  const transcriptionModelManager: SocialMediaTranscriptionModelManager = {
    ...manager,
    async getInstalledModelPath(modelId) {
      return modelAvailable ? `/private/models/ggml-${modelId}.bin` : null;
    },
  };
  let downloadStarts = 0;
  const download: SocialMediaSourceUrlDownload = {
    start(input) {
      downloadStarts += 1;
      return successfulDownloadAdapter("not WebVTT").start(input);
    },
  };
  const context = await createTestContext(root, download, { transcriptionModelManager });
  try {
    const account = await context.createAccount("Podcast account");
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    const failed = await waitForJobState(
      context.socialMediaService,
      account.accountId,
      job.jobId,
      "failed",
    );
    const [asset] = await context.socialMediaService.list(account.accountId);
    assert.equal(failed.errorCode, "transcription-model-unavailable");
    assert.equal(failed.mediaId, asset?.mediaId);
    assert.equal(asset?.transcript, undefined);
    modelAvailable = true;

    await context.socialMediaService.retryJob({ accountId: account.accountId, jobId: job.jobId });
    const completed = await waitForJobState(
      context.socialMediaService,
      account.accountId,
      job.jobId,
      "completed",
    );
    assert.equal(completed.mediaId, asset?.mediaId);
    assert.equal(
      (await context.socialMediaService.list(account.accountId))[0]?.transcript?.method,
      "whisper-local",
    );
    assert.equal(downloadStarts, 1);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling local transcription preserves the original and explicit retry reuses it", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-cancel-transcription-"));
  let downloadStarts = 0;
  const download: SocialMediaSourceUrlDownload = {
    start(input) {
      downloadStarts += 1;
      return successfulDownloadAdapter("not WebVTT").start(input);
    },
  };
  let rejectFirst: ((error: Error) => void) | null = null;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let transcriptionStarts = 0;
  const fallback = createTestTranscriber();
  const transcriber: SocialMediaTranscriber = {
    start(input) {
      transcriptionStarts += 1;
      if (transcriptionStarts > 1) return fallback.start(input);
      const completion = new Promise<Extract<SocialMediaTranscript, { method: "whisper-local" }>>(
        (_resolve, reject) => {
          rejectFirst = reject;
          signalStarted();
        },
      );
      return {
        completion,
        async cancel() {
          rejectFirst?.(new Error("cancelled"));
          rejectFirst = null;
        },
      };
    },
  };
  const context = await createTestContext(root, download, { transcriber });
  try {
    const account = await context.createAccount("Podcast account");
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    await started;
    await context.socialMediaService.cancelJob({ accountId: account.accountId, jobId: job.jobId });
    const cancelled = await waitForJobState(
      context.socialMediaService,
      account.accountId,
      job.jobId,
      "cancelled",
    );
    const [asset] = await context.socialMediaService.list(account.accountId);
    assert.equal(cancelled.mediaId, asset?.mediaId);
    assert.equal(asset?.transcript, undefined);

    await context.socialMediaService.retryJob({ accountId: account.accountId, jobId: job.jobId });
    await waitForJobState(context.socialMediaService, account.accountId, job.jobId, "completed");
    assert.equal(downloadStarts, 1);
    assert.equal(transcriptionStarts, 2);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("Host shutdown requeues transcription with its mediaId and restart does not redownload", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-recover-transcription-"));
  let downloadStarts = 0;
  const download: SocialMediaSourceUrlDownload = {
    start(input) {
      downloadStarts += 1;
      return successfulDownloadAdapter("not WebVTT").start(input);
    },
  };
  let rejectFirst: ((error: Error) => void) | null = null;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let transcriptionStarts = 0;
  const fallback = createTestTranscriber();
  const transcriber: SocialMediaTranscriber = {
    start(input) {
      transcriptionStarts += 1;
      if (transcriptionStarts > 1) return fallback.start(input);
      const completion = new Promise<Extract<SocialMediaTranscript, { method: "whisper-local" }>>(
        (_resolve, reject) => {
          rejectFirst = reject;
          signalStarted();
        },
      );
      return {
        completion,
        async cancel() {
          rejectFirst?.(new Error("host shutdown"));
          rejectFirst = null;
        },
      };
    },
  };
  const context = await createTestContext(root, download, { transcriber });
  let restarted: ReturnType<typeof context.createMediaService> | null = null;
  try {
    const account = await context.createAccount("Podcast account");
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    await started;
    await context.socialMediaService.disposeAllAndWait();
    const [queued] = await context.socialMediaService.listJobs(account.accountId);
    assert.equal(queued?.state, "queued");
    assert.ok(queued?.mediaId);

    restarted = context.createMediaService();
    const completed = await waitForJobState(restarted, account.accountId, job.jobId, "completed");
    assert.equal(completed.mediaId, queued?.mediaId);
    assert.equal(downloadStarts, 1);
    assert.equal(transcriptionStarts, 2);
  } finally {
    await restarted?.disposeAllAndWait();
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("YouTube jobs can be cancelled, cannot be controlled cross-account, and retry explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-youtube-cancel-"));
  let starts = 0;
  let rejectFirst: ((error: Error) => void) | null = null;
  const adapter: SocialMediaSourceUrlDownload = {
    start(input) {
      starts += 1;
      if (starts > 1) return successfulDownloadAdapter().start(input);
      const resumablePath = join(input.workingDirectory, `${input.sourceKey}.mp4.part`);
      const stagedOutput = Promise.all([
        writeFile(resumablePath, Buffer.from("partial"), { mode: 0o600 }),
        writeFile(join(input.workingDirectory, `${input.sourceKey}.mp4`), Buffer.from("complete"), {
          mode: 0o600,
        }),
        writeFile(join(input.workingDirectory, `${input.sourceKey}.pt.vtt`), "temporary captions", {
          mode: 0o600,
        }),
        writeFile(
          join(input.workingDirectory, `${input.sourceKey}.info.json`),
          "temporary metadata",
          {
            mode: 0o600,
          },
        ),
      ]);
      const completion = new Promise<SocialMediaSourceDownloadOutput>((_resolve, reject) => {
        rejectFirst = reject;
      });
      return {
        completion,
        async cancel() {
          await stagedOutput;
          rejectFirst?.(new Error("cancelled"));
          rejectFirst = null;
        },
      };
    },
  };
  const context = await createTestContext(root, adapter);
  try {
    const owner = await context.createAccount("Owner account");
    const other = await context.createAccount("Other account");
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: owner.accountId,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });
    const deadline = Date.now() + 2_000;
    while (starts === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(starts, 1);

    await assert.rejects(
      context.socialMediaService.cancelJob({ accountId: other.accountId, jobId: job.jobId }),
      SocialMediaJobNotFoundError,
    );
    await context.socialMediaService.cancelJob({ accountId: owner.accountId, jobId: job.jobId });
    const cancelled = await waitForJobState(
      context.socialMediaService,
      owner.accountId,
      job.jobId,
      "cancelled",
    );
    assert.equal(cancelled.accountId, owner.accountId);
    const jobDirectory = join(context.mediaRoot, "jobs", job.jobId);
    assert.equal(await readFile(join(jobDirectory, `${VIDEO_ID}.mp4.part`), "utf8"), "partial");
    await assert.rejects(readFile(join(jobDirectory, `${VIDEO_ID}.mp4`)));
    await assert.rejects(readFile(join(jobDirectory, `${VIDEO_ID}.pt.vtt`)));
    await assert.rejects(readFile(join(jobDirectory, `${VIDEO_ID}.info.json`)));

    const retried = await context.socialMediaService.retryJob({
      accountId: owner.accountId,
      jobId: job.jobId,
    });
    assert.equal(retried.state, "queued");
    await waitForJobState(context.socialMediaService, owner.accountId, job.jobId, "completed");
    assert.equal(starts, 2);
    assert.equal((await context.socialMediaService.listJobs(other.accountId)).length, 0);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("failed YouTube jobs keep resumable fragments and discard completed staging outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-youtube-failed-"));
  let starts = 0;
  const adapter: SocialMediaSourceUrlDownload = {
    start(input) {
      starts += 1;
      if (starts > 1) return successfulDownloadAdapter().start(input);
      const completion = (async (): Promise<SocialMediaSourceDownloadOutput> => {
        await Promise.all([
          writeFile(join(input.workingDirectory, `${input.sourceKey}.mp4.part`), "partial", {
            mode: 0o600,
          }),
          writeFile(join(input.workingDirectory, `${input.sourceKey}.mp4`), "incomplete", {
            mode: 0o600,
          }),
          writeFile(join(input.workingDirectory, `${input.sourceKey}.info.json`), "metadata", {
            mode: 0o600,
          }),
        ]);
        throw new Error("network interrupted after a partial write");
      })();
      return { completion, async cancel() {} };
    },
  };
  const context = await createTestContext(root, adapter);
  try {
    const account = await context.createAccount("Retry account");
    const job = await context.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });
    const failed = await waitForJobState(
      context.socialMediaService,
      account.accountId,
      job.jobId,
      "failed",
    );
    assert.equal(failed.errorCode, "download-failed");
    const jobDirectory = join(context.mediaRoot, "jobs", job.jobId);
    assert.equal(await readFile(join(jobDirectory, `${VIDEO_ID}.mp4.part`), "utf8"), "partial");
    await assert.rejects(readFile(join(jobDirectory, `${VIDEO_ID}.mp4`)));
    await assert.rejects(readFile(join(jobDirectory, `${VIDEO_ID}.info.json`)));

    await context.socialMediaService.retryJob({ accountId: account.accountId, jobId: job.jobId });
    await waitForJobState(context.socialMediaService, account.accountId, job.jobId, "completed");
    assert.equal(starts, 2);
  } finally {
    await context.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("Host restart resumes queued YouTube work from its retained partial file", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-youtube-restart-"));
  let starts = 0;
  let rejectActive: ((error: Error) => void) | null = null;
  const interruptedAdapter: SocialMediaSourceUrlDownload = {
    start(input) {
      starts += 1;
      const partialWrite = writeFile(
        join(input.workingDirectory, `${input.sourceKey}.mp4.part`),
        "resume after Host restart",
        { mode: 0o600 },
      );
      const completion = new Promise<SocialMediaSourceDownloadOutput>((_resolve, reject) => {
        rejectActive = reject;
      });
      return {
        completion,
        async cancel() {
          await partialWrite;
          rejectActive?.(new Error("Host stopped"));
          rejectActive = null;
        },
      };
    },
  };
  const firstHost = await createTestContext(root, interruptedAdapter);
  let restartedHost: Awaited<ReturnType<typeof createTestContext>> | null = null;
  try {
    const account = await firstHost.createAccount("Restart account");
    const job = await firstHost.socialMediaService.downloadSourceUrl({
      accountId: account.accountId,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });
    const deadline = Date.now() + 2_000;
    while (starts === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(starts, 1);

    await firstHost.socialMediaService.disposeAllAndWait();
    const interrupted = (await firstHost.socialMediaService.listJobs(account.accountId)).find(
      (item) => item.jobId === job.jobId,
    );
    assert.equal(interrupted?.state, "queued");

    const resumedAdapter: SocialMediaSourceUrlDownload = {
      start(input) {
        const completion = (async () => {
          assert.equal(
            await readFile(join(input.workingDirectory, `${input.sourceKey}.mp4.part`), "utf8"),
            "resume after Host restart",
          );
          return successfulDownloadAdapter().start(input).completion;
        })();
        return { completion, async cancel() {} };
      },
    };
    restartedHost = await createTestContext(root, resumedAdapter);
    const completed = await waitForJobState(
      restartedHost.socialMediaService,
      account.accountId,
      job.jobId,
      "completed",
    );
    assert.equal(completed.sourceVideoId, VIDEO_ID);
  } finally {
    await firstHost.socialMediaService.disposeAllAndWait();
    if (restartedHost) await restartedHost.socialMediaService.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});
