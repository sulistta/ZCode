import { readFile } from "node:fs/promises";

export async function readSocialMediaJsonFile(filePath: string): Promise<unknown | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}
