import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSocialAccountFileStore } from "../src/social-account/adapters/socialAccountFileStore.js";
import { createSocialAccountService } from "../src/social-account/app/socialAccountService.js";
import { createSocialMediaFileStore } from "../src/social-media/adapters/socialMediaFileStore.js";
import { createSocialMediaService } from "../src/social-media/app/socialMediaService.js";
import type { SocialMediaPreviewProxyRenderer } from "../src/social-media/app/ports/socialMediaPreviewProxyRenderer.js";
import {
  createTestTranscriber,
  createTestTranscriptionModelManager,
} from "./helpers/socialMediaTestDoubles.js";

async function fixture(renderer: SocialMediaPreviewProxyRenderer) {
  const root = await mkdtemp(join(tmpdir(), "sh-proxy-test-"));
  const accountService = createSocialAccountService({
    store: createSocialAccountFileStore({ filePath: join(root, "accounts.json") }),
  });
  const createAccount = () =>
    accountService.create({
      displayName: "Fixture",
      editorialProfile: {
        niche: "Music",
        audience: "Listeners",
        language: "en-US",
        tone: [],
        references: [],
        preferredSources: ["local-file"],
        visualStyle: "Clips",
        memory: [],
      },
    });
  const [account, other] = await Promise.all([createAccount(), createAccount()]);
  const store = createSocialMediaFileStore({
    catalogPath: join(root, "catalog.json"),
    originalsDir: join(root, "originals"),
  });
  const paths: string[] = [];
  const service = createSocialMediaService({
    store,
    socialAccountService: accountService,
    youTubeSearch: {
      async search() {
        return [];
      },
    },
    transcriber: createTestTranscriber(),
    transcriptionModelManager: createTestTranscriptionModelManager(),
    previewProxyRenderer: renderer,
    createPreviewUrl: async (path) => {
      paths.push(path);
      return {
        url: "social-harness-media://local/preview/fixture",
        expiresAt: Date.now() + 1_800_000,
      };
    },
  });
  const sourcePath = join(root, "original.avi");
  await writeFile(sourcePath, "immutable source");
  const asset = await service.importLocalFile({ accountId: account.accountId, sourcePath });
  const request = { accountId: account.accountId, mediaId: asset.mediaId };
  const waitFor = async (jobId: string, state: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const job = await store.getJob(account.accountId, jobId);
      if (job?.state === state) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Job did not reach ${state}`);
  };
  const dispose = async () => {
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  };
  return { root, store, service, asset, request, other, paths, waitFor, dispose, accountService };
}

test("preview admission is on demand, idempotent, isolated and durable; originals remain export inputs", async () => {
  let starts = 0;
  const f = await fixture({
    start(input) {
      starts++;
      return {
        completion: (async () => {
          const outputPath = join(input.workingDirectory, "preview.mp4");
          await writeFile(outputPath, "validated fixture proxy");
          return { outputPath, durationSeconds: 12 };
        })(),
        async cancel() {},
      };
    },
  });
  try {
    assert.equal((await f.service.previewService.prepare(f.request)).representation, "original");
    assert.equal((await f.service.listJobs(f.request.accountId)).length, 0);
    await assert.rejects(
      f.service.previewService.requestProxy({ ...f.request, accountId: f.other.accountId }),
    );
    const jobs = await Promise.all([
      f.service.previewService.requestProxy(f.request),
      f.service.previewService.requestProxy(f.request),
    ]);
    assert.equal(jobs[0]!.jobId, jobs[1]!.jobId);
    await f.waitFor(jobs[0]!.jobId, "completed");
    assert.equal(starts, 1);
    assert.equal((await f.service.listJobs(f.other.accountId)).length, 0);
    const preview = await f.service.previewService.prepare(f.request);
    assert.equal(preview.representation, "proxy");
    assert.equal(preview.mimeType, "video/mp4");
    const stored = await f.store.getAsset(f.request.accountId, f.asset.mediaId);
    assert.equal(stored?.previewProxy?.sourceSha256, f.asset.sha256);
    assert.equal(
      await readFile(await f.store.getManagedOriginalPath(stored!), "utf8"),
      "immutable source",
    );
    assert.equal(await readFile(f.paths.at(-1)!, "utf8"), "validated fixture proxy");
    const second = createSocialMediaFileStore({
      catalogPath: join(f.root, "catalog.json"),
      originalsDir: join(f.root, "originals"),
    });
    assert.equal(
      (await second.getAsset(f.request.accountId, f.asset.mediaId))?.previewProxy?.sha256,
      stored?.previewProxy?.sha256,
    );
    await writeFile(f.paths.at(-1)!, "corrupt");
    await assert.rejects(f.service.previewService.prepare(f.request));
    assert.equal(
      (await f.store.getAsset(f.request.accountId, f.asset.mediaId))?.sha256,
      f.asset.sha256,
    );
  } finally {
    await f.dispose();
  }
});

test("cancel observed by another Host wins over output commit and retry is explicit", async () => {
  let resolveOutput!: (value: { outputPath: string; durationSeconds: number }) => void;
  let outputPath = "";
  const f = await fixture({
    start(input) {
      outputPath = join(input.workingDirectory, "preview.mp4");
      return {
        completion: new Promise((resolve) => {
          resolveOutput = resolve;
        }),
        async cancel() {
          await writeFile(outputPath, "late output");
          resolveOutput({ outputPath, durationSeconds: 12 });
        },
      };
    },
  });
  try {
    const job = await f.service.previewService.requestProxy(f.request);
    await f.waitFor(job.jobId, "proxying");
    const second = createSocialMediaFileStore({
      catalogPath: join(f.root, "catalog.json"),
      originalsDir: join(f.root, "originals"),
    });
    await second.requestCancel(f.request.accountId, job.jobId, Date.now());
    await f.waitFor(job.jobId, "cancelled");
    assert.equal(
      (await f.store.getAsset(f.request.accountId, f.asset.mediaId))?.previewProxy,
      undefined,
    );
    assert.equal((await f.service.previewService.requestProxy(f.request)).state, "cancelled");
    assert.equal((await f.service.previewService.prepare(f.request)).representation, "original");
  } finally {
    await f.dispose();
  }
});

test("failed conversion leaves a safe terminal job and supports explicit retry", async () => {
  let starts = 0;
  const f = await fixture({
    start(input) {
      starts++;
      return {
        completion: (async () => {
          if (starts === 1) throw new Error("sensitive adapter path");
          const outputPath = join(input.workingDirectory, "preview.mp4");
          await writeFile(outputPath, "valid retry");
          return { outputPath, durationSeconds: 12 };
        })(),
        async cancel() {},
      };
    },
  });
  try {
    const job = await f.service.previewService.requestProxy(f.request);
    const failed = await f.waitFor(job.jobId, "failed");
    assert.equal(failed.errorCode, "preview-proxy-failed");
    assert.equal(JSON.stringify(failed).includes("sensitive"), false);
    assert.equal((await f.service.previewService.requestProxy(f.request)).state, "failed");
    assert.equal(starts, 1);
    await f.service.retryJob({ accountId: f.request.accountId, jobId: job.jobId });
    await f.waitFor(job.jobId, "completed");
    assert.equal(starts, 2);
  } finally {
    await f.dispose();
  }
});

test("invalid staging output cannot commit a proxy and is cleaned without deleting originals", async () => {
  const f = await fixture({
    start(input) {
      return {
        completion: (async () => {
          const outside = join(input.workingDirectory, "..", "outside.mp4");
          await writeFile(outside, "outside output");
          const outputPath = join(input.workingDirectory, "preview.mp4");
          await symlink(outside, outputPath);
          return { outputPath, durationSeconds: 12 };
        })(),
        async cancel() {},
      };
    },
  });
  try {
    const job = await f.service.previewService.requestProxy(f.request);
    await f.waitFor(job.jobId, "failed");
    assert.equal(
      (await f.store.getAsset(f.request.accountId, f.asset.mediaId))?.previewProxy,
      undefined,
    );
    assert.equal(
      await readFile(await f.store.getManagedOriginalPath(f.asset), "utf8"),
      "immutable source",
    );
    await assert.rejects(readdir(join(f.root, "jobs", job.jobId)), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("Host shutdown requeues conversion, restart removes staging and reuses one durable job", async () => {
  let starts = 0;
  const renderer: SocialMediaPreviewProxyRenderer = {
    start(input) {
      starts++;
      if (starts === 1) {
        let reject!: (error: Error) => void;
        return {
          completion: new Promise((_, fail) => {
            reject = fail;
          }),
          async cancel() {
            reject(new Error("interrupted"));
          },
        };
      }
      return {
        completion: (async () => {
          const outputPath = join(input.workingDirectory, "preview.mp4");
          await writeFile(outputPath, "recovered proxy");
          return { outputPath, durationSeconds: 12 };
        })(),
        async cancel() {},
      };
    },
  };
  const f = await fixture(renderer);
  try {
    const job = await f.service.previewService.requestProxy(f.request);
    await f.waitFor(job.jobId, "proxying");
    await f.service.disposeAllAndWait();
    assert.equal((await f.store.getJob(f.request.accountId, job.jobId))?.state, "queued");
    const service = createSocialMediaService({
      store: f.store,
      socialAccountService: f.accountService,
      youTubeSearch: {
        async search() {
          return [];
        },
      },
      transcriber: createTestTranscriber(),
      transcriptionModelManager: createTestTranscriptionModelManager(),
      previewProxyRenderer: renderer,
    });
    try {
      await f.waitFor(job.jobId, "completed");
      assert.equal(starts, 2);
      assert.equal((await f.store.listJobs(f.request.accountId)).length, 1);
      assert.equal(
        await readFile(await f.store.getManagedOriginalPath(f.asset), "utf8"),
        "immutable source",
      );
    } finally {
      await service.disposeAllAndWait();
    }
  } finally {
    await f.dispose();
  }
});

test("two Host queues share one admission and conversion; nonvideos cannot mutate job state", async () => {
  let starts = 0;
  const renderer: SocialMediaPreviewProxyRenderer = {
    start(input) {
      starts++;
      return {
        completion: (async () => {
          const outputPath = join(input.workingDirectory, "preview.mp4");
          await writeFile(outputPath, "single shared conversion");
          return { outputPath, durationSeconds: 12 };
        })(),
        async cancel() {},
      };
    },
  };
  const f = await fixture(renderer);
  const secondStore = createSocialMediaFileStore({
    catalogPath: join(f.root, "catalog.json"),
    originalsDir: join(f.root, "originals"),
  });
  const secondHost = createSocialMediaService({
    store: secondStore,
    socialAccountService: f.accountService,
    youTubeSearch: {
      async search() {
        return [];
      },
    },
    transcriber: createTestTranscriber(),
    transcriptionModelManager: createTestTranscriptionModelManager(),
    previewProxyRenderer: renderer,
  });
  try {
    const imagePath = join(f.root, "still.png");
    await writeFile(imagePath, "fixture image");
    const image = await f.service.importLocalFile({
      accountId: f.request.accountId,
      sourcePath: imagePath,
    });
    await assert.rejects(
      f.service.previewService.requestProxy({ ...f.request, mediaId: image.mediaId }),
    );
    assert.equal((await secondStore.listJobs(f.request.accountId)).length, 0);
    const admitted = await Promise.all([
      f.service.previewService.requestProxy(f.request),
      secondHost.previewService.requestProxy(f.request),
    ]);
    assert.equal(admitted[0]!.jobId, admitted[1]!.jobId);
    await f.waitFor(admitted[0]!.jobId, "completed");
    assert.equal(starts, 1);
    assert.equal((await secondStore.listJobs(f.request.accountId)).length, 1);
  } finally {
    await secondHost.disposeAllAndWait();
    await f.dispose();
  }
});

test(
  "shutdown between source lookup and task registration cancels the late process and requeues",
  { timeout: 5_000 },
  async () => {
    let cancelled = false;
    let lookedUp!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      lookedUp = resolve;
    });
    let release!: () => void;
    const lookupGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture({
      start() {
        let reject!: (error: Error) => void;
        return {
          completion: new Promise((_, fail) => {
            reject = fail;
          }),
          async cancel() {
            cancelled = true;
            reject(new Error("cancelled fixture"));
          },
        };
      },
    });
    const originalLookup = f.store.getManagedOriginalPath;
    f.store.getManagedOriginalPath = async (asset) => {
      lookedUp();
      await lookupGate;
      return originalLookup(asset);
    };
    try {
      const job = await f.service.previewService.requestProxy(f.request);
      await lookupStarted;
      const shutdown = f.service.disposeAllAndWait();
      release();
      await shutdown;
      assert.equal(cancelled, true);
      assert.equal((await f.store.getJob(f.request.accountId, job.jobId))?.state, "queued");
      assert.equal(
        (await f.store.getAsset(f.request.accountId, job.mediaId!))?.previewProxy,
        undefined,
      );
    } finally {
      release();
      await f.dispose();
    }
  },
);

test("rejected commit settles the job as failed instead of leaving it proxying", async () => {
  const f = await fixture({
    start(input) {
      return {
        completion: (async () => {
          const outputPath = join(input.workingDirectory, "preview.mp4");
          await writeFile(outputPath, "stale output");
          return { outputPath, durationSeconds: 12 };
        })(),
        async cancel() {},
      };
    },
  });
  try {
    f.store.completePreviewProxy = async () => null;
    const job = await f.service.previewService.requestProxy(f.request);
    const failed = await f.waitFor(job.jobId, "failed");
    assert.equal(failed.errorCode, "preview-proxy-failed");
    assert.equal(
      (await f.store.getAsset(f.request.accountId, f.asset.mediaId))?.previewProxy,
      undefined,
    );
    await assert.rejects(readdir(join(f.root, "jobs", job.jobId)), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});
