import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SocialMediaTranscriptionSetup } from "@social-harness/shared";
import { SOCIAL_MEDIA_TRANSCRIPTION_MODELS } from "../src/social-media/domain/transcriptionModels.js";
import { createWhisperTranscriptionModelManager } from "../src/social-media/adapters/whisperTranscriptionModelManager.js";
import type { SocialMediaTranscriptionModelDefinition } from "../src/social-media/domain/transcriptionModels.js";

function createFixture(root: string, bytes: Buffer, fetcher?: typeof fetch) {
  const tiny: SocialMediaTranscriptionModelDefinition = {
    ...SOCIAL_MEDIA_TRANSCRIPTION_MODELS.tiny,
    fileName: "ggml-tiny-fixture.bin",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return {
    tiny,
    manager: createWhisperTranscriptionModelManager({
      modelsDir: join(root, "models"),
      selectedModelPath: join(root, "transcription-model.json"),
      downloadStatePath: join(root, "models", "download-state.json"),
      downloadLockPath: join(root, "models", ".download"),
      cancelRequestPath: join(root, "models", "cancel-request.json"),
      models: { ...SOCIAL_MEDIA_TRANSCRIPTION_MODELS, tiny },
      fetcher,
    }),
  };
}

async function waitForSetup(
  getSetup: () => Promise<SocialMediaTranscriptionSetup>,
  predicate: (setup: SocialMediaTranscriptionSetup) => boolean,
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const setup = await getSetup();
    if (predicate(setup)) return setup;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Transcription model setup did not reach the expected state");
}

test("model selection persists and a verified model installs without exposing its path", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-transcription-model-"));
  const bytes = Buffer.from("verified model fixture");
  const fetcher: typeof fetch = async () => new Response(bytes, { status: 200 });
  try {
    const { tiny, manager } = createFixture(root, bytes, fetcher);
    assert.equal((await manager.getSetup()).selectedModelId, "small");
    await manager.selectModel("tiny");
    const progressUpdates: number[] = [];
    await manager.downloadModel("tiny", () => progressUpdates.push(Date.now()));
    const setup = await waitForSetup(manager.getSetup, (value) =>
      value.models.some((model) => model.modelId === "tiny" && model.installed),
    );

    assert.equal(setup.selectedModelId, "tiny");
    assert.equal(JSON.stringify(setup).includes(root), false);
    assert.ok(progressUpdates.length > 0);
    assert.deepEqual(await readFile(join(root, "models", tiny.fileName)), bytes);
    const corrupted = Buffer.alloc(bytes.byteLength, 0x78);
    const modelPath = join(root, "models", tiny.fileName);
    await writeFile(modelPath, corrupted, { mode: 0o600 });
    const changedMtime = new Date(Date.now() + 2_000);
    await utimes(modelPath, changedMtime, changedMtime);
    assert.equal(
      (await manager.getSetup()).models.find((model) => model.modelId === "tiny")?.installed,
      false,
    );
    const reopened = createFixture(root, bytes, fetcher).manager;
    assert.equal((await reopened.getSetup()).selectedModelId, "tiny");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model SHA-256 mismatch is reported and leaves no partial file", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-transcription-integrity-"));
  const expected = Buffer.from("expected model");
  const actual = Buffer.from("tampered model");
  assert.equal(actual.byteLength, expected.byteLength);
  const fetcher: typeof fetch = async () => new Response(actual, { status: 200 });
  try {
    const { manager } = createFixture(root, expected, fetcher);
    await manager.downloadModel("tiny", () => undefined);
    const setup = await waitForSetup(manager.getSetup, (value) =>
      value.models.some(
        (model) => model.modelId === "tiny" && model.errorCode === "integrity-failed",
      ),
    );

    assert.equal(setup.models.find((model) => model.modelId === "tiny")?.installed, false);
    const files = await readdir(join(root, "models"));
    assert.equal(
      files.some((file) => file.endsWith(".part")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model download cancellation is durable and removes its partial artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-transcription-cancel-"));
  const bytes = Buffer.from("ab");
  let delayedChunkTimer: ReturnType<typeof setTimeout> | undefined;
  const fetcher: typeof fetch = async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("a"));
        delayedChunkTimer = setTimeout(() => controller.enqueue(Buffer.from("b")), 2_000);
      },
      cancel() {
        if (delayedChunkTimer) clearTimeout(delayedChunkTimer);
      },
    });
    return new Response(body, { status: 200 });
  };
  try {
    const owner = createFixture(root, bytes, fetcher).manager;
    let observerFetchCount = 0;
    const observer = createFixture(root, bytes, async () => {
      observerFetchCount += 1;
      return new Response(bytes, { status: 200 });
    }).manager;
    await owner.downloadModel("tiny", () => undefined);
    const observed = await observer.downloadModel("tiny", () => undefined);
    assert.equal(observed.models.find((model) => model.modelId === "tiny")?.downloading, true);
    assert.equal(observerFetchCount, 0);
    await observer.cancelDownload("tiny", () => undefined);
    const setup = await waitForSetup(owner.getSetup, (value) =>
      value.models.some((model) => model.modelId === "tiny" && !model.downloading),
    );

    assert.equal(setup.models.find((model) => model.modelId === "tiny")?.installed, false);
    assert.equal(
      (await readdir(join(root, "models"))).some((file) => file.endsWith(".part")),
      false,
    );
  } finally {
    if (delayedChunkTimer) clearTimeout(delayedChunkTimer);
    await rm(root, { recursive: true, force: true });
  }
});

test("a Host restart marks a download without a live transfer lock as retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-transcription-recovery-"));
  const bytes = Buffer.from("model");
  try {
    const { manager } = createFixture(root, bytes, async () => new Response(bytes));
    await mkdir(join(root, "models"), { recursive: true });
    await writeFile(
      join(root, "models", "download-state.json"),
      `${JSON.stringify({
        modelId: "tiny",
        downloadId: "e174d8c1-8144-4d92-b293-84bb81699079",
        state: "downloading",
        downloadedBytes: 3,
        errorCode: null,
        updatedAt: 10,
      })}\n`,
      { mode: 0o600 },
    );
    const setup = await manager.getSetup();
    assert.equal(setup.models.find((model) => model.modelId === "tiny")?.downloading, false);
    assert.equal(
      setup.models.find((model) => model.modelId === "tiny")?.errorCode,
      "download-failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
