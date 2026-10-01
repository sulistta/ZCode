import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SocialProjectExportArtifactReader } from "../app/ports/socialProjectExportArtifactReader.js";

interface SocialProjectExportArtifactReaderOptions {
  exportDirectory: string;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function createSocialProjectExportArtifactReader(
  options: SocialProjectExportArtifactReaderOptions,
): SocialProjectExportArtifactReader {
  return {
    async open(input) {
      if (!/^[0-9a-f-]{36}$/iu.test(input.exportId)) throw new Error("Export is unavailable");
      const path = join(options.exportDirectory, `${input.exportId}.mp4`);
      const [root, actualPath, linkInfo] = await Promise.all([
        realpath(options.exportDirectory),
        realpath(path),
        lstat(path),
      ]);
      const fileInfo = await stat(actualPath);
      if (
        !linkInfo.isFile() ||
        linkInfo.isSymbolicLink() ||
        dirname(actualPath) !== root ||
        !fileInfo.isFile() ||
        fileInfo.size !== input.expectedFileSizeBytes ||
        (await sha256File(actualPath)) !== input.expectedSha256
      ) {
        throw new Error("Export verification failed");
      }
      return openAsBlob(actualPath, { type: "video/mp4" });
    },
  };
}
