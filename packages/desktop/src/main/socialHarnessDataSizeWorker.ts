import { isMainThread, parentPort, workerData } from "node:worker_threads";

import {
  scanSocialHarnessDataDirectory,
  type SocialHarnessDataSizeScanRequest,
} from "./socialHarnessDataSizeScanner.js";

type WorkerResponse =
  | { ok: true; result: Awaited<ReturnType<typeof scanSocialHarnessDataDirectory>> }
  | { ok: false; error: string };

const workerParentPort = parentPort;
if (!isMainThread && workerParentPort) {
  void scanSocialHarnessDataDirectory(workerData as SocialHarnessDataSizeScanRequest)
    .then((result) => {
      workerParentPort.postMessage({ ok: true, result } satisfies WorkerResponse);
    })
    .catch((error) => {
      workerParentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "unknown worker error",
      } satisfies WorkerResponse);
    });
}
