import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  InstagramConnection,
  InstagramPublication,
  SocialAutomationPolicy,
  SocialMediaAsset,
} from "@social-harness/shared";
import { createInstagramPublicationWorkflow } from "../src/social-publishing/app/instagramPublicationWorkflow.js";
import type { InstagramPublicationStore } from "../src/social-publishing/app/ports/instagramPublicationStore.js";
import { InstagramReelRemoteError } from "../src/social-publishing/app/ports/instagramReelPublisher.js";
import { SocialPublishingError } from "../src/social-publishing/app/socialPublishingError.js";

const accountId = "account-one";
const requestId = "request-key-000001";
const permalink = "https://www.instagram.com/reel/AbCdEf123/";
const connected: InstagramConnection = {
  accountId,
  status: "connected",
  profile: { instagramUserId: "ig-user-42", username: "channel", profilePictureUrl: null },
  connectedAt: 1,
};

function createHarness(options?: {
  uploadError?: Error;
  projectRevision?: number;
  exportRevision?: number;
  projectSettings?: {
    width: number;
    height: number;
    frameRate: { numerator: number; denominator: number };
  };
  createContainer?: () => Promise<{ containerId: string }>;
  publish?: () => Promise<{ mediaId: string }>;
  containerStatuses?: string[];
  media?: { mediaId: string; permalink: string | null }[];
  initialPublications?: InstagramPublication[];
  automationPolicy?: SocialAutomationPolicy;
  mediaAssets?: SocialMediaAsset[];
}) {
  const publications = new Map(
    (options?.initialPublications ?? []).map((publication) => [
      publication.publicationId,
      publication,
    ]),
  );
  const uploads: { accountId: string; idempotencyKey: string; sha256: string; size: number }[] = [];
  const deletions: string[] = [];
  const calls: string[] = [];
  let publicationId = 1;
  let statusIndex = 0;
  let currentProjectRevision = options?.projectRevision ?? 5;
  const store: InstagramPublicationStore = {
    get: async (owner, id) => (owner === accountId ? (publications.get(id) ?? null) : null),
    list: async (owner) =>
      owner === accountId
        ? [...publications.values()].filter((item) => item.accountId === owner)
        : [],
    listAll: async () => [...publications.values()],
    createIfAbsent: async (publication) => {
      const existing = [...publications.values()].find(
        (item) =>
          item.accountId === publication.accountId && item.requestId === publication.requestId,
      );
      if (existing) return { publication: existing, created: false };
      publications.set(publication.publicationId, publication);
      return { publication, created: true };
    },
    update: async (owner, id, transform) => {
      const current = publications.get(id);
      if (!current || current.accountId !== owner) return null;
      const next = transform(current);
      publications.set(id, next);
      return next;
    },
    withRunnerLock: async (_owner, operation) => {
      await operation();
      return true;
    },
  };
  const workflow = createInstagramPublicationWorkflow({
    now: () => 10_000,
    createPublicationId: () =>
      `00000000-0000-4000-8000-${String(publicationId++).padStart(12, "0")}`,
    store,
    projectService: {
      getExport: async () => ({
        exportId: "export-one",
        requestId: "export-request-one",
        accountId,
        projectId: "project-one",
        projectRevision: options?.exportRevision ?? 5,
        status: "completed",
        progressPercent: 100,
        createdAt: 2,
        updatedAt: 3,
        durationMs: 5_000,
        fileSizeBytes: 5,
        sha256: "a".repeat(64),
      }),
      get: async () => ({
        project: {
          revision: currentProjectRevision,
          settings: options?.projectSettings ?? {
            width: 1080,
            height: 1920,
            frameRate: { numerator: 30, denominator: 1 },
          },
          tracks: [{ clips: [{ kind: "video", mediaId: "source-one" }] }],
        },
      }),
    } as never,
    artifactReader: { open: async () => new Blob(["video"], { type: "video/mp4" }) },
    credentialStore: {
      load: async () => ({ accessToken: "secret-token", mediaUploadCredential: "bridge-key" }),
      store: async () => undefined,
      delete: async () => undefined,
    },
    getAccount: async () =>
      ({
        accountId,
        automationPolicy: options?.automationPolicy ?? { autonomyEnabled: false },
      }) as never,
    listMedia: async () =>
      options?.mediaAssets ??
      ([
        {
          mediaId: "source-one",
          accountId,
          sourceKind: "local-file",
        },
      ] as unknown as SocialMediaAsset[]),
    authBridge: {
      createAuthorization: async () => "",
      redeemHandoff: async () => ({ accessToken: "secret-token" }),
      uploadTemporaryMedia: async (input) => {
        if (options?.uploadError) throw options.uploadError;
        uploads.push({
          accountId: input.accountId,
          idempotencyKey: input.idempotencyKey,
          sha256: input.sha256,
          size: input.file.size,
        });
        return {
          leaseId: "abcdefghijklmnopqrstuv",
          mediaUrl: "https://bridge.example/m/opaque",
          expiresAt: 20_000,
        };
      },
      deleteTemporaryMedia: async ({ leaseId }) => {
        deletions.push(leaseId);
      },
    },
    mediaReader: {
      list: async () =>
        (options?.media ?? [{ mediaId: "media-77", permalink }]).map((item) => ({
          mediaId: item.mediaId,
          mediaType: "REELS",
          caption: null,
          permalink: item.permalink,
          timestamp: null,
        })),
    },
    publisher: {
      createReelContainer: async () => {
        calls.push("create");
        return options?.createContainer?.() ?? { containerId: "container-1" };
      },
      getContainerStatus: async () => {
        calls.push("status");
        const sequence = options?.containerStatuses ?? ["FINISHED"];
        const statusCode = sequence[Math.min(statusIndex, sequence.length - 1)] ?? "FINISHED";
        statusIndex += 1;
        return { statusCode };
      },
      publishReel: async () => {
        calls.push("publish");
        return options?.publish?.() ?? { mediaId: "media-77" };
      },
    },
    requireAccount: async () => undefined,
    getConnection: async () => connected,
    currentGeneration: () => 0,
    withAccountLock: async (_id, action) => action(),
    onChanged: () => undefined,
    wait: async () => undefined,
    pollIntervalMs: 0,
    maxPollAttempts: 2,
  });
  return {
    workflow,
    publications,
    uploads,
    deletions,
    calls,
    setProjectRevision(value: number) {
      currentProjectRevision = value;
    },
  };
}

async function waitForTerminal(
  harness: ReturnType<typeof createHarness>,
): Promise<InstagramPublication> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const publication = [...harness.publications.values()][0];
    if (
      publication &&
      ["published", "failed", "reconciliation-required"].includes(publication.status)
    ) {
      return publication;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Publication did not reach a terminal or reconciliation state");
}

test("approved Reel binds export hash and publishes only after Meta reports FINISHED", async () => {
  const harness = createHarness({ containerStatuses: ["IN_PROGRESS", "FINISHED"] });
  const initial = await harness.workflow.approveAndPublishInstagramReel({
    accountId,
    exportId: "export-one",
    caption: "Approved caption",
    requestId,
  });
  const completed = await waitForTerminal(harness);

  assert.equal(initial.status, "preparing-media");
  assert.equal(completed.status, "published");
  assert.equal(completed.projectRevision, 5);
  assert.equal(completed.exportSha256, "a".repeat(64));
  assert.equal(completed.permalink, permalink);
  assert.deepEqual(harness.calls, ["create", "status", "status", "publish"]);
  assert.deepEqual(harness.uploads, [
    {
      accountId,
      idempotencyKey: completed.publicationId,
      sha256: "a".repeat(64),
      size: 5,
    },
  ]);
  assert.deepEqual(harness.deletions, ["abcdefghijklmnopqrstuv"]);
  harness.setProjectRevision(6);
  const replay = await harness.workflow.approveAndPublishInstagramReel({
    accountId,
    exportId: "export-one",
    caption: "Approved caption",
    requestId,
  });
  assert.equal(replay.publicationId, completed.publicationId);
  assert.equal(harness.calls.filter((call) => call === "create").length, 1);
});

test("capacity exhaustion remains distinct from transport failure and never reaches Meta publication", async () => {
  for (const [error, expected] of [
    [new SocialPublishingError("capacity-unavailable", "quota"), "capacity-unavailable"],
    [new Error("upload timeout"), "media-upload-failed"],
  ] as const) {
    const harness = createHarness({ uploadError: error });
    await harness.workflow.approveAndPublishInstagramReel({
      accountId,
      exportId: "export-one",
      caption: "Approved",
      requestId,
    });
    const completed = await waitForTerminal(harness);
    assert.equal(completed.status, "failed");
    assert.equal(completed.errorCode, expected);
    assert.deepEqual(harness.calls, []);
  }
});

test("stale project revisions are rejected before an approval is persisted", async () => {
  const harness = createHarness({ projectRevision: 6, exportRevision: 5 });
  await assert.rejects(
    harness.workflow.approveAndPublishInstagramReel({
      accountId,
      exportId: "export-one",
      caption: "Approved caption",
      requestId,
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "publication-project-changed",
  );
  assert.equal(harness.publications.size, 0);
  assert.equal(harness.uploads.length, 0);
});

test("Instagram publication rejects unsupported dimensions and frame rates before side effects", async () => {
  for (const projectSettings of [
    { width: 2048, height: 1080, frameRate: { numerator: 30, denominator: 1 } },
    { width: 1080, height: 1920, frameRate: { numerator: 120, denominator: 1 } },
    { width: 1080, height: 1920, frameRate: { numerator: 24, denominator: 1_000 } },
  ]) {
    const harness = createHarness({ projectSettings });
    await assert.rejects(
      harness.workflow.approveAndPublishInstagramReel({
        accountId,
        exportId: "export-one",
        caption: "Approved caption",
        requestId,
      }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "publication-video-unsupported",
    );
    assert.equal(harness.publications.size, 0);
    assert.equal(harness.uploads.length, 0);
    assert.deepEqual(harness.calls, []);
  }
});

test("unknown container creation is reconciled without repeating Meta POST", async () => {
  const harness = createHarness({
    createContainer: async () => {
      throw new InstagramReelRemoteError("unknown");
    },
  });
  await harness.workflow.approveAndPublishInstagramReel({
    accountId,
    exportId: "export-one",
    caption: "Approved caption",
    requestId,
  });
  const publication = await waitForTerminal(harness);
  assert.equal(publication.status, "reconciliation-required");
  assert.equal(publication.reconciliationReason, "container-create-outcome-unknown");
  await harness.workflow.approveAndPublishInstagramReel({
    accountId,
    exportId: "export-one",
    caption: "Approved caption",
    requestId,
  });
  assert.equal(harness.calls.filter((call) => call === "create").length, 1);
  await harness.workflow.resolveInstagramPublication({
    accountId,
    publicationId: publication.publicationId,
    outcome: "not-published",
  });
  assert.equal(harness.publications.get(publication.publicationId)?.status, "not-published");
});

test("an uncertain publish can be marked published only with a permalink from this account", async () => {
  const harness = createHarness({
    publish: async () => {
      throw new InstagramReelRemoteError("unknown");
    },
  });
  await harness.workflow.approveAndPublishInstagramReel({
    accountId,
    exportId: "export-one",
    caption: "Approved caption",
    requestId,
  });
  const publication = await waitForTerminal(harness);
  assert.equal(publication.status, "reconciliation-required");
  await assert.rejects(
    harness.workflow.resolveInstagramPublication({
      accountId,
      publicationId: publication.publicationId,
      outcome: "published",
      permalink: "https://www.instagram.com/reel/NotFound/",
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "publication-media-not-found",
  );
  const resolved = await harness.workflow.resolveInstagramPublication({
    accountId,
    publicationId: publication.publicationId,
    outcome: "published",
    permalink,
  });
  assert.equal(resolved.status, "published");
  assert.equal(resolved.mediaId, "media-77");
  assert.equal(resolved.permalink, permalink);
  assert.equal(harness.calls.filter((call) => call === "publish").length, 1);
});

test("restart recovery quarantines intents that may have reached a Meta POST", async () => {
  const interrupted = {
    publicationId: randomUUID(),
    requestId,
    accountId,
    projectId: "project-one",
    projectRevision: 5,
    exportId: "export-one",
    exportSha256: "a".repeat(64),
    fileSizeBytes: 5,
    durationMs: 5_000,
    caption: "Approved caption",
    status: "publishing" as const,
    containerId: "container-1",
    approvedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const harness = createHarness({ initialPublications: [interrupted] });
  await harness.workflow.recoverPublications();
  assert.equal(
    harness.publications.get(interrupted.publicationId)?.status,
    "reconciliation-required",
  );
  assert.equal(
    harness.publications.get(interrupted.publicationId)?.reconciliationReason,
    "host-restarted",
  );
  assert.deepEqual(harness.calls, []);
});

test("supervised automation leaves a durable proposal until the user approves it", async () => {
  const harness = createHarness();
  const proposal = await harness.workflow.requestAutomatedInstagramPublication({
    accountId,
    exportId: "export-one",
    caption: "Review this caption",
    requestId: "automation-request-01",
  });

  assert.equal(proposal.status, "approval-required");
  assert.equal(proposal.trigger, "automation");
  assert.equal(proposal.approvedAt, undefined);
  assert.equal(proposal.automationAuthorizedAt, undefined);
  assert.deepEqual(harness.calls, []);

  const approved = await harness.workflow.approveInstagramPublicationProposal({
    accountId,
    publicationId: proposal.publicationId,
  });
  assert.equal(approved.status, "preparing-media");
  assert.equal(approved.approvedAt, 10_000);
  assert.equal(approved.automationAuthorizedAt, undefined);
  const published = await waitForTerminal(harness);
  assert.equal(published.status, "published");
});

test("autonomous automation requires an allowed source and consumes cadence and daily quota", async () => {
  const harness = createHarness({
    automationPolicy: {
      autonomyEnabled: true,
      allowedSources: ["local-file"],
      cadence: "daily",
      maxPublicationsPerDay: 1,
    },
  });
  const started = await harness.workflow.requestAutomatedInstagramPublication({
    accountId,
    exportId: "export-one",
    caption: "Approved by saved policy",
    requestId: "automation-request-02",
  });
  assert.equal(started.trigger, "automation");
  assert.equal(started.status, "preparing-media");
  assert.equal(started.approvedAt, undefined);
  assert.equal(started.automationAuthorizedAt, 10_000);
  assert.equal((await waitForTerminal(harness)).status, "published");

  await assert.rejects(
    harness.workflow.requestAutomatedInstagramPublication({
      accountId,
      exportId: "export-one",
      caption: "A second request",
      requestId: "automation-request-03",
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "publication-policy-denied",
  );
});

test("weekly cadence blocks a second automated publication within seven days", async () => {
  const harness = createHarness({
    automationPolicy: {
      autonomyEnabled: true,
      allowedSources: ["local-file"],
      cadence: "weekly",
      maxPublicationsPerDay: 3,
    },
  });
  const first = await harness.workflow.requestAutomatedInstagramPublication({
    accountId,
    exportId: "export-one",
    caption: "First weekly post",
    requestId: "automation-weekly-01",
  });
  assert.equal(first.status, "preparing-media");
  assert.equal((await waitForTerminal(harness)).status, "published");

  await assert.rejects(
    harness.workflow.requestAutomatedInstagramPublication({
      accountId,
      exportId: "export-one",
      caption: "Too soon for another post",
      requestId: "automation-weekly-02",
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "publication-policy-denied",
  );
  assert.equal(harness.calls.filter((call) => call === "create").length, 1);
});

test("autonomous publication fails closed when project source provenance is not allowed", async () => {
  const harness = createHarness({
    automationPolicy: {
      autonomyEnabled: true,
      allowedSources: ["youtube-search"],
      cadence: "weekly",
      maxPublicationsPerDay: 3,
    },
  });
  await assert.rejects(
    harness.workflow.requestAutomatedInstagramPublication({
      accountId,
      exportId: "export-one",
      caption: "Disallowed source",
      requestId: "automation-request-04",
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "publication-policy-denied",
  );
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.publications.size, 0);
});
