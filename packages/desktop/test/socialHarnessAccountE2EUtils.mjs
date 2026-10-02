import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolvePlatformKeyForPackagedApp } from "../scripts/target-platform.mjs";

export function resolveE2EMediaTools() {
  const extension = process.platform === "win32" ? ".exe" : "";
  const bundledBinUrl = new URL(
    `../bundled-tools/${resolvePlatformKeyForPackagedApp()}/ffmpeg/bin/`,
    import.meta.url,
  );
  // CI 会将校验过的媒体工具暂存到桌面包目录；Main 只把路径下发给 Host，不会改写此测试进程的环境。
  return {
    ffmpegExecutable:
      process.env.SOCIAL_HARNESS_FFMPEG_PATH?.trim() ||
      fileURLToPath(new URL(`ffmpeg${extension}`, bundledBinUrl)),
    ffprobeExecutable:
      process.env.SOCIAL_HARNESS_FFPROBE_PATH?.trim() ||
      fileURLToPath(new URL(`ffprobe${extension}`, bundledBinUrl)),
  };
}

export async function reserveVitePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a Desktop E2E Vite port");
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

export async function waitForRuntimeOutput(runtime, marker, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (runtime.output.includes(marker)) return;
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      throw new Error(`${label} exited before completion.\n${runtime.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not complete.\n${runtime.output}`);
}

export function assertNoRetiredZCodeProductApiRequests(runtime) {
  const retiredApiMatch = runtime.output.match(
    /\/api\/v1\/client\/(configs|scenes)(?:[/?\s"'<>]|$)/u,
  );
  if (retiredApiMatch) {
    throw new Error(`Social Harness requested the retired ZCode client/${retiredApiMatch[1]} API`);
  }
}
