import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovedWorkflowSnapshot,
  SocialAccount,
  ZCodeSavedWorkflowEntry,
  ZCodeSavedWorkflowMeta,
  ZCodeSavedWorkflowRun,
} from "@social-harness/shared";
import { approvedWorkflowSnapshotSchema } from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { useServices } from "./useServices.js";
import {
  useSavedWorkflowLauncher,
  type SavedWorkflowLaunchTarget,
} from "./useSavedWorkflowLauncher.js";

export interface AccountRecipeDraft {
  name: string;
  meta: ZCodeSavedWorkflowMeta;
  script: string;
}

export function useSocialAccountRecipes({
  account,
  accountService,
  onOpenConversation,
}: {
  account: SocialAccount;
  accountService: SocialAccountService;
  onOpenConversation: (sessionId: string) => void;
}) {
  const { zcodeAgentService } = useServices();
  const [target, setTarget] = useState<SavedWorkflowLaunchTarget | null>(null);
  const [recipes, setRecipes] = useState<ZCodeSavedWorkflowEntry[]>([]);
  const [runs, setRuns] = useState<ZCodeSavedWorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const action = useRef(false);
  const readRequest = useRef(0);
  const navigationTarget = useRef<SavedWorkflowLaunchTarget | null>(null);
  const launcher = useSavedWorkflowLauncher({
    agentService: zcodeAgentService,
    onNavigate: (workspace, sessionId) => {
      // 切换账户后旧 ACK 不能改变当前导航；执行仍归原账户的 Host/journal。
      if (
        navigationTarget.current?.workspaceIdentity === workspace.workspaceIdentity &&
        navigationTarget.current?.workspacePath === workspace.workspacePath
      )
        onOpenConversation(sessionId);
    },
  });

  const read = useCallback(
    async (workspace: SavedWorkflowLaunchTarget, revision: number) => {
      const request = ++readRequest.current;
      const [definitions, history] = await Promise.all([
        zcodeAgentService.listSavedWorkflows({ ...workspace, scope: "project" }),
        zcodeAgentService.listSavedWorkflowRuns({ ...workspace, scope: "project", limit: 20 }),
      ]);
      if (generation.current !== revision || readRequest.current !== request) return;
      setRecipes(definitions.workflows.filter((recipe) => recipe.scope === "project"));
      setRuns(history.runs);
      if (definitions.invalid.length) setError("socialAccounts.recipes.invalidDefinitions");
    },
    [zcodeAgentService],
  );

  useEffect(() => {
    const revision = ++generation.current;
    setLoading(true);
    setTarget(null);
    setRecipes([]);
    setRuns([]);
    setError(null);
    void (async () => {
      const workspace = await accountService.resolveConversationWorkspace(account.accountId);
      if (generation.current !== revision) return;
      if (!workspace || workspace.workspaceIdentity !== account.workspaceIdentity)
        throw new Error("socialAccounts.recipes.unavailable");
      const resolved = {
        workspacePath: workspace.workspacePath,
        workspaceIdentity: workspace.workspaceIdentity,
      };
      setTarget(resolved);
      navigationTarget.current = resolved;
      await read(resolved, revision);
    })()
      .catch(() => {
        if (generation.current === revision) setError("socialAccounts.recipes.unavailable");
      })
      .finally(() => {
        if (generation.current === revision) setLoading(false);
      });
    return () => {
      generation.current++;
      navigationTarget.current = null;
    };
  }, [account.accountId, account.workspaceIdentity, accountService, read]);

  const refresh = useCallback(async () => {
    if (!target) return;
    const revision = generation.current;
    setLoading(true);
    setError(null);
    try {
      await read(target, revision);
    } catch {
      if (generation.current === revision) setError("socialAccounts.recipes.unavailable");
    } finally {
      if (generation.current === revision) setLoading(false);
    }
  }, [read, target]);

  const perform = useCallback(
    async <T>(
      operation: (workspace: SavedWorkflowLaunchTarget, revision: number) => Promise<T>,
    ): Promise<T | null> => {
      if (!target || action.current) return null;
      const revision = generation.current;
      action.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await operation(target, revision);
        return generation.current === revision ? result : null;
      } catch (failure) {
        if (generation.current === revision)
          setError(
            failure instanceof Error ? failure.message : "socialAccounts.recipes.actionFailed",
          );
        return null;
      } finally {
        action.current = false;
        if (generation.current === revision) setBusy(false);
      }
    },
    [target],
  );

  const save = useCallback(
    (draft: AccountRecipeDraft) =>
      perform(async (workspace, revision) => {
        const result = await zcodeAgentService.saveSavedWorkflow({
          ...workspace,
          scope: "project",
          ...draft,
        });
        if (!result.ok) throw new Error(result.detail || "socialAccounts.recipes.actionFailed");
        await read(workspace, revision);
        return true;
      }),
    [perform, read, zcodeAgentService],
  );

  const get = useCallback(
    (name: string) =>
      perform(async (workspace) => {
        const result = await zcodeAgentService.getSavedWorkflow({
          ...workspace,
          scope: "project",
          name,
        });
        if (!result.ok || result.scope !== "project" || result.name !== name)
          throw new Error("socialAccounts.recipes.actionFailed");
        return { name: result.name, meta: result.meta, script: result.script };
      }),
    [perform, zcodeAgentService],
  );

  const run = useCallback(
    (snapshot: ApprovedWorkflowSnapshot) =>
      perform(async (workspace) => {
        const approved = approvedWorkflowSnapshotSchema.parse(snapshot);
        const result = await launcher.launch(workspace, {
          name: approved.name,
          scope: "project",
          args: {},
          approvedSnapshot: approved,
        });
        if (!result.ok)
          throw new Error(result.error.message || "socialAccounts.recipes.actionFailed");
        return result;
      }),
    [launcher.launch, perform],
  );

  return {
    recipes,
    runs,
    loading,
    busy: busy || launcher.pending,
    error,
    available: target !== null,
    refresh,
    save,
    get,
    run,
  };
}
