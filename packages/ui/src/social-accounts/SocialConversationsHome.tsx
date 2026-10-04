import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type {
  SocialAccount,
  SocialAccountConversationWorkspace,
  ZCodeTaskMeta,
} from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useWorkspaceSessionsIndexItems } from "@/v4/useWorkspaceSessionsIndexItems.js";
import { V4ChatPane } from "@/v4/V4ChatPane.js";

type WorkspaceState =
  | { status: "loading" }
  | { status: "ready"; workspace: SocialAccountConversationWorkspace }
  | { status: "error" };

function conversationTitle(session: ZCodeTaskMeta, untitledLabel: string): string {
  return session.title.trim() || untitledLabel;
}

export function SocialConversationsHome({
  account,
  service,
  isDesktop,
  onOpenModelSettings,
}: {
  account: SocialAccount;
  service: SocialAccountService;
  isDesktop: boolean;
  onOpenModelSettings: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ status: "loading" });
  const [workspaceRequestRevision, setWorkspaceRequestRevision] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setWorkspaceState({ status: "loading" });
    void service
      .resolveConversationWorkspace(account.accountId)
      .then((workspace) => {
        if (!current) return;
        setWorkspaceState(workspace ? { status: "ready", workspace } : { status: "error" });
      })
      .catch(() => {
        if (current) setWorkspaceState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [account.accountId, service, workspaceRequestRevision]);

  const workspace = workspaceState.status === "ready" ? workspaceState.workspace : null;
  const workspaceScopes = useMemo(
    () =>
      workspace
        ? [
            {
              workspacePath: workspace.workspacePath,
              workspaceIdentity: workspace.workspaceIdentity,
            },
          ]
        : [],
    [workspace],
  );
  const { items: sessions, hydratingEndpointKeys } =
    useWorkspaceSessionsIndexItems(workspaceScopes);

  const selectSession = useCallback((sessionId: string | null) => {
    setSelectedSessionId(sessionId);
  }, []);
  const retryWorkspace = useCallback(() => {
    setSelectedSessionId(null);
    setWorkspaceRequestRevision((revision) => revision + 1);
  }, []);

  if (workspaceState.status === "loading") {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center text-ui-sm text-foreground-subtle"
        role="status"
      >
        {intl.formatMessage({ id: "socialAccounts.conversations.loadingWorkspace" })}
      </div>
    );
  }

  if (!workspace) {
    return (
      <div
        className="mx-auto mt-8 max-w-xl rounded-lg border border-destructive/30 bg-card p-5"
        role="alert"
      >
        <p className="text-ui-base text-foreground">
          {intl.formatMessage({ id: "socialAccounts.conversations.workspaceUnavailable" })}
        </p>
        <Button className="mt-4" type="button" variant="outline" onClick={retryWorkspace}>
          {intl.formatMessage({ id: "socialAccounts.retry" })}
        </Button>
      </div>
    );
  }

  const orderedSessions = sessions.filter(
    (session) => session.workspaceIdentity === workspace.workspaceIdentity,
  );
  const sessionsLoading = hydratingEndpointKeys.length > 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background md:flex-row">
      <aside className="flex max-h-52 min-h-0 shrink-0 flex-col border-b border-border bg-sidebar md:max-h-none md:w-64 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-ui-base font-semibold">
              {intl.formatMessage({ id: "socialAccounts.nav.conversations" })}
            </h1>
            <p className="truncate text-ui-sm text-foreground-subtle">{account.displayName}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={intl.formatMessage({ id: "socialAccounts.conversations.new" })}
            title={intl.formatMessage({ id: "socialAccounts.conversations.new" })}
            onClick={() => selectSession(null)}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        <div
          className="flex min-h-0 gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden"
          aria-label={intl.formatMessage({ id: "socialAccounts.nav.conversations" })}
        >
          {orderedSessions.map((session) => {
            const active = session.taskId === selectedSessionId;
            return (
              <button
                key={session.taskId}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => selectSession(session.taskId)}
                className={`min-h-12 min-w-44 shrink-0 rounded-md px-3 py-2 text-left text-ui-sm md:min-w-0 ${active ? "bg-card-selected text-foreground" : "text-foreground hover:bg-surface-hover"}`}
              >
                <span className="block truncate font-medium">
                  {conversationTitle(
                    session,
                    intl.formatMessage({ id: "socialAccounts.conversations.untitled" }),
                  )}
                </span>
              </button>
            );
          })}
          {orderedSessions.length === 0 ? (
            <p
              className="px-2 py-3 text-ui-sm text-foreground-subtle"
              role={sessionsLoading ? "status" : undefined}
            >
              {intl.formatMessage({
                id: sessionsLoading
                  ? "socialAccounts.conversations.loading"
                  : "socialAccounts.conversations.empty",
              })}
            </p>
          ) : null}
        </div>
      </aside>
      <section className="min-h-0 min-w-0 flex-1" aria-label={account.displayName}>
        <V4ChatPane
          workspacePath={workspace.workspacePath}
          workspaceIdentity={workspace.workspaceIdentity}
          sessionId={selectedSessionId}
          isDesktop={isDesktop}
          onOpenModelSettings={onOpenModelSettings}
          onSessionCreated={selectSession}
          onSessionDeleted={() => selectSession(null)}
        />
      </section>
    </div>
  );
}
