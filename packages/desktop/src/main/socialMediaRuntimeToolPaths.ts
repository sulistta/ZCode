import { existsSync } from "node:fs";
import { join } from "node:path";

export type SocialMediaRuntimeTool = "yt-dlp" | "ffmpeg" | "ffprobe" | "whisper.cpp";

const TOOL_LAYOUT: Record<SocialMediaRuntimeTool, { directory: string; binaryName: string }> = {
  "yt-dlp": { directory: "yt-dlp", binaryName: "yt-dlp" },
  ffmpeg: { directory: "ffmpeg", binaryName: "bin/ffmpeg" },
  ffprobe: { directory: "ffmpeg", binaryName: "bin/ffprobe" },
  "whisper.cpp": { directory: "whisper.cpp", binaryName: "whisper-cli" },
};

export function resolveSocialMediaRuntimeToolPath(options: {
  tool: SocialMediaRuntimeTool;
  packaged: boolean;
  platform: string;
  resourcesPath?: string;
  bundledPath?: string;
  explicitPath?: string;
}): string | undefined {
  const layout = TOOL_LAYOUT[options.tool];
  if (options.packaged) {
    if (options.bundledPath) return options.bundledPath;
    if (!options.resourcesPath)
      throw new Error(`Packaged ${options.tool} resolution requires resourcesPath`);
    const binaryName =
      options.platform === "win32" ? `${layout.binaryName}.exe` : layout.binaryName;
    return join(options.resourcesPath, "tools", layout.directory, binaryName);
  }

  const explicitPath = options.explicitPath?.trim();
  // 开发态显式路径供维护者和隔离测试覆盖本机二进制；先返回 bundledPath 会忽略已声明的 override。
  if (explicitPath && existsSync(explicitPath)) return explicitPath;
  return options.bundledPath;
}

export function resolveYtDlpBinaryPath(options: {
  packaged: boolean;
  platform: string;
  resourcesPath?: string;
  bundledPath?: string;
  explicitPath?: string;
}): string | undefined {
  return resolveSocialMediaRuntimeToolPath({ ...options, tool: "yt-dlp" });
}
