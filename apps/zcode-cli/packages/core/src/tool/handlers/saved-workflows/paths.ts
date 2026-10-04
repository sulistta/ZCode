import { homedir } from "node:os";
import { join } from "node:path";
import {
  SAVED_WORKFLOW_FILE_EXTENSION,
  SAVED_WORKFLOW_GLOBAL_DIR,
  SAVED_WORKFLOW_PROJECT_DIR,
  isValidSavedWorkflowName,
  type SavedWorkflowScope,
} from "@social-harness/contracts";
import { parseSocialAccountWorkspaceIdentity } from "@social-harness/shared";

export interface SavedWorkflowRoot {
  scope: SavedWorkflowScope;
  dir: string;
}

export interface SavedWorkflowRootsOptions {
  homeDir?: string;
  dataBaseDir?: string;
  /** Host 验证过的身份；模型不能通过工具参数覆盖。 */
  workspaceIdentity?: string;
}

export function isAccountRecipeWorkspace(identity: string | undefined): boolean {
  if (!identity?.startsWith("social-account:")) return false;
  if (!parseSocialAccountWorkspaceIdentity(identity))
    throw new Error("Invalid account recipe workspace identity.");
  return true;
}

export function assertAccountWorkflowSource(
  identity: string | undefined,
  source: { scope?: SavedWorkflowScope; path?: string; scriptPath?: string },
): void {
  if (!isAccountRecipeWorkspace(identity)) return;
  // 原有全局目录和任意文件来源绕过账户隔离；必须在读取及审批之前拒绝。
  if (source.scope === "global" || source.path !== undefined || source.scriptPath !== undefined)
    throw new Error("Account recipes only use account project scope and inline or saved scripts.");
}

export function savedWorkflowRoots(
  cwd: string,
  options?: SavedWorkflowRootsOptions,
): SavedWorkflowRoot[] {
  const project: SavedWorkflowRoot = {
    scope: "project",
    dir: join(cwd, SAVED_WORKFLOW_PROJECT_DIR),
  };
  if (isAccountRecipeWorkspace(options?.workspaceIdentity)) return [project];
  return [
    project,
    {
      scope: "global",
      dir: join(
        options?.dataBaseDir?.trim() ||
          process.env.SOCIAL_HARNESS_DATA_BASE_DIR?.trim() ||
          options?.homeDir ||
          homedir(),
        SAVED_WORKFLOW_GLOBAL_DIR,
      ),
    },
  ];
}

export function savedWorkflowRoot(
  cwd: string,
  scope: SavedWorkflowScope,
  options?: SavedWorkflowRootsOptions,
): SavedWorkflowRoot {
  const root = savedWorkflowRoots(cwd, options).find((item) => item.scope === scope);
  if (!root) throw new Error("Account recipes only use account project scope.");
  return root;
}

export function savedWorkflowFileName(name: string): string {
  if (!isValidSavedWorkflowName(name)) throw new Error("Invalid saved workflow name.");
  return `${name}${SAVED_WORKFLOW_FILE_EXTENSION}`;
}

export function savedWorkflowPath(root: SavedWorkflowRoot, name: string): string {
  return join(root.dir, savedWorkflowFileName(name));
}
