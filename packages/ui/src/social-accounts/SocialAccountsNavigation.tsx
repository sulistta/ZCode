import {
  CalendarClock,
  LibraryBig,
  MessageSquareText,
  Play,
  Plus,
  Settings2,
  UserRound,
} from "lucide-react";
import type { InstagramConnection, SocialAccount } from "@social-harness/shared";
import type { SocialMediaView } from "./socialAccountsModel.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const NAV_ITEMS = [
  { id: "accounts", labelId: "socialAccounts.nav.accounts", icon: UserRound },
  { id: "conversations", labelId: "socialAccounts.nav.conversations", icon: MessageSquareText },
  { id: "library", labelId: "socialAccounts.nav.library", icon: LibraryBig },
  { id: "player", labelId: "socialAccounts.nav.player", icon: Play },
  { id: "automations", labelId: "socialAccounts.nav.automations", icon: CalendarClock },
] as const;

const CONNECTION_LABELS: Record<InstagramConnection["status"], string> = {
  disconnected: "socialAccounts.connection.disconnected",
  connecting: "socialAccounts.connection.connecting",
  connected: "socialAccounts.connection.connected",
  "reauth-required": "socialAccounts.connection.reauthRequired",
};

export function SocialAccountsNavigation({
  accounts,
  connectionByAccount,
  selectedAccountId,
  isCreating,
  activeView,
  canOpenConversations,
  canOpenLibrary,
  canOpenPlayer,
  canOpenAutomations,
  isDesktop,
  onNavigate,
  onCreate,
  onSelect,
}: {
  accounts: SocialAccount[];
  connectionByAccount: Record<string, InstagramConnection | undefined>;
  selectedAccountId: string | null;
  isCreating: boolean;
  activeView: SocialMediaView;
  canOpenConversations: boolean;
  canOpenLibrary: boolean;
  canOpenPlayer: boolean;
  canOpenAutomations: boolean;
  isDesktop: boolean;
  onNavigate: (view: SocialMediaView) => void;
  onCreate: () => void;
  onSelect: (accountId: string) => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <>
      <aside
        className={`min-h-0 overflow-y-auto border-b border-border bg-sidebar px-3 md:border-r md:border-b-0 ${isDesktop ? "pt-14" : "py-4"}`}
      >
        <div className="mb-3 flex items-baseline justify-between gap-2 px-2 md:mb-6 md:block">
          <div className="text-ui-base font-semibold">
            {intl.formatMessage({ id: "socialAccounts.brand" })}
          </div>
          <div className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialAccounts.localFirst" })}
          </div>
        </div>
        <nav
          aria-label={intl.formatMessage({ id: "socialAccounts.brand" })}
          className="flex gap-1 overflow-x-auto md:grid md:overflow-visible"
        >
          {NAV_ITEMS.map(({ id, labelId, icon: Icon }) => {
            const active = id === activeView;
            const enabled =
              id === "accounts" ||
              (id === "conversations" && canOpenConversations) ||
              (id === "library" && canOpenLibrary) ||
              (id === "player" && canOpenPlayer) ||
              (id === "automations" && canOpenAutomations);
            const label = intl.formatMessage({ id: labelId });
            return (
              <button
                key={id}
                type="button"
                disabled={!enabled}
                onClick={() => {
                  if (
                    id === "accounts" ||
                    id === "conversations" ||
                    id === "library" ||
                    id === "player" ||
                    id === "automations"
                  ) {
                    onNavigate(id);
                  }
                }}
                aria-current={active ? "page" : undefined}
                title={
                  enabled
                    ? undefined
                    : id === "automations"
                      ? intl.formatMessage({
                          id: !isDesktop
                            ? "socialAccounts.automations.desktopOnly"
                            : "socialAccounts.automations.selectAccount",
                        })
                      : intl.formatMessage({ id: "socialAccounts.nav.comingSoon" })
                }
                className={`flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-left text-ui-base ${active ? "bg-selected text-foreground" : enabled ? "text-foreground hover:bg-surface-hover" : "cursor-not-allowed text-foreground-subtlest"}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          data-testid="social-model-settings-open"
          aria-current={activeView === "model-settings" ? "page" : undefined}
          onClick={() => onNavigate("model-settings")}
          className={`mt-3 flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-ui-base ${activeView === "model-settings" ? "bg-selected text-foreground" : "text-foreground-subtle hover:bg-surface-hover hover:text-foreground"}`}
        >
          <Settings2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {intl.formatMessage({ id: "socialAccounts.nav.modelSettings" })}
          </span>
        </button>
      </aside>

      <aside
        className={`min-h-0 overflow-y-auto border-b border-border px-3 md:border-r md:border-b-0 ${isDesktop ? "pt-14" : "py-4"}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-2">
          <h2 className="text-ui-base font-semibold">
            {intl.formatMessage({
              id:
                activeView === "conversations" || activeView === "accounts"
                  ? "socialAccounts.nav.accounts"
                  : activeView === "library"
                    ? "socialAccounts.nav.library"
                    : activeView === "player"
                      ? "socialAccounts.nav.player"
                      : activeView === "automations"
                        ? "socialAccounts.nav.automations"
                        : activeView === "model-settings"
                          ? "socialAccounts.nav.modelSettings"
                          : "socialAccounts.nav.accounts",
            })}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={intl.formatMessage({ id: "socialAccounts.create" })}
            onClick={onCreate}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        <div
          className="flex gap-1 overflow-x-auto md:grid md:overflow-visible"
          aria-label={intl.formatMessage({ id: "socialAccounts.nav.accounts" })}
        >
          {accounts.map((account) => {
            const active = selectedAccountId === account.accountId && !isCreating;
            const connection = connectionByAccount[account.accountId];
            return (
              <button
                key={account.accountId}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(account.accountId)}
                className={`flex min-h-12 min-w-40 shrink-0 flex-col items-start justify-center gap-0.5 rounded-md px-3 text-left md:min-w-0 ${active ? "bg-card-selected text-foreground" : "text-foreground hover:bg-surface-hover"}`}
              >
                <span className="w-full truncate text-ui-base">{account.displayName}</span>
                <span className="text-ui-sm text-foreground-subtle">
                  {connection?.status === "connected" && connection.profile
                    ? `@${connection.profile.username}`
                    : intl.formatMessage({
                        id: CONNECTION_LABELS[connection?.status ?? "disconnected"],
                      })}
                </span>
              </button>
            );
          })}
          {isCreating ? (
            <div className="shrink-0 rounded-md bg-card-selected px-3 py-2 text-ui-base">
              {intl.formatMessage({ id: "socialAccounts.newAccount" })}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
