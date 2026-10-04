import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSocialAccountFileStore } from "../src/social-account/adapters/socialAccountFileStore.js";
import { createSocialAccountService } from "../src/social-account/app/socialAccountService.js";
import { SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT } from "@social-harness/shared";
import { createSocialMediaFileStore } from "../src/social-media/adapters/socialMediaFileStore.js";
import {
  SocialMediaAccountNotFoundError,
  SocialMediaAssetNotFoundError,
  SocialMediaPreviewUnavailableError,
} from "../src/social-media/app/errors.js";
import { createSocialMediaService } from "../src/social-media/app/socialMediaService.js";
import type { SocialMediaClipSignalAnalyzer } from "../src/social-media/app/ports/socialMediaClipSignalAnalyzer.js";
import {
  createTestTranscriber,
  createTestTranscriptionModelManager,
} from "./helpers/socialMediaTestDoubles.js";

async function createServices(
  root: string,
  youTubeSearch: { search(query: string, limit: number): Promise<unknown[]> } = {
    async search() {
      return [];
    },
  },
  clipSignalAnalyzer?: SocialMediaClipSignalAnalyzer,
  createPreviewUrl?: (path: string) => Promise<{ url: string; expiresAt: number }>,
) {
  const socialAccountService = createSocialAccountService({
    store: createSocialAccountFileStore({ filePath: join(root, "accounts.json") }),
    now: () => 100,
  });
  const mediaRoot = join(root, "social-media");
  const mediaStore = createSocialMediaFileStore({
    catalogPath: join(mediaRoot, "catalog.json"),
    originalsDir: join(mediaRoot, "originals"),
  });
  const socialMediaService = createSocialMediaService({
    store: mediaStore,
    socialAccountService,
    transcriptionModelManager: createTestTranscriptionModelManager(),
    transcriber: createTestTranscriber(),
    youTubeSearch,
    ...(clipSignalAnalyzer ? { clipSignalAnalyzer } : {}),
    ...(createPreviewUrl ? { createPreviewUrl } : {}),
    now: () => 200,
  });
  const createAccount = (displayName: string) =>
    socialAccountService.create({
      displayName,
      editorialProfile: {
        niche: "Podcast",
        audience: "Listeners",
        language: "pt-BR",
        tone: [],
        references: [],
        preferredSources: ["local-file"],
        visualStyle: "Subtitles",
        memory: [],
      },
    });
  return { createAccount, mediaRoot, socialAccountService, socialMediaService };
}

test("media preview validates account ownership and returns only an opaque URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-preview-"));
  try {
    const paths: string[] = [];
    const { createAccount, socialMediaService } = await createServices(
      root,
      undefined,
      undefined,
      async (path) => {
        paths.push(path);
        return {
          url: "social-harness-media://local/preview/550e8400-e29b-41d4-a716-446655440000",
          expiresAt: 1_800_200,
        };
      },
    );
    const [firstAccount, secondAccount] = await Promise.all([
      createAccount("Podcast A"),
      createAccount("Podcast B"),
    ]);
    const source = join(root, "episode.mp4");
    await writeFile(source, Buffer.from("private original"));
    const asset = await socialMediaService.importLocalFile({
      accountId: firstAccount.accountId,
      sourcePath: source,
    });

    const preview = await socialMediaService.previewService.prepare({
      accountId: firstAccount.accountId,
      mediaId: asset.mediaId,
    });
    await assert.rejects(
      socialMediaService.previewService.prepare({
        accountId: secondAccount.accountId,
        mediaId: asset.mediaId,
      }),
      SocialMediaAssetNotFoundError,
    );
    assert.deepEqual(paths, [paths[0]]);
    assert.notEqual(paths[0], source);
    assert.equal(preview.url.includes(paths[0]!), false);
    assert.equal(preview.url.includes("originals"), false);
    assert.equal(preview.accountId, firstAccount.accountId);
    assert.equal(preview.mediaId, asset.mediaId);
    assert.equal(preview.mimeType, asset.mimeType);
    assert.equal(preview.expiresAt, 1_800_200);
    assert.equal("path" in preview, false);

    const withoutMainCapability = await createServices(join(root, "no-main"));
    const disconnectedAccount = await withoutMainCapability.createAccount("No preview");
    const disconnectedSource = join(root, "no-main.mp4");
    await writeFile(disconnectedSource, Buffer.from("original"));
    const disconnectedAsset = await withoutMainCapability.socialMediaService.importLocalFile({
      accountId: disconnectedAccount.accountId,
      sourcePath: disconnectedSource,
    });
    await assert.rejects(
      withoutMainCapability.socialMediaService.previewService.prepare({
        accountId: disconnectedAccount.accountId,
        mediaId: disconnectedAsset.mediaId,
      }),
      SocialMediaPreviewUnavailableError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clip suggestions are account-scoped, transient, and use private local signal analysis", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-clip-analysis-"));
  try {
    const analysisInputs: Array<{ mediaPath: string; hasVideo: boolean }> = [];
    const { createAccount, socialMediaService } = await createServices(root, undefined, {
      async analyze(input) {
        analysisInputs.push(input);
        return {
          available: true,
          signals: {
            durationSeconds: 60,
            peakAudioRms: 0.3,
            audioWindows: Array.from({ length: 60 }, (_, index) => ({
              startSeconds: index,
              endSeconds: index + 1,
              energy: 0.6,
              onsetRate: 0.5,
            })),
            rhythm: null,
            visualSamples: [],
          },
        };
      },
    });
    const [firstAccount, secondAccount] = await Promise.all([
      createAccount("Music A"),
      createAccount("Music B"),
    ]);
    const source = join(root, "private-song.wav");
    await writeFile(source, Buffer.from("private original"));
    const asset = await socialMediaService.importLocalFile({
      accountId: firstAccount.accountId,
      sourcePath: source,
    });
    const imageSource = join(root, "cover.png");
    await writeFile(imageSource, Buffer.from("private image"));
    const image = await socialMediaService.importLocalFile({
      accountId: firstAccount.accountId,
      sourcePath: imageSource,
    });

    const catalogChanges: unknown[] = [];
    const subscription = socialMediaService.onChanged((change) => catalogChanges.push(change));
    const unavailablePodcast = await socialMediaService.suggestClipCandidates({
      accountId: firstAccount.accountId,
      mediaId: asset.mediaId,
      mode: "podcast",
    });
    const musicResult = await socialMediaService.suggestClipCandidates({
      accountId: firstAccount.accountId,
      mediaId: asset.mediaId,
      mode: "music",
    });
    const imageResult = await socialMediaService.suggestClipCandidates({
      accountId: firstAccount.accountId,
      mediaId: image.mediaId,
      mode: "music",
    });
    await assert.rejects(
      socialMediaService.suggestClipCandidates({
        accountId: secondAccount.accountId,
        mediaId: asset.mediaId,
        mode: "music",
      }),
      SocialMediaAssetNotFoundError,
    );
    await assert.rejects(
      socialMediaService.suggestClipCandidates({
        accountId: "missing",
        mediaId: asset.mediaId,
        mode: "music",
      }),
      SocialMediaAccountNotFoundError,
    );
    subscription.dispose();

    assert.equal(unavailablePodcast.unavailableReason, "transcript-unavailable");
    assert.ok(musicResult.candidates.length > 0 && musicResult.candidates.length <= 5);
    assert.equal(imageResult.unavailableReason, "unsupported-media-kind");
    assert.equal(analysisInputs.length, 1);
    assert.notEqual(analysisInputs[0]?.mediaPath, source);
    assert.equal(analysisInputs[0]?.hasVideo, false);
    assert.deepEqual(catalogChanges, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("YouTube metadata search is account-scoped, validated, capped, and read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-youtube-search-"));
  try {
    const candidates: unknown[] = [];
    for (let index = 0; index < 12; index += 1) {
      const videoId = `videoId${String(index).padStart(4, "0")}`;
      candidates.push({
        videoId,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: `Video ${index}`,
        channel: null,
        durationSeconds: null,
        viewCount: null,
        uploadDate: null,
      });
    }
    candidates.splice(2, 0, {
      videoId: "invalid-id",
      videoUrl: "https://www.youtube.com/watch?v=attacker",
      title: "Invalid record",
      channel: null,
      durationSeconds: null,
      viewCount: null,
      uploadDate: null,
    });
    candidates.splice(3, 0, {
      videoId: "videoIdbad0",
      videoUrl: "https://www.youtube.com/watch?v=videoIdbad0",
      title: "Invalid date",
      channel: null,
      durationSeconds: null,
      viewCount: null,
      uploadDate: "2024-02-30",
    });
    candidates.splice(4, 0, candidates[0]);

    let call: { query: string; limit: number } | null = null;
    const { createAccount, mediaRoot, socialMediaService } = await createServices(root, {
      async search(query, limit) {
        call = { query, limit };
        return candidates;
      },
    });
    const account = await createAccount("Podcast");
    const changes: unknown[] = [];
    const subscription = socialMediaService.onChanged((change) => changes.push(change));
    const results = await socialMediaService.searchYouTube({
      accountId: account.accountId,
      query: "  climate interviews  ",
    });
    subscription.dispose();

    assert.deepEqual(call, {
      query: "climate interviews",
      limit: SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT,
    });
    assert.equal(results.length, SOCIAL_MEDIA_YOUTUBE_SEARCH_LIMIT);
    assert.deepEqual(results[0], {
      videoId: "videoId0000",
      videoUrl: "https://www.youtube.com/watch?v=videoId0000",
      title: "Video 0",
      channel: null,
      durationSeconds: null,
      viewCount: null,
      uploadDate: null,
    });
    assert.equal(new Set(results.map((result) => result.videoId)).size, results.length);
    assert.deepEqual(changes, []);
    assert.deepEqual(await socialMediaService.list(account.accountId), []);
    await assert.rejects(
      readFile(join(mediaRoot, "catalog.json")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("YouTube search validates query and account before invoking the adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-youtube-validation-"));
  try {
    let searchCalls = 0;
    const { createAccount, socialMediaService } = await createServices(root, {
      async search() {
        searchCalls += 1;
        return [];
      },
    });
    const account = await createAccount("Podcast");
    await assert.rejects(
      socialMediaService.searchYouTube({ accountId: account.accountId, query: " " }),
    );
    await assert.rejects(
      socialMediaService.searchYouTube({ accountId: account.accountId, query: "q".repeat(241) }),
    );
    await assert.rejects(
      socialMediaService.searchYouTube({ accountId: "missing", query: "topic" }),
    );
    assert.equal(searchCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local media import persists an immutable copy and isolates account catalogs", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-service-"));
  try {
    const { createAccount, mediaRoot, socialMediaService } = await createServices(root);
    const [firstAccount, secondAccount] = await Promise.all([
      createAccount("Podcast A"),
      createAccount("Music B"),
    ]);
    const sourceA = join(root, "episode.mp4");
    const sourceB = join(root, "track.wav");
    const sourceBytesA = Buffer.from("episode-original-bytes");
    const sourceBytesB = Buffer.from("music-original-bytes");
    await Promise.all([writeFile(sourceA, sourceBytesA), writeFile(sourceB, sourceBytesB)]);

    const changes: Array<{ accountId: string; mediaId: string }> = [];
    let catalogAtEvent: Promise<string> | null = null;
    const catalogPath = join(mediaRoot, "catalog.json");
    const subscription = socialMediaService.onChanged((change) => {
      changes.push(change);
      catalogAtEvent = readFile(catalogPath, "utf8");
    });
    const [assetA, assetB] = await Promise.all([
      socialMediaService.importLocalFile({
        accountId: firstAccount.accountId,
        sourcePath: sourceA,
      }),
      socialMediaService.importLocalFile({
        accountId: secondAccount.accountId,
        sourcePath: sourceB,
      }),
    ]);
    subscription.dispose();

    assert.equal(assetA.mediaKind, "video");
    assert.equal(assetA.originalName, "episode.mp4");
    assert.equal(assetA.sizeBytes, sourceBytesA.length);
    assert.equal(assetA.sourceKind, "local-file");
    assert.equal(assetA.sha256, createHash("sha256").update(sourceBytesA).digest("hex"));
    assert.equal("sourcePath" in assetA, false);
    assert.equal("storagePath" in assetA, false);
    assert.deepEqual(await readFile(sourceA), sourceBytesA);
    assert.deepEqual(await readFile(sourceB), sourceBytesB);
    assert.deepEqual(
      await readFile(join(mediaRoot, "originals", firstAccount.accountId, `${assetA.mediaId}.mp4`)),
      sourceBytesA,
    );
    assert.deepEqual(
      await readFile(
        join(mediaRoot, "originals", secondAccount.accountId, `${assetB.mediaId}.wav`),
      ),
      sourceBytesB,
    );
    assert.deepEqual(await socialMediaService.list(firstAccount.accountId), [assetA]);
    assert.deepEqual(await socialMediaService.list(secondAccount.accountId), [assetB]);
    assert.deepEqual(
      changes
        .map(({ accountId, mediaId }) => ({ accountId, mediaId }))
        .sort((a, b) => a.accountId.localeCompare(b.accountId)),
      [
        { accountId: firstAccount.accountId, mediaId: assetA.mediaId },
        { accountId: secondAccount.accountId, mediaId: assetB.mediaId },
      ].sort((a, b) => a.accountId.localeCompare(b.accountId)),
    );
    assert.ok(catalogAtEvent);
    const catalogContentsAtEvent = await catalogAtEvent;
    assert.ok(catalogContentsAtEvent.includes(assetA.mediaId));
    assert.ok(catalogContentsAtEvent.includes(assetB.mediaId));

    const reopened = await createServices(root);
    assert.deepEqual(await reopened.socialMediaService.list(firstAccount.accountId), [assetA]);
    assert.deepEqual(await reopened.socialMediaService.list(secondAccount.accountId), [assetB]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported files and unknown accounts do not create catalog or managed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-reject-"));
  try {
    const { createAccount, mediaRoot, socialAccountService, socialMediaService } =
      await createServices(root);
    const account = await createAccount("Podcast");
    const unsupportedPath = join(root, "notes.txt");
    await writeFile(unsupportedPath, "not media");

    await assert.rejects(
      socialMediaService.importLocalFile({
        accountId: account.accountId,
        sourcePath: unsupportedPath,
      }),
      /Unsupported local media file type/,
    );
    await assert.rejects(
      socialMediaService.list("missing-account"),
      SocialMediaAccountNotFoundError,
    );
    assert.deepEqual(await socialMediaService.list(account.accountId), []);
    await assert.rejects(
      readdir(join(mediaRoot, "originals", account.accountId)),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

    const otherAccount = await socialAccountService.create({
      displayName: "Other",
      editorialProfile: {
        niche: "Music",
        audience: "Listeners",
        language: "pt-BR",
        tone: [],
        references: [],
        preferredSources: ["local-file"],
        visualStyle: "Visual style",
        memory: [],
      },
    });
    assert.notEqual(account.accountId, otherAccount.accountId);
    await readFile(unsupportedPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
