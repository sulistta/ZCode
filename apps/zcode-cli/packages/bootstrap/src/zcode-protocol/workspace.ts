import {
  parseRemoteWorkspaceIdentity,
  parseSocialAccountWorkspaceIdentity,
  type ZCodeWorkspaceRef,
} from "@social-harness/shared";

export function buildWorkspaceRef(input: {
  workspaceIdentity?: string;
  workspacePath: string;
}): ZCodeWorkspaceRef {
  const workspaceIdentity = input.workspaceIdentity?.trim() || undefined;
  return {
    workspaceIdentity,
    workspaceKey: workspaceIdentity ?? input.workspacePath,
    workspacePath: input.workspacePath,
  };
}

/**
 * 将 V4 workspaceId 的本地路径/远程 identity 双形态统一还原为 workspace ref。
 */
export function resolveWorkspaceRefFromId(
  workspaceId: string,
  physicalWorkspacePath?: string,
): ZCodeWorkspaceRef {
  if (workspaceId.startsWith("social-account:")) {
    // Bug 原因：账号 workspace key 不是文件路径；旧分支把它写入 cwd 并丢弃 identity，
    // 导致 runtime 注册通用工具。Account Service 已解析并验证真实路径，必须保留两者的边界。
    if (!parseSocialAccountWorkspaceIdentity(workspaceId)) {
      throw new Error(`Invalid social account workspace identity: ${workspaceId}`);
    }
    const workspacePath = physicalWorkspacePath?.trim();
    if (!workspacePath) {
      throw new Error("Social account workspace requires a physical workspace path");
    }
    return buildWorkspaceRef({ workspaceIdentity: workspaceId, workspacePath });
  }

  const parsedRemote = parseRemoteWorkspaceIdentity(workspaceId);
  if (!parsedRemote) {
    // 非法 remote identity 若继续按本地路径处理，会再次把 identity 写入
    // directory/path。remote 命名空间必须 fail-closed，本地路径仍保留原 fallback。
    if (workspaceId.startsWith("remote:")) {
      throw new Error(`Invalid remote workspace identity: ${workspaceId}`);
    }
    return buildWorkspaceRef({ workspacePath: workspaceId });
  }

  // 带显式 user 的 WSL identity 以前解析失败后会落入本地路径分支，
  // 使完整 identity 被当成 workingDirectory。这里统一通过 shared parser 拆分身份与路径。
  return buildWorkspaceRef({
    workspaceIdentity: workspaceId,
    workspacePath: parsedRemote.workspacePath,
  });
}
