interface RunMembership {
  cwd?: string;
  parentSessionId?: string;
}

/** 只收窄已有 run owner 的能力；不复制注册表、journal 或运行状态。 */
export function createSocialWorkflowRunAccess(input: {
  capabilityScope?: "social-account";
  accountWorkspacePath?: string;
  parentSessionId: string;
  findRun: (runId: string) => RunMembership | undefined;
}) {
  const account = input.capabilityScope === "social-account";
  const allowsWorkspace = (cwd: string) =>
    !account || Boolean(input.accountWorkspacePath && cwd === input.accountWorkspacePath);
  const allowsRead = (id: string) => {
    if (!account) return true;
    const run = input.findRun(id);
    return Boolean(run?.cwd && allowsWorkspace(run.cwd));
  };
  return {
    allowsRead,
    allowsWorkspace,
    allowsMutation(id: string) {
      return (
        !account || (allowsRead(id) && input.findRun(id)?.parentSessionId === input.parentSessionId)
      );
    },
    assertSubmit(request: RunMembership & { scriptPath?: string }) {
      // 历史 ID 读面跨项目开放；账户端口必须在细节查询和引擎启动前验证可信归属。
      if (
        account &&
        (!request.cwd ||
          !allowsWorkspace(request.cwd) ||
          request.parentSessionId !== input.parentSessionId ||
          request.scriptPath !== undefined)
      )
        throw new Error("Account workflow scope does not allow this source or parent.");
    },
  };
}
