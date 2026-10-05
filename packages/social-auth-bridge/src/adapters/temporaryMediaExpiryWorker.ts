import { TemporaryMediaStoreError } from "../app/ports/temporaryMediaStore.js";

export const TEMPORARY_MEDIA_CLEANUP_INTERVAL_MS = 60 * 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const activeWorkers = new WeakMap<object, () => void>();

export function startTemporaryMediaExpiryWorker(
  owner: object,
  cleanupExpired: () => Promise<void>,
  options: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
  } = {},
): () => void {
  const intervalMs = options.intervalMs ?? TEMPORARY_MEDIA_CLEANUP_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > MAX_TIMER_DELAY_MS) {
    throw new Error("Temporary media cleanup interval is invalid");
  }
  const existingStop = activeWorkers.get(owner);
  if (existingStop) return existingStop;

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void run(), intervalMs);
    timer.unref();
  };
  const reportFailure = (error: unknown) => {
    if (options.onError) {
      try {
        options.onError(error);
        return;
      } catch {
        process.stderr.write(
          "[social-auth-bridge] temporary-media cleanup error reporter failed\n",
        );
        return;
      }
    }
    const code = error instanceof TemporaryMediaStoreError ? error.code : "unknown";
    process.stderr.write(`[social-auth-bridge] temporary-media cleanup failed (${code})\n`);
  };
  const run = async () => {
    try {
      await cleanupExpired();
    } catch (error) {
      reportFailure(error);
    } finally {
      schedule();
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (activeWorkers.get(owner) === stop) activeWorkers.delete(owner);
  };

  activeWorkers.set(owner, stop);
  schedule();
  return stop;
}
