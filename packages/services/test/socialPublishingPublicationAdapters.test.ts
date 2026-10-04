import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInstagramReelPublisher } from "../src/social-publishing/adapters/instagramReelPublisher.js";
import { createSocialProjectExportArtifactReader } from "../src/social-publishing/adapters/socialProjectExportArtifactReader.js";
import { createSocialPublishingPublicationFileStore } from "../src/social-publishing/adapters/socialPublishingPublicationFileStore.js";
import { InstagramReelRemoteError } from "../src/social-publishing/app/ports/instagramReelPublisher.js";

test("Instagram Reel adapter keeps tokens in the Authorization header and uses the Reel sequence", async () => {
  const requests: { url: URL; init: RequestInit }[] = [];
  const publisher = createInstagramReelPublisher({
    fetcher: async (input, init) => {
      requests.push({ url: new URL(String(input)), init: init ?? {} });
      if (requests.length === 2) return Response.json({ status_code: "FINISHED" });
      return Response.json({ id: requests.length === 1 ? "container-1" : "media-1" });
    },
  });
  const container = await publisher.createReelContainer({
    instagramUserId: "ig-user-42",
    accessToken: "secret-access-token",
    videoUrl: "https://bridge.example/m/opaque-capability",
    caption: "Launch caption",
  });
  const status = await publisher.getContainerStatus({
    containerId: container.containerId,
    accessToken: "secret-access-token",
  });
  const published = await publisher.publishReel({
    instagramUserId: "ig-user-42",
    containerId: container.containerId,
    accessToken: "secret-access-token",
  });

  assert.equal(container.containerId, "container-1");
  assert.equal(status.statusCode, "FINISHED");
  assert.equal(published.mediaId, "media-1");
  assert.equal(requests[0]?.url.pathname, "/v26.0/ig-user-42/media");
  assert.equal(requests[1]?.url.pathname, "/v26.0/container-1");
  assert.equal(requests[1]?.url.searchParams.get("fields"), "status_code,status");
  assert.equal(requests[2]?.url.pathname, "/v26.0/ig-user-42/media_publish");
  for (const request of requests) {
    assert.equal(
      new Headers(request.init.headers).get("authorization"),
      "Bearer secret-access-token",
    );
    assert.equal(request.url.href.includes("secret-access-token"), false);
  }
  const body = new URLSearchParams(requests[0]?.init.body as string);
  assert.equal(body.get("media_type"), "REELS");
  assert.equal(body.get("video_url"), "https://bridge.example/m/opaque-capability");
  assert.equal(body.get("caption"), "Launch caption");
  assert.equal(
    new URLSearchParams(requests[2]?.init.body as string).get("creation_id"),
    "container-1",
  );
});

test("Instagram Reel adapter distinguishes a definite rejection from an uncertain server result", async () => {
  for (const [status, kind] of [
    [400, "rejected"],
    [503, "unknown"],
  ] as const) {
    const publisher = createInstagramReelPublisher({
      fetcher: async () => new Response("{}", { status }),
    });
    await assert.rejects(
      publisher.createReelContainer({
        instagramUserId: "ig-user-42",
        accessToken: "secret",
        videoUrl: "https://bridge.example/m/opaque",
        caption: "caption",
      }),
      (error: unknown) => error instanceof InstagramReelRemoteError && error.kind === kind,
    );
  }
});

test("publication file store is durable, scoped, and request-idempotent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "social-publications-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "publications.json");
  const store = createSocialPublishingPublicationFileStore({ filePath });
  const publication = {
    publicationId: randomUUID(),
    requestId: "request-key-000001",
    accountId: "account-one",
    projectId: "project-one",
    projectRevision: 3,
    exportId: "export-one",
    exportSha256: "a".repeat(64),
    fileSizeBytes: 5,
    durationMs: 5_000,
    caption: "caption",
    status: "preparing-media" as const,
    approvedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  assert.deepEqual(await store.createIfAbsent(publication), { publication, created: true });
  assert.deepEqual(await store.createIfAbsent(publication), { publication, created: false });
  const reopenedStore = createSocialPublishingPublicationFileStore({ filePath });
  assert.deepEqual(await reopenedStore.get("account-one", publication.publicationId), publication);
  assert.deepEqual(await reopenedStore.list("account-two"), []);
  const updated = await reopenedStore.update(
    "account-one",
    publication.publicationId,
    (current) => ({
      ...current,
      status: "processing-container",
      containerId: "container-1",
      updatedAt: 2,
    }),
  );
  assert.equal(updated?.status, "processing-container");
  assert.equal((JSON.parse(await readFile(filePath, "utf8")) as { version: number }).version, 1);
});

test("Host export artifact reader verifies the exact hash and rejects symlinks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "social-export-artifact-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const exportDirectory = join(directory, "exports");
  await mkdir(exportDirectory);
  const exportId = randomUUID();
  const filePath = join(exportDirectory, `${exportId}.mp4`);
  const bytes = Buffer.from("verified video bytes");
  await writeFile(filePath, bytes);
  const reader = createSocialProjectExportArtifactReader({ exportDirectory });
  const blob = await reader.open({
    exportId,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    expectedFileSizeBytes: bytes.length,
  });
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  await assert.rejects(
    reader.open({ exportId, expectedSha256: "b".repeat(64), expectedFileSizeBytes: bytes.length }),
  );

  const linkedId = randomUUID();
  const linkedPath = join(exportDirectory, `${linkedId}.mp4`);
  await symlink(filePath, linkedPath);
  await assert.rejects(
    reader.open({
      exportId: linkedId,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      expectedFileSizeBytes: bytes.length,
    }),
  );
});
