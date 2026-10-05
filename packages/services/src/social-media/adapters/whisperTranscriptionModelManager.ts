import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  acquireFileLock,
  atomicWritePrivateTextFile,
  withFileLock,
} from "@social-harness/shared/node";
import {
  isZCodeFileLockTimeoutError,
  socialMediaTranscriptionModelIdSchema,
  socialMediaTranscriptionSetupSchema,
  type SocialMediaTranscriptionModelId,
  type SocialMediaTranscriptionSetup,
} from "@social-harness/shared";
import type { SocialMediaTranscriptionModelManager } from "../app/ports/socialMediaTranscriptionModelManager.js";
import {
  SOCIAL_MEDIA_TRANSCRIPTION_MODELS,
  type SocialMediaTranscriptionModelDefinition,
} from "../domain/transcriptionModels.js";
import {
  transcriptionModelDownloadStateSchema,
  type TranscriptionModelDownloadState as DownloadState,
} from "../domain/transcriptionModelDownloadState.js";
import { readSocialMediaJsonFile } from "./socialMediaTranscriptionPersistence.js";

interface WhisperTranscriptionModelManagerOptions {
  modelsDir: string;
  selectedModelPath: string;
  downloadStatePath: string;
  downloadLockPath: string;
  cancelRequestPath: string;
  models?: Readonly<
    Record<SocialMediaTranscriptionModelId, SocialMediaTranscriptionModelDefinition>
  >;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface ActiveDownload {
  modelId: SocialMediaTranscriptionModelId;
  downloadId: string;
  controller: AbortController;
  done: Promise<void>;
  cancel(): void;
}

class ModelIntegrityError extends Error {}

export function createWhisperTranscriptionModelManager(
  options: WhisperTranscriptionModelManagerOptions,
): SocialMediaTranscriptionModelManager {
  const models = options.models ?? SOCIAL_MEDIA_TRANSCRIPTION_MODELS;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const activeDownloads = new Map<string, ActiveDownload>();

  function modelPath(modelId: SocialMediaTranscriptionModelId): string {
    return join(options.modelsDir, models[modelId].fileName);
  }

  function manifestPath(modelId: SocialMediaTranscriptionModelId): string {
    return `${modelPath(modelId)}.manifest.json`;
  }

  async function readSelectedModel(): Promise<SocialMediaTranscriptionModelId> {
    return withFileLock(options.selectedModelPath, async () => {
      const selected = socialMediaTranscriptionModelIdSchema.safeParse(
        await readSocialMediaJsonFile(options.selectedModelPath),
      );
      if (selected.success) return selected.data;
      await atomicWritePrivateTextFile(options.selectedModelPath, '"small"\n');
      return "small";
    });
  }

  async function writeState(state: DownloadState): Promise<void> {
    await atomicWritePrivateTextFile(options.downloadStatePath, `${JSON.stringify(state)}\n`);
  }

  async function readState(): Promise<DownloadState | null> {
    const parsed = transcriptionModelDownloadStateSchema.safeParse(
      await readSocialMediaJsonFile(options.downloadStatePath),
    );
    return parsed.success ? parsed.data : null;
  }

  async function isInstalled(modelId: SocialMediaTranscriptionModelId): Promise<boolean> {
    const definition = models[modelId];
    try {
      const [fileInfo, manifestInfo] = await Promise.all([
        lstat(modelPath(modelId)),
        readSocialMediaJsonFile(manifestPath(modelId)),
      ]);
      return (
        fileInfo.isFile() &&
        !fileInfo.isSymbolicLink() &&
        fileInfo.size === definition.sizeBytes &&
        typeof manifestInfo === "object" &&
        manifestInfo !== null &&
        "modelId" in manifestInfo &&
        manifestInfo.modelId === modelId &&
        "sizeBytes" in manifestInfo &&
        manifestInfo.sizeBytes === definition.sizeBytes &&
        "mtimeMs" in manifestInfo &&
        manifestInfo.mtimeMs === fileInfo.mtimeMs &&
        "sha256" in manifestInfo &&
        manifestInfo.sha256 === definition.sha256
      );
    } catch {
      return false;
    }
  }

  async function recoverAbandonedDownload(
    state: DownloadState | null,
  ): Promise<DownloadState | null> {
    if (state?.state !== "downloading") return state;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireFileLock(options.downloadLockPath, [1], 0, 10);
      const latest = await readState();
      if (latest?.downloadId !== state.downloadId || latest.state !== "downloading") return latest;
      const recovered: DownloadState = {
        ...latest,
        state: "failed",
        errorCode: "download-failed",
        updatedAt: Math.max(0, Math.trunc(now())),
      };
      await writeState(recovered);
      return recovered;
    } catch (error) {
      if (isZCodeFileLockTimeoutError(error)) return state;
      throw error;
    } finally {
      await release?.();
    }
  }

  async function buildSetup(): Promise<SocialMediaTranscriptionSetup> {
    await mkdir(options.modelsDir, { recursive: true, mode: 0o700 });
    const [selectedModelId, rawState] = await Promise.all([readSelectedModel(), readState()]);
    const state = await recoverAbandonedDownload(rawState);
    const modelIds = Object.keys(models) as SocialMediaTranscriptionModelId[];
    const modelStatuses = await Promise.all(
      modelIds.map(async (modelId) => ({
        modelId,
        sizeBytes: models[modelId].sizeBytes,
        installed: await isInstalled(modelId),
        downloading: state?.state === "downloading" && state.modelId === modelId,
        downloadedBytes: state?.modelId === modelId ? state.downloadedBytes : 0,
        errorCode: state?.state === "failed" && state.modelId === modelId ? state.errorCode : null,
      })),
    );
    return socialMediaTranscriptionSetupSchema.parse({
      selectedModelId,
      models: modelStatuses,
      updatedAt: Math.max(0, Math.trunc(state?.updatedAt ?? 0), Math.trunc(now())),
    });
  }

  async function publishProgress(
    state: DownloadState,
    downloadedBytes: number,
    onChanged: () => void,
  ): Promise<void> {
    const nextState = { ...state, downloadedBytes, updatedAt: Math.max(0, Math.trunc(now())) };
    await writeState(nextState);
    Object.assign(state, nextState);
    onChanged();
  }

  async function runDownload(
    modelId: SocialMediaTranscriptionModelId,
    state: DownloadState,
    controller: AbortController,
    releaseLock: () => Promise<void>,
    onChanged: () => void,
    active: ActiveDownload,
  ): Promise<void> {
    const definition = models[modelId];
    const partialPath = join(options.modelsDir, `.${definition.fileName}.${state.downloadId}.part`);
    let downloadedBytes = 0;
    let cancelled = false;
    let polling = false;
    const cancellationTimer = setInterval(() => {
      if (polling) return;
      polling = true;
      void readSocialMediaJsonFile(options.cancelRequestPath)
        .then((request) => {
          if (
            typeof request === "object" &&
            request !== null &&
            "downloadId" in request &&
            request.downloadId === state.downloadId
          ) {
            cancelled = true;
            controller.abort();
          }
        })
        .finally(() => {
          polling = false;
        });
    }, 150);
    cancellationTimer.unref?.();

    try {
      const response = await fetcher(definition.downloadUrl, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("Model download request failed");
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength !== definition.sizeBytes
      ) {
        throw new ModelIntegrityError("Model byte size does not match the pinned artifact");
      }
      const digest = createHash("sha256");
      let lastProgressAt = now();
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          downloadedBytes += chunk.byteLength;
          if (downloadedBytes > definition.sizeBytes) {
            callback(new ModelIntegrityError("Model exceeds the pinned artifact size"));
            return;
          }
          digest.update(chunk);
          if (now() - lastProgressAt >= 1_000) {
            lastProgressAt = now();
            void publishProgress(state, downloadedBytes, onChanged).then(
              () => callback(null, chunk),
              (error: unknown) =>
                callback(error instanceof Error ? error : new Error(String(error))),
            );
            return;
          }
          callback(null, chunk);
        },
      });
      const nodeReadable = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      await pipeline(
        nodeReadable,
        progress,
        createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
        { signal: controller.signal },
      );
      const sha256 = digest.digest("hex");
      if (downloadedBytes !== definition.sizeBytes || sha256 !== definition.sha256) {
        throw new ModelIntegrityError("Model failed pinned size or SHA-256 validation");
      }
      await rm(modelPath(modelId), { force: true });
      await rename(partialPath, modelPath(modelId));
      const installedInfo = await stat(modelPath(modelId));
      await atomicWritePrivateTextFile(
        manifestPath(modelId),
        `${JSON.stringify({
          modelId,
          sizeBytes: definition.sizeBytes,
          mtimeMs: installedInfo.mtimeMs,
          sha256: definition.sha256,
        })}\n`,
      );
      await writeState({
        ...state,
        state: "complete",
        downloadedBytes,
        errorCode: null,
        updatedAt: Math.max(0, Math.trunc(now())),
      });
      onChanged();
    } catch (error) {
      cancelled = cancelled || controller.signal.aborted;
      await rm(partialPath, { force: true }).catch(() => undefined);
      const nextState: DownloadState = {
        ...state,
        state: cancelled ? "cancelled" : "failed",
        downloadedBytes: cancelled ? 0 : downloadedBytes,
        errorCode: cancelled
          ? null
          : error instanceof ModelIntegrityError
            ? "integrity-failed"
            : "download-failed",
        updatedAt: Math.max(0, Math.trunc(now())),
      };
      await writeState(nextState).catch(() => undefined);
      onChanged();
    } finally {
      clearInterval(cancellationTimer);
      await rm(options.cancelRequestPath, { force: true }).catch(() => undefined);
      await releaseLock();
      activeDownloads.delete(active.downloadId);
    }
  }

  return {
    getSetup: buildSetup,
    async getInstalledModelPath(modelId) {
      const validatedModelId = socialMediaTranscriptionModelIdSchema.parse(modelId);
      return (await isInstalled(validatedModelId)) ? modelPath(validatedModelId) : null;
    },
    async selectModel(modelId) {
      const validatedModelId = socialMediaTranscriptionModelIdSchema.parse(modelId);
      await withFileLock(options.selectedModelPath, async () => {
        await atomicWritePrivateTextFile(options.selectedModelPath, `"${validatedModelId}"\n`);
      });
      return buildSetup();
    },
    async downloadModel(modelId, onChanged) {
      const validatedModelId = socialMediaTranscriptionModelIdSchema.parse(modelId);
      if (await isInstalled(validatedModelId)) return buildSetup();
      for (const active of activeDownloads.values()) {
        if (active.modelId === validatedModelId) return buildSetup();
      }
      await mkdir(options.modelsDir, { recursive: true, mode: 0o700 });
      let releaseLock: (() => Promise<void>) | undefined;
      try {
        releaseLock = await acquireFileLock(options.downloadLockPath, [20, 40, 80], 0, 250);
      } catch (error) {
        if (isZCodeFileLockTimeoutError(error)) return buildSetup();
        throw error;
      }
      try {
        if (await isInstalled(validatedModelId)) return buildSetup();
        const downloadId = randomUUID();
        await rm(options.cancelRequestPath, { force: true });
        const state: DownloadState = {
          modelId: validatedModelId,
          downloadId,
          state: "downloading",
          downloadedBytes: 0,
          errorCode: null,
          updatedAt: Math.max(0, Math.trunc(now())),
        };
        await writeState(state);
        const controller = new AbortController();
        let resolveDone!: () => void;
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });
        const active: ActiveDownload = {
          modelId: validatedModelId,
          downloadId,
          controller,
          done,
          cancel() {
            controller.abort();
          },
        };
        activeDownloads.set(downloadId, active);
        const ownedLock = releaseLock;
        releaseLock = undefined;
        void runDownload(validatedModelId, state, controller, ownedLock, onChanged, active)
          .catch(() => undefined)
          .finally(resolveDone);
        onChanged();
        return buildSetup();
      } finally {
        await releaseLock?.();
      }
    },
    async cancelDownload(modelId, onChanged) {
      const validatedModelId = socialMediaTranscriptionModelIdSchema.parse(modelId);
      const state = await readState();
      if (state?.state !== "downloading" || state.modelId !== validatedModelId) return buildSetup();
      await atomicWritePrivateTextFile(
        options.cancelRequestPath,
        `${JSON.stringify({ modelId: validatedModelId, downloadId: state.downloadId })}\n`,
      );
      const active = activeDownloads.get(state.downloadId);
      if (active) active.cancel();
      onChanged();
      return buildSetup();
    },
    disposeAll() {
      for (const active of activeDownloads.values()) active.cancel();
    },
    async disposeAllAndWait() {
      this.disposeAll();
      await Promise.all([...activeDownloads.values()].map((active) => active.done));
    },
  };
}
