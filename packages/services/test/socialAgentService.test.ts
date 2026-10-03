import assert from "node:assert/strict";
import test from "node:test";
import type {
  SocialAccount,
  SocialMediaAsset,
  SocialMediaClipCandidateResult,
  SocialProjectSummary,
} from "@social-harness/shared";
import { zcodeProtocolMethods } from "@social-harness/shared";
import type { ISocialAccountService } from "../src/social-account/contract.js";
import type { ISocialMediaService } from "../src/social-media/contract.js";
import type { ISocialProjectService } from "../src/social-project/contract.js";
import type { ISocialPublishingService } from "../src/social-publishing/contract.js";
import { createSocialAgentService } from "../src/social-agent/app/socialAgentService.js";
import { executeSocialAgentRequest } from "../src/zcode-agent/socialAgentToolRequests.js";

const account: SocialAccount = {
  accountId: "account-1",
  platform: "instagram",
  displayName: "Podcast",
  editorialProfile: {
    niche: "Independent film",
    audience: "Film fans",
    language: "pt-BR",
    tone: ["curious"],
    references: ["Long interviews"],
    preferredSources: ["youtube-search"],
    visualStyle: "High contrast captions",
    memory: [
      {
        id: "correction-1",
        text: "Keep the guest's complete answer before cutting to the next question.",
        source: "user",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
  automationPolicy: { autonomyEnabled: false },
  workspaceIdentity: "social-account:account-1",
  createdAt: 1,
  updatedAt: 2,
};

const project: SocialProjectSummary = {
  projectId: "project-1",
  accountId: account.accountId,
  displayName: "Interview cut",
  revision: 4,
  updatedAt: 10,
  trackCount: 2,
};

const mediaId = "11111111-1111-4111-8111-111111111111";

const asset = {
  mediaId,
  accountId: account.accountId,
  sourceKind: "local-file",
  originalName: "interview.mp4",
  mediaKind: "video",
  extension: ".mp4",
  mimeType: "video/mp4",
  sizeBytes: 1200,
  sha256: "a".repeat(64),
  importedAt: 11,
  sourcePath: "/private/account-1/interview.mp4",
  transcript: {
    languageCode: "pt-BR",
    method: "whisper-local",
    modelId: "small",
    createdAt: 12,
    segments: [{ startSeconds: 1, endSeconds: 3, text: "private transcript text" }],
  },
  heatmap: [{ startSeconds: 1, endSeconds: 2, intensity: 0.8 }],
} as unknown as SocialMediaAsset;

const remoteAsset = {
  ...asset,
  mediaId: "22222222-2222-4222-8222-222222222222",
  sourceKind: "remote-url",
  sourceOrigin: "video-url",
  sourceUrl: "https://media.example.test/video.mp4?token=private",
  originalName: "video.mp4",
} as unknown as SocialMediaAsset;

const candidateResult: SocialMediaClipCandidateResult = {
  accountId: account.accountId,
  mediaId,
  mode: "podcast",
  candidates: [
    {
      startSeconds: 5,
      endSeconds: 30,
      score: 91,
      evidence: [{ kind: "speech", excerpt: "A measured excerpt", completePhrase: true }],
    },
  ],
  unavailableReason: null,
};

const jobId = "33333333-3333-4333-8333-333333333333";
const mediaJob = {
  jobId,
  accountId: account.accountId,
  sourceKind: "youtube" as const,
  sourceVideoId: "AbCdEfG1234",
  sourceUrl: "https://www.youtube.com/watch?v=AbCdEfG1234",
  sourceKey: "AbCdEfG1234",
  sourceOrigin: "video-url" as const,
  state: "queued" as const,
  downloadedBytes: 0,
  totalBytes: null,
  etaSeconds: null,
  mediaId: null,
  errorCode: null,
  createdAt: 1,
  updatedAt: 1,
};

function createService() {
  const observedAccountIds: string[] = [];
  const publicationRequests: unknown[] = [];
  const preparationRequests: unknown[] = [];
  const accountService = {
    async get(accountId: string) {
      observedAccountIds.push(accountId);
      return accountId === account.accountId ? account : null;
    },
  } as unknown as ISocialAccountService;
  const projectService = {
    async create(request: unknown) {
      preparationRequests.push({ operation: "create", request });
      return { project: { ...project, tracks: [] } };
    },
    async startExport(request: unknown) {
      preparationRequests.push({ operation: "export", request });
      return {
        exportId: "export-1",
        projectId: project.projectId,
        projectRevision: project.revision,
        requestId: "private-key",
        accountId: account.accountId,
        status: "queued",
        progressPercent: 0,
        createdAt: 1,
        updatedAt: 1,
        sha256: "a".repeat(64),
      };
    },
    async list(accountId: string) {
      observedAccountIds.push(accountId);
      return [project];
    },
    async listExports(accountId: string) {
      observedAccountIds.push(accountId);
      return [];
    },
  } as unknown as ISocialProjectService;
  const mediaService = {
    async downloadSourceUrl(input: { accountId: string; url: string }) {
      observedAccountIds.push(input.accountId);
      preparationRequests.push(input);
      return mediaJob;
    },
    async listJobs(accountId: string) {
      observedAccountIds.push(accountId);
      return [mediaJob];
    },
    async cancelJob(input: { accountId: string; jobId: string }) {
      observedAccountIds.push(input.accountId);
      preparationRequests.push(input);
      return { ...mediaJob, state: "cancelled" };
    },
    async retryJob(input: { accountId: string; jobId: string }) {
      observedAccountIds.push(input.accountId);
      preparationRequests.push(input);
      return mediaJob;
    },
    async list(accountId: string) {
      observedAccountIds.push(accountId);
      return [asset, remoteAsset];
    },
    async searchYouTube(input: { accountId: string }) {
      observedAccountIds.push(input.accountId);
      return [];
    },
    async suggestClipCandidates(input: { accountId: string }) {
      observedAccountIds.push(input.accountId);
      return candidateResult;
    },
  } as unknown as ISocialMediaService;
  const publishingService = {
    async listInstagramPublications(accountId: string) {
      observedAccountIds.push(accountId);
      return [
        {
          publicationId: "publication-1",
          accountId,
          projectId: project.projectId,
          projectRevision: project.revision,
          status: "published",
          caption: "Published caption",
          permalink: "https://www.instagram.com/reel/example/",
          createdAt: 13,
        },
      ];
    },
    async requestAutomatedInstagramPublication(request: {
      accountId: string;
      exportId: string;
      caption: string;
      requestId: string;
    }) {
      observedAccountIds.push(request.accountId);
      publicationRequests.push(request);
      return {
        publicationId: "11111111-1111-4111-8111-111111111111",
        accountId: request.accountId,
        projectId: project.projectId,
        projectRevision: project.revision,
        exportId: request.exportId,
        exportSha256: "a".repeat(64),
        fileSizeBytes: 100,
        durationMs: 5_000,
        caption: request.caption,
        status: "approval-required",
        trigger: "automation",
        createdAt: 14,
        updatedAt: 14,
      };
    },
  } as unknown as ISocialPublishingService;
  return {
    observedAccountIds,
    publicationRequests,
    preparationRequests,
    service: createSocialAgentService({
      accountService,
      mediaService,
      projectService,
      publishingService,
    }),
  };
}

test("Social Agent context and library stay in the conversation's account and hide private media data", async () => {
  const { service, observedAccountIds } = createService();
  assert.equal(await service.resolveScope("ordinary-workspace"), null);
  assert.equal(await service.resolveScope("social-account:../escape"), null);

  const scope = await service.resolveScope("social-account:account-1");
  assert.ok(scope);
  const context = await scope.getContext();
  assert.equal(context.editorialProfile.niche, "Independent film");
  assert.deepEqual(context.editorialProfile.memory, account.editorialProfile.memory);
  assert.deepEqual(context.projects, [
    {
      projectId: project.projectId,
      displayName: project.displayName,
      revision: project.revision,
      updatedAt: project.updatedAt,
      trackCount: project.trackCount,
    },
  ]);
  assert.equal(context.publicationHistory.items[0]?.status, "published");
  assert.equal("accountId" in context.publicationHistory.items[0]!, false);

  const [listedAsset, listedRemoteAsset] = await scope.listMedia();
  assert.ok(listedAsset);
  assert.equal("sourcePath" in listedAsset, false);
  assert.equal("sha256" in listedAsset, false);
  assert.deepEqual(listedAsset.transcript, {
    languageCode: "pt-BR",
    method: "whisper-local",
    segmentCount: 1,
  });
  assert.equal("segments" in listedAsset.transcript!, false);
  assert.equal(listedAsset.heatmapSegmentCount, 1);
  assert.equal(listedRemoteAsset?.sourceKind, "remote-url");
  assert.equal("sourceUrl" in (listedRemoteAsset ?? {}), false);

  const suggestions = await scope.suggestClipCandidates({ mediaId, mode: "podcast" });
  assert.equal("accountId" in suggestions, false);
  assert.deepEqual(new Set(observedAccountIds), new Set([account.accountId]));
});

test("Agent source import and job control use only the bound account and expose safe state", async () => {
  const { service, observedAccountIds, preparationRequests } = createService();
  const scope = await service.resolveScope(account.workspaceIdentity);
  assert.ok(scope);
  const admitted = await scope.importSource(mediaJob.sourceUrl);
  assert.equal(admitted.jobId, jobId);
  assert.equal(admitted.state, "queued");
  assert.equal(JSON.stringify(admitted).includes(mediaJob.sourceUrl), false);
  assert.equal("accountId" in admitted, false);
  assert.equal("sourceKey" in admitted, false);
  assert.equal((await scope.listMediaJobs(jobId))[0]?.jobId, jobId);
  assert.equal((await scope.mediaJobCommand({ action: "cancel", jobId })).state, "cancelled");
  assert.equal((await scope.mediaJobCommand({ action: "retry", jobId })).state, "queued");
  assert.deepEqual(preparationRequests, [
    { accountId: account.accountId, url: mediaJob.sourceUrl },
    { accountId: account.accountId, jobId },
    { accountId: account.accountId, jobId },
  ]);
  assert.deepEqual(new Set(observedAccountIds), new Set([account.accountId]));
  const forged = await executeSocialAgentRequest({
    method: zcodeProtocolMethods.socialAgentQuery,
    params: { action: "import-source", url: mediaJob.sourceUrl, accountId: "account-2" },
    workspaceIdentity: account.workspaceIdentity,
    resolveScope: service.resolveScope,
  });
  assert.equal(forged.kind, "error");
  if (forged.kind === "error") assert.equal(forged.code, -32602);
});

test("Agent project/export commands bind account, strip private fields and reject overrides", async () => {
  const { service, preparationRequests } = createService();
  const scope = await service.resolveScope(account.workspaceIdentity);
  assert.ok(scope);
  const created = await scope.createProject({
    displayName: "Requested Reel",
    requestId: "stable-call",
  });
  assert.equal(created.projectId, project.projectId);
  assert.equal("accountId" in created, false);
  const exported = await scope.startExport({
    projectId: project.projectId,
    expectedRevision: project.revision,
    requestId: "export-call",
  });
  assert.equal(exported.status, "queued");
  for (const key of ["accountId", "requestId", "sha256", "filePath"])
    assert.equal(key in exported, false);
  assert.deepEqual(preparationRequests, [
    {
      operation: "create",
      request: {
        accountId: account.accountId,
        displayName: "Requested Reel",
        requestId: "stable-call",
      },
    },
    {
      operation: "export",
      request: {
        accountId: account.accountId,
        projectId: project.projectId,
        expectedRevision: project.revision,
        requestId: "export-call",
      },
    },
  ]);
  const listed = await scope.listExports({});
  assert.ok(
    listed.every((job) => !("accountId" in job) && !("sha256" in job) && !("requestId" in job)),
  );
  for (const params of [
    { action: "create-project", displayName: "Reel", requestId: "call-id", accountId: "foreign" },
    {
      action: "start-export",
      projectId: "project-1",
      expectedRevision: 4,
      requestId: "call-id",
      outputPath: "/tmp/leak",
    },
    { action: "media-job-command", jobId, command: "retry", accountId: "foreign" },
    { action: "list-exports", projectId: "project-1", secret: "credential" },
  ]) {
    const result = await executeSocialAgentRequest({
      method: zcodeProtocolMethods.socialAgentQuery,
      params,
      workspaceIdentity: account.workspaceIdentity,
      resolveScope: service.resolveScope,
    });
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.code, -32602);
  }
});

test("Social Agent protocol derives scope from the Host identity and rejects account parameters", async () => {
  const { service } = createService();
  let resolverCalls = 0;
  const resolveScope: typeof service.resolveScope = async (identity) => {
    resolverCalls += 1;
    return service.resolveScope(identity);
  };

  const result = await executeSocialAgentRequest({
    method: zcodeProtocolMethods.socialAgentQuery,
    params: { action: "context" },
    workspaceIdentity: "social-account:account-1",
    resolveScope,
  });
  assert.equal(result.kind, "result");
  if (result.kind === "result") {
    assert.equal((result.result as { action: string }).action, "context");
  }

  const invalid = await executeSocialAgentRequest({
    method: zcodeProtocolMethods.socialAgentQuery,
    params: { action: "context", accountId: "account-2" },
    workspaceIdentity: "social-account:account-1",
    resolveScope,
  });
  assert.equal(invalid.kind, "error");
  if (invalid.kind === "error") assert.equal(invalid.code, -32602);

  const unscoped = await executeSocialAgentRequest({
    method: zcodeProtocolMethods.socialAgentQuery,
    params: { action: "context" },
    workspaceIdentity: "ordinary-workspace",
    resolveScope,
  });
  assert.equal(unscoped.kind, "error");
  if (unscoped.kind === "error") assert.equal(unscoped.code, -32131);
  assert.equal(resolverCalls, 2);
});

test("Social publication requests inherit the bound account and cannot approve themselves", async () => {
  const { service, publicationRequests } = createService();
  const result = await executeSocialAgentRequest({
    method: zcodeProtocolMethods.socialAgentQuery,
    params: {
      action: "request-publication",
      exportId: "export-1",
      caption: "Review this Reel",
      requestId: "request-key-000001",
    },
    workspaceIdentity: "social-account:account-1",
    resolveScope: service.resolveScope,
  });
  assert.equal(result.kind, "result");
  assert.deepEqual(publicationRequests, [
    {
      accountId: "account-1",
      exportId: "export-1",
      caption: "Review this Reel",
      requestId: "request-key-000001",
    },
  ]);
  if (result.kind === "result") {
    assert.equal((result.result as { action: string }).action, "request-publication");
    assert.equal("accountId" in (result.result as object), false);
  }

  const attemptedOverride = await executeSocialAgentRequest({
    method: zcodeProtocolMethods.socialAgentQuery,
    params: {
      action: "request-publication",
      exportId: "export-1",
      caption: "Review this Reel",
      requestId: "request-key-000002",
      accountId: "account-2",
    },
    workspaceIdentity: "social-account:account-1",
    resolveScope: service.resolveScope,
  });
  assert.equal(attemptedOverride.kind, "error");
  if (attemptedOverride.kind === "error") assert.equal(attemptedOverride.code, -32602);
  assert.equal(publicationRequests.length, 1);
});
