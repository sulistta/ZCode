import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ISocialAccountService } from "../src/social-account/contract.js";
import type { ISocialMediaService } from "../src/social-media/contract.js";
import {
  socialProjectAudioClipSchema,
  socialProjectClipSchema,
  socialProjectKeyframeSchema,
  socialProjectTextClipSchema,
  socialProjectVideoClipSchema,
  type SocialProjectCommandRequest,
  type SocialProject,
} from "@social-harness/shared";
import type { SocialProjectExportRenderer } from "../src/social-project/app/socialProjectExportService.js";
import { SocialProjectInvalidOperationError } from "../src/social-project/domain/errors.js";
import {
  SocialProjectAgentEditSuspendedError,
  SocialProjectExportRequestConflictError,
  SocialProjectExportRevisionConflictError,
  SocialProjectIdempotencyConflictError,
  SocialProjectMediaNotFoundError,
  SocialProjectRevisionConflictError,
} from "../src/social-project/app/errors.js";
import { createSocialProjectService } from "../src/social-project/app/socialProjectService.js";
import { createSocialProjectFileStore } from "../src/social-project/adapters/socialProjectFileStore.js";
import { createSocialProjectExportFileStore } from "../src/social-project/adapters/socialProjectExportFileStore.js";

const ACCOUNT_ID = "account-1";
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";

test("stable project creation requests deduplicate concurrent admission and survive service recreation", async () => {
  const fixture = await createFixture();
  try {
    const request = {
      accountId: ACCOUNT_ID,
      displayName: "Agent preparation",
      requestId: "stable-creation-request",
    };
    const [first, repeated] = await Promise.all([
      fixture.service.create(request),
      fixture.service.create(request),
    ]);
    assert.equal(first.project.projectId, repeated.project.projectId);
    assert.equal((await fixture.service.list(ACCOUNT_ID)).length, 1);
    await assert.rejects(
      fixture.service.create({ ...request, displayName: "Conflicting creation" }),
      SocialProjectIdempotencyConflictError,
    );
    const otherAccount = await fixture.service.create({ ...request, accountId: "account-2" });
    assert.notEqual(otherAccount.project.projectId, first.project.projectId);
    const store = createSocialProjectFileStore({ filePath: fixture.filePath });
    const persisted = await store.get(ACCOUNT_ID, first.project.projectId);
    assert.equal(persisted?.creationRequest?.requestId, request.requestId);
    const afterRestart = await fixture.restartService().create(request);
    assert.equal(afterRestart.project.projectId, first.project.projectId);
  } finally {
    await fixture.dispose();
  }
});

function createVideoAsset(accountId: string, mediaId = VIDEO_ID) {
  return {
    mediaId,
    accountId,
    sourceKind: "local-file" as const,
    originalName: "source.mp4",
    mediaKind: "video" as const,
    extension: ".mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    importedAt: 100,
  };
}

async function createFixture(options: { exportRenderer?: SocialProjectExportRenderer } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "social-project-service-"));
  const filePath = join(directory, "projects.json");
  let nextProjectId = 1;
  let nextTrackId = 1;
  let clock = 100;
  const media = [createVideoAsset(ACCOUNT_ID)];
  const accounts = [
    { accountId: ACCOUNT_ID, workspaceIdentity: `social-account:${ACCOUNT_ID}` },
    { accountId: "account-2", workspaceIdentity: "social-account:account-2" },
  ];
  const socialAccountService = {
    get: async (accountId: string) =>
      accounts.find((account) => account.accountId === accountId) ?? null,
    list: async () => accounts,
  } as unknown as ISocialAccountService;
  const socialMediaService = {
    list: async (accountId: string) => media.filter((asset) => asset.accountId === accountId),
  } as unknown as ISocialMediaService;
  const restartService = () =>
    createSocialProjectService({
      store: createSocialProjectFileStore({ filePath }),
      exportStore: createSocialProjectExportFileStore(join(directory, "exports.json")),
      exportRenderer: options.exportRenderer ?? {
        async render() {
          throw new Error("Export renderer not used by this fixture");
        },
        async discard() {},
        async createDownloadUrl() {
          return { url: "social-harness-media://local/preview/opaque", expiresAt: 10_000 };
        },
      },
      socialAccountService,
      socialMediaService,
      now: () => clock++,
      createProjectId: () => `project-${nextProjectId++}`,
      createTrackId: () => `track-${nextTrackId++}`,
    });
  const service = restartService();
  return {
    directory,
    filePath,
    media,
    service,
    restartService,
    async dispose() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function command(
  projectId: string,
  expectedRevision: number,
  operation: SocialProjectCommandRequest["operation"],
  extras: { commandId?: string; author?: "user" | "agent"; accountId?: string } = {},
): SocialProjectCommandRequest {
  return {
    accountId: extras.accountId ?? ACCOUNT_ID,
    projectId,
    commandId: extras.commandId ?? `command-${expectedRevision}-${String(operation.type)}`,
    expectedRevision,
    author: extras.author ?? "user",
    operation,
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function videoClip(clipId: string) {
  return {
    clipId,
    kind: "video" as const,
    mediaId: VIDEO_ID,
    timelineStartMs: 2_000,
    sourceStartMs: 0,
    sourceEndMs: 10_000,
    playbackRate: 1,
    volume: 1,
    keyframes: [],
  };
}

test("color adjustments are bounded and only accepted on visual clips", () => {
  const visualClip = videoClip("clip-color");
  const adjustments = { brightness: -0.5, contrast: 1.5, saturation: 0, hue: 180 };

  assert.deepEqual(
    socialProjectVideoClipSchema.parse({
      ...visualClip,
      colorAdjustments: adjustments,
    }).colorAdjustments,
    adjustments,
  );
  assert.equal(socialProjectVideoClipSchema.parse(visualClip).colorAdjustments, undefined);
  assert.equal(
    socialProjectClipSchema.safeParse({
      ...visualClip,
      colorAdjustments: { ...adjustments, brightness: -1.01 },
    }).success,
    false,
  );
  assert.equal(
    socialProjectAudioClipSchema.safeParse({
      ...visualClip,
      kind: "audio",
      colorAdjustments: adjustments,
    }).success,
    false,
  );
  assert.equal(
    socialProjectClipSchema.safeParse({
      clipId: "clip-text",
      kind: "text",
      timelineStartMs: 0,
      durationMs: 1000,
      text: "Caption",
      style: { fontFamily: "sans-serif", fontSize: 24, color: "#ffffff", alignment: "center" },
      keyframes: [],
      colorAdjustments: adjustments,
    }).success,
    false,
  );
});

test("keyframes enforce property ranges and clip-kind compatibility", () => {
  const keyframe = {
    keyframeId: "keyframe-1",
    timeMs: 500,
    property: "scaleX" as const,
    value: 1,
    easing: "ease-out" as const,
  };
  assert.equal(socialProjectKeyframeSchema.safeParse(keyframe).success, true);
  assert.equal(
    socialProjectKeyframeSchema.safeParse({ ...keyframe, value: 100.01 }).success,
    false,
  );
  assert.equal(
    socialProjectKeyframeSchema.safeParse({ ...keyframe, property: "opacity", value: 1.01 })
      .success,
    false,
  );

  const visualClip = videoClip("clip-keyframe");
  assert.equal(
    socialProjectVideoClipSchema.safeParse({ ...visualClip, keyframes: [keyframe] }).success,
    true,
  );
  assert.equal(
    socialProjectAudioClipSchema.safeParse({
      ...visualClip,
      kind: "audio",
      keyframes: [{ ...keyframe, property: "x" }],
    }).success,
    false,
  );
  assert.equal(
    socialProjectClipSchema.safeParse({
      ...visualClip,
      kind: "image",
      keyframes: [{ ...keyframe, property: "volume" }],
    }).success,
    false,
  );
  assert.equal(
    socialProjectAudioClipSchema.safeParse({
      ...visualClip,
      kind: "audio",
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
      },
    }).success,
    false,
  );
  assert.equal(
    socialProjectTextClipSchema.safeParse({
      clipId: "text-clip",
      kind: "text",
      timelineStartMs: 0,
      durationMs: 1000,
      text: "Caption",
      style: { fontFamily: "sans-serif", fontSize: 24, color: "#ffffff", alignment: "center" },
      keyframes: [{ ...keyframe, property: "volume" }],
    }).success,
    false,
  );
});

test("projects persist account scope, default portrait tracks, and post-commit events", async () => {
  const fixture = await createFixture();
  try {
    const events: Array<{ revision: number; persisted: boolean }> = [];
    fixture.service.onChanged((event) => {
      const stored = JSON.parse(readFileSync(fixture.filePath, "utf8")) as {
        projects: Array<{ project: { projectId: string; revision: number } }>;
      };
      events.push({
        revision: event.revision,
        persisted: stored.projects.some(
          (record) =>
            record.project.projectId === event.projectId &&
            record.project.revision === event.revision,
        ),
      });
    });

    const created = await fixture.service.create({
      accountId: ACCOUNT_ID,
      displayName: "Podcast Reel",
    });

    assert.equal(created.project.revision, 0);
    assert.equal(created.project.settings.width, 1080);
    assert.equal(created.project.settings.height, 1920);
    assert.equal(created.canUndo, false);
    assert.equal(created.canRedo, false);
    assert.deepEqual(
      created.project.tracks.map((track) => track.type),
      ["video", "audio"],
    );
    assert.deepEqual(events, [{ revision: 0, persisted: true }]);
    assert.deepEqual(await fixture.service.list(ACCOUNT_ID), [
      {
        projectId: created.project.projectId,
        accountId: ACCOUNT_ID,
        displayName: "Podcast Reel",
        revision: 0,
        updatedAt: created.project.updatedAt,
        trackCount: 2,
      },
    ]);
    assert.equal(await fixture.service.get("account-2", created.project.projectId), null);
  } finally {
    await fixture.dispose();
  }
});

test("commands preserve visual adjustments through split, undo, and redo revisions", async () => {
  const fixture = await createFixture();
  try {
    const created = await fixture.service.create({
      accountId: ACCOUNT_ID,
      displayName: "Podcast Reel",
    });
    const projectId = created.project.projectId;
    const videoTrackId = created.project.tracks[0]!.trackId;
    const colorAdjustments = { brightness: -0.25, contrast: 1.2, saturation: 0.8, hue: 35 };
    const inserted = await fixture.service.executeCommand(
      command(projectId, 0, {
        type: "put-clip",
        trackId: videoTrackId,
        clip: { ...videoClip("clip-1"), colorAdjustments },
      }),
    );
    const split = await fixture.service.executeCommand(
      command(projectId, 1, {
        type: "split-clip",
        clipId: "clip-1",
        splitAtMs: 7_000,
        newClipId: "clip-2",
      }),
    );
    const undone = await fixture.service.executeCommand(command(projectId, 2, { type: "undo" }));
    const redone = await fixture.service.executeCommand(command(projectId, 3, { type: "redo" }));

    assert.deepEqual(
      [
        inserted.project.revision,
        split.project.revision,
        undone.project.revision,
        redone.project.revision,
      ],
      [1, 2, 3, 4],
    );
    assert.equal(split.project.tracks[0]!.clips.length, 2);
    const left = split.project.tracks[0]!.clips[0]!;
    const right = split.project.tracks[0]!.clips[1]!;
    assert.equal(left.kind === "text" ? left.durationMs : left.sourceEndMs, 5_000);
    assert.equal(right.timelineStartMs, 7_000);
    assert.deepEqual(left.kind === "video" ? left.colorAdjustments : undefined, colorAdjustments);
    assert.deepEqual(right.kind === "video" ? right.colorAdjustments : undefined, colorAdjustments);
    assert.equal(undone.project.tracks[0]!.clips.length, 1);
    assert.deepEqual(
      undone.project.tracks[0]!.clips[0]!.kind === "video"
        ? undone.project.tracks[0]!.clips[0]!.colorAdjustments
        : undefined,
      colorAdjustments,
    );
    assert.equal(redone.project.tracks[0]!.clips.length, 2);
    assert.equal(inserted.canUndo, true);
    assert.equal(inserted.canRedo, false);
    assert.equal(undone.canUndo, true);
    assert.equal(undone.canRedo, true);
    assert.equal(redone.canUndo, true);
    assert.equal(redone.canRedo, false);
    assert.deepEqual(
      redone.history.map((entry) => entry.operation),
      ["put-clip", "split-clip", "undo", "redo"],
    );
  } finally {
    await fixture.dispose();
  }
});

test("stale and duplicate commands do not create a second write or event", async () => {
  const fixture = await createFixture();
  try {
    const created = await fixture.service.create({
      accountId: ACCOUNT_ID,
      displayName: "Podcast Reel",
    });
    let events = 0;
    fixture.service.onChanged(() => (events += 1));
    const request = command(
      created.project.projectId,
      0,
      { type: "rename-project", displayName: "Interview Reel" },
      { commandId: "rename-one" },
    );
    const first = await fixture.service.executeCommand(request);
    const duplicate = await fixture.service.executeCommand(request);

    assert.equal(first.project.revision, 1);
    assert.equal(duplicate.project.revision, 1);
    assert.equal(duplicate.duplicate, true);
    assert.equal(events, 1);
    await assert.rejects(
      fixture.service.executeCommand(
        command(created.project.projectId, 0, { type: "rename-project", displayName: "Stale" }),
      ),
      SocialProjectRevisionConflictError,
    );
    await assert.rejects(
      fixture.service.executeCommand(
        command(
          created.project.projectId,
          1,
          { type: "rename-project", displayName: "Different payload" },
          { commandId: "rename-one" },
        ),
      ),
      SocialProjectIdempotencyConflictError,
    );
    assert.equal(events, 1);
    assert.equal(
      (await fixture.service.get(ACCOUNT_ID, created.project.projectId))?.project.revision,
      1,
    );
  } finally {
    await fixture.dispose();
  }
});

test("user edit control suspends Agent commands until the user returns control", async () => {
  const fixture = await createFixture();
  try {
    const created = await fixture.service.create({
      accountId: ACCOUNT_ID,
      displayName: "Podcast Reel",
    });
    const projectId = created.project.projectId;
    const taken = await fixture.service.executeCommand(
      command(projectId, 0, { type: "take-control" }),
    );
    assert.equal(taken.project.editControlOwner, "user");
    await assert.rejects(
      fixture.service.executeCommand(
        command(
          projectId,
          1,
          { type: "rename-project", displayName: "Agent change" },
          { author: "agent" },
        ),
      ),
      SocialProjectAgentEditSuspendedError,
    );
    const returned = await fixture.service.executeCommand(
      command(projectId, 1, { type: "return-to-agent" }),
    );
    const agentEdit = await fixture.service.executeCommand(
      command(
        projectId,
        2,
        { type: "rename-project", displayName: "Agent change" },
        { author: "agent" },
      ),
    );
    assert.equal(returned.project.editControlOwner, "agent");
    assert.equal(agentEdit.project.displayName, "Agent change");
  } finally {
    await fixture.dispose();
  }
});

test("project commands cannot reference media owned by another account", async () => {
  const fixture = await createFixture();
  try {
    const foreignId = "22222222-2222-4222-8222-222222222222";
    fixture.media.push(createVideoAsset("account-2", foreignId));
    const created = await fixture.service.create({
      accountId: ACCOUNT_ID,
      displayName: "Podcast Reel",
    });
    const videoTrackId = created.project.tracks[0]!.trackId;
    await assert.rejects(
      fixture.service.executeCommand(
        command(created.project.projectId, 0, {
          type: "put-clip",
          trackId: videoTrackId,
          clip: { ...videoClip("clip-foreign"), mediaId: foreignId },
        }),
      ),
      SocialProjectMediaNotFoundError,
    );
    assert.equal(
      (await fixture.service.get(ACCOUNT_ID, created.project.projectId))?.project.revision,
      0,
    );
  } finally {
    await fixture.dispose();
  }
});

test("Agent scope is bound to one workspace account and cannot control edit history", async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.service.create({ accountId: ACCOUNT_ID, displayName: "First" });
    const second = await fixture.service.create({ accountId: "account-2", displayName: "Second" });
    const scope = await fixture.service.agentScope(`social-account:${ACCOUNT_ID}`);
    assert.ok(scope);
    assert.deepEqual(
      (await scope.list()).map((project) => project.projectId),
      [first.project.projectId],
    );
    assert.equal(await scope.get(second.project.projectId), null);

    const changed = await scope.executeCommand({
      commandId: "agent-rename",
      expectedRevision: 0,
      projectId: first.project.projectId,
      operation: { type: "rename-project", displayName: "First edited" },
    });
    assert.equal(changed.project.accountId, ACCOUNT_ID);
    assert.equal(changed.history.at(-1)?.author, "agent");

    assert.throws(
      () =>
        scope.executeCommand({
          commandId: "agent-undo",
          expectedRevision: 1,
          projectId: first.project.projectId,
          operation: { type: "undo" },
        } as never),
      SocialProjectInvalidOperationError,
    );
    assert.equal(await fixture.service.agentScope("social-account:unknown"), null);
  } finally {
    await fixture.dispose();
  }
});

test("exports snapshot one accepted revision, deduplicate requests, and expose only a download capability", async () => {
  let releaseRender!: () => void;
  let renderStarted!: () => void;
  const renderGate = new Promise<void>((resolve) => (releaseRender = resolve));
  const started = new Promise<void>((resolve) => (renderStarted = resolve));
  let renderedProject: SocialProject | null = null;
  const fixture = await createFixture({
    exportRenderer: {
      async render({ project, onProgress }) {
        renderedProject = structuredClone(project);
        onProgress(42);
        renderStarted();
        await renderGate;
        return { durationMs: 10_000, fileSizeBytes: 123, sha256: "a".repeat(64) };
      },
      async discard() {},
      async createDownloadUrl(input) {
        assert.equal(input.fileSizeBytes, 123);
        assert.equal(input.sha256, "a".repeat(64));
        return { url: "social-harness-media://local/preview/opaque", expiresAt: 10_000 };
      },
    },
  });
  try {
    const created = await fixture.service.create({ accountId: ACCOUNT_ID, displayName: "First" });
    const request = {
      accountId: ACCOUNT_ID,
      projectId: created.project.projectId,
      expectedRevision: 0,
      requestId: "export-request-1",
    };
    const completed = new Promise<void>((resolve) => {
      const subscription = fixture.service.onExportChanged((change) => {
        if (change.status !== "completed") return;
        const stored = JSON.parse(
          readFileSync(join(fixture.directory, "exports.json"), "utf8"),
        ) as {
          exports: Array<{ job: { exportId: string; status: string } }>;
        };
        assert.equal(
          stored.exports.find((record) => record.job.exportId === change.exportId)?.job.status,
          "completed",
        );
        subscription.dispose();
        resolve();
      });
    });
    const progressPersisted = new Promise<void>((resolve) => {
      const subscription = fixture.service.onExportChanged((change) => {
        if (change.status !== "rendering" || change.progressPercent !== 42) return;
        const stored = JSON.parse(
          readFileSync(join(fixture.directory, "exports.json"), "utf8"),
        ) as {
          exports: Array<{ job: { exportId: string; progressPercent: number } }>;
        };
        assert.equal(
          stored.exports.find((record) => record.job.exportId === change.exportId)?.job
            .progressPercent,
          42,
        );
        subscription.dispose();
        resolve();
      });
    });
    const first = await withTimeout(fixture.service.startExport(request), "startExport timed out");
    await withTimeout(started, "renderer did not start");
    await withTimeout(progressPersisted, "export progress was not persisted");
    assert.equal(
      (await fixture.service.getExport(ACCOUNT_ID, first.exportId))?.progressPercent,
      42,
    );
    const edited = await fixture.service.executeCommand(
      command(created.project.projectId, 0, { type: "rename-project", displayName: "Edited" }),
    );
    assert.equal(edited.project.revision, 1);
    assert.equal(renderedProject?.revision, 0);
    assert.equal(renderedProject?.displayName, "First");
    await assert.rejects(
      fixture.service.startExport({ ...request, requestId: "export-request-stale" }),
      SocialProjectExportRevisionConflictError,
    );

    const duplicate = await fixture.service.startExport(request);
    assert.equal(duplicate.exportId, first.exportId);
    assert.equal(duplicate.projectRevision, 0);
    await assert.rejects(
      fixture.service.startExport({ ...request, expectedRevision: 1 }),
      SocialProjectExportRequestConflictError,
    );
    releaseRender();
    await withTimeout(completed, "export did not complete");

    const download = await fixture.service.prepareExportDownload({
      accountId: ACCOUNT_ID,
      exportId: first.exportId,
    });
    assert.deepEqual(download, {
      url: "social-harness-media://local/preview/opaque",
      expiresAt: 10_000,
      suggestedName: `${created.project.projectId}-r0.mp4`,
    });
    assert.equal(await fixture.service.getExport("account-2", first.exportId), null);
    const stored = JSON.parse(readFileSync(join(fixture.directory, "exports.json"), "utf8")) as {
      exports: Array<{ job: { status: string }; snapshot: SocialProject }>;
    };
    assert.equal(stored.exports[0]?.job.status, "completed");
    assert.equal(stored.exports[0]?.snapshot.revision, 0);
    assert.equal(JSON.stringify(stored).includes("/social-projects/exports/"), false);
  } finally {
    releaseRender();
    await fixture.dispose();
  }
});

test("cancelling an active export waits for the renderer and persists cancelled status", async () => {
  let renderStarted!: () => void;
  const started = new Promise<void>((resolve) => (renderStarted = resolve));
  let rendererAborted = false;
  let discarded = 0;
  const fixture = await createFixture({
    exportRenderer: {
      render({ signal }) {
        renderStarted();
        return new Promise((_resolve, reject) => {
          const abort = () => {
            rendererAborted = true;
            reject(new Error("cancelled"));
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      },
      async discard() {
        discarded += 1;
      },
      async createDownloadUrl() {
        throw new Error("Cancelled exports cannot be downloaded");
      },
    },
  });
  try {
    const created = await fixture.service.create({ accountId: ACCOUNT_ID, displayName: "Cancel" });
    const job = await fixture.service.startExport({
      accountId: ACCOUNT_ID,
      projectId: created.project.projectId,
      expectedRevision: 0,
      requestId: "export-request-cancel",
    });
    await withTimeout(started, "renderer did not start");
    const cancelled = await withTimeout(
      fixture.service.cancelExport({ accountId: ACCOUNT_ID, exportId: job.exportId }),
      "cancelExport timed out",
    );
    assert.equal(rendererAborted, true);
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await fixture.service.getExport(ACCOUNT_ID, job.exportId))?.status, "cancelled");
    assert.equal(discarded, 2);
    await assert.rejects(
      fixture.service.prepareExportDownload({ accountId: ACCOUNT_ID, exportId: job.exportId }),
    );
  } finally {
    await fixture.dispose();
  }
});
