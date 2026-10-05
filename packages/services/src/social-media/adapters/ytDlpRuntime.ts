import { extname, resolve } from "node:path";

export function buildYtDlpJavaScriptRuntimeArgs(runtimePath = process.execPath): string[] {
  const normalizedPath = runtimePath.trim();
  if (!normalizedPath) throw new Error("yt-dlp requires an explicit JavaScript runtime path");
  return ["--js-runtimes", `node:${normalizedPath}`];
}

export function resolveYtDlpCommand(
  executablePath?: string,
  nodeExecutablePath = process.execPath,
): { executable: string; argsPrefix: string[] } {
  const executable = executablePath?.trim() || "yt-dlp";
  if (extname(executable).toLowerCase() !== ".mjs") {
    return { executable, argsPrefix: [] };
  }
  return { executable: nodeExecutablePath, argsPrefix: [resolve(executable)] };
}

export function buildYtDlpChildEnvironment(
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
  isElectronProcess = Boolean(process.versions.electron),
): NodeJS.ProcessEnv {
  const environment = { ...sourceEnvironment };
  if (isElectronProcess) environment.ELECTRON_RUN_AS_NODE = "1";
  else delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}
