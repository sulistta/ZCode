import { getPathLeaf } from "@/lib/path.js";

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getWorkspaceFileRelativePath(workspacePath: string, filePath: string): string {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  const normalizedFilePath = normalizeWorkspacePath(filePath);

  if (normalizedWorkspacePath === normalizedFilePath) {
    return ".";
  }

  const workspacePrefix = `${normalizedWorkspacePath}/`;
  if (normalizedFilePath.startsWith(workspacePrefix)) {
    return normalizedFilePath.slice(workspacePrefix.length);
  }

  return getPathLeaf(filePath);
}

export function isWorkspaceFilePathInside(workspacePath: string, filePath: string): boolean {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  const normalizedFilePath = normalizeWorkspacePath(filePath);
  return (
    normalizedFilePath === normalizedWorkspacePath ||
    normalizedFilePath.startsWith(`${normalizedWorkspacePath}/`)
  );
}
