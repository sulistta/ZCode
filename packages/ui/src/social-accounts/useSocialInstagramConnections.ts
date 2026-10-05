import { useCallback, useEffect, useRef, useState } from "react";
import type { IPlatformService, InstagramConnection, SocialAccount } from "@social-harness/shared";
import type { SocialPublishingService } from "@social-harness/services";

export type SocialInstagramAuthorizationAvailability =
  | "checking"
  | "available"
  | "unavailable"
  | "failed";

function connectionErrorMessageId(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "capacity-unavailable"
  )
    return "socialConvex.error.capacity-unavailable";
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "authorization-unavailable"
  ) {
    return "socialAccounts.connection.notConfigured";
  }
  return "socialAccounts.connection.failed";
}

export function useSocialInstagramConnections({
  accounts,
  service,
  platform,
  isDesktop,
}: {
  accounts: SocialAccount[];
  service?: SocialPublishingService;
  platform: IPlatformService;
  isDesktop: boolean;
}) {
  const [connectionByAccount, setConnectionByAccount] = useState<
    Record<string, InstagramConnection | undefined>
  >({});
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [errorMessageId, setErrorMessageId] = useState<string | null>(null);
  const [noticeMessageId, setNoticeMessageId] = useState<string | null>(null);
  const [authorizationAvailability, setAuthorizationAvailability] =
    useState<SocialInstagramAuthorizationAvailability>(
      service && isDesktop ? "checking" : "unavailable",
    );
  const availabilityRequestId = useRef(0);

  const reloadAuthorizationAvailability = useCallback(async () => {
    const requestId = ++availabilityRequestId.current;
    if (!service || !isDesktop) {
      setAuthorizationAvailability("unavailable");
      return false;
    }
    setAuthorizationAvailability("checking");
    try {
      const available = await service.isInstagramAuthorizationAvailable();
      if (availabilityRequestId.current !== requestId) return;
      setAuthorizationAvailability(available ? "available" : "unavailable");
      return available;
    } catch {
      if (availabilityRequestId.current !== requestId) return;
      setAuthorizationAvailability("failed");
      return false;
    }
  }, [isDesktop, service]);

  useEffect(() => {
    void reloadAuthorizationAvailability();
    return () => {
      availabilityRequestId.current += 1;
    };
  }, [reloadAuthorizationAvailability]);

  useEffect(() => {
    if (!service) {
      setConnectionByAccount({});
      return;
    }
    let active = true;
    const changedAccountIds = new Set<string>();
    const eventGenerations = new Map<string, number>();
    const subscription = service.onConnectionChanged(({ accountId }) => {
      changedAccountIds.add(accountId);
      const generation = (eventGenerations.get(accountId) ?? 0) + 1;
      eventGenerations.set(accountId, generation);
      void service
        .getConnection(accountId)
        .then((connection) => {
          if (!active || eventGenerations.get(accountId) !== generation || !connection) return;
          setConnectionByAccount((current) => ({ ...current, [accountId]: connection }));
        })
        .catch(() => {
          if (active) setErrorMessageId("socialAccounts.connection.loadFailed");
        });
    });
    void service
      .listConnections()
      .then((connections) => {
        if (!active) return;
        setConnectionByAccount((current) => {
          const next = { ...current };
          for (const connection of connections) {
            if (!changedAccountIds.has(connection.accountId)) {
              next[connection.accountId] = connection;
            }
          }
          return next;
        });
      })
      .catch(() => {
        if (active) setErrorMessageId("socialAccounts.connection.loadFailed");
      });
    return () => {
      active = false;
      subscription.dispose();
    };
  }, [accounts, service]);

  useEffect(() => {
    if (!service || !isDesktop) return;
    const disposeOAuth = platform.onOAuthCallback(async (callbackUrl) => {
      let url: URL;
      try {
        url = new URL(callbackUrl);
      } catch {
        return;
      }
      if (url.searchParams.get("_oauth_provider") !== "instagram") return;
      const state = url.searchParams.get("state");
      const handoffTicket = url.searchParams.get("code");
      if (!state || !handoffTicket) {
        setErrorMessageId("socialAccounts.connection.failed");
        return;
      }
      try {
        await service.completeInstagramConnection({ state, handoffTicket });
        setErrorMessageId(null);
        setNoticeMessageId("socialAccounts.connection.connected");
      } catch (error) {
        setNoticeMessageId(null);
        setErrorMessageId(connectionErrorMessageId(error));
      }
    });
    // Social Accounts 未挂载旧 Root OAuth effect，导致 Main 一直排队回调。
    // 必须先安装接收器再发送既有 ready 握手，才能投递票据并由 Host 保存连接。
    platform.notifyRendererReady();
    return disposeOAuth;
  }, [isDesktop, platform, service]);

  const connect = useCallback(
    async (accountId: string) => {
      if (!service || !isDesktop || authorizationAvailability !== "available" || busyAccountId)
        return;
      setBusyAccountId(accountId);
      setErrorMessageId(null);
      setNoticeMessageId(null);
      try {
        const pending = await service.startInstagramConnection({ accountId });
        platform.registerOAuthState({ state: pending.state, provider: "instagram" });
        platform.openExternal(pending.authorizeUrl);
        setNoticeMessageId("socialAccounts.connection.browserOpened");
      } catch (error) {
        setErrorMessageId(connectionErrorMessageId(error));
      } finally {
        setBusyAccountId(null);
      }
    },
    [authorizationAvailability, busyAccountId, isDesktop, platform, service],
  );

  const disconnect = useCallback(
    async (accountId: string) => {
      if (!service || busyAccountId) return;
      setBusyAccountId(accountId);
      setErrorMessageId(null);
      setNoticeMessageId(null);
      try {
        await service.disconnectInstagram({ accountId });
      } catch {
        setErrorMessageId("socialAccounts.connection.disconnectFailed");
      } finally {
        setBusyAccountId(null);
      }
    },
    [busyAccountId, service],
  );

  return {
    connectionByAccount,
    authorizationAvailability,
    busyAccountId,
    errorMessageId,
    noticeMessageId,
    connect,
    disconnect,
    reloadAuthorizationAvailability,
  };
}
