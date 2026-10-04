import { useEffect, useState } from "react";
import type { InstagramConnection, InstagramMedia } from "@social-harness/shared";
import type { SocialPublishingService } from "@social-harness/services";

function mediaErrorMessageId(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "authorization-expired") return "socialAccounts.media.reauthorize";
    if (code === "instagram-not-connected") return "socialAccounts.media.notConnected";
  }
  return "socialAccounts.media.loadFailed";
}

export function useSocialInstagramMedia({
  accountId,
  connectionStatus,
  enabled,
  service,
}: {
  accountId: string | null;
  connectionStatus: InstagramConnection["status"];
  enabled: boolean;
  service?: SocialPublishingService;
}) {
  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessageId, setErrorMessageId] = useState<string | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);

  useEffect(() => {
    if (!enabled || !accountId || !service || connectionStatus !== "connected") {
      setMedia([]);
      setIsLoading(false);
      setErrorMessageId(null);
      return;
    }

    let active = true;
    setMedia([]);
    setIsLoading(true);
    setErrorMessageId(null);
    void service
      .listInstagramMedia({ accountId })
      .then((items) => {
        if (active) setMedia(items);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessageId(mediaErrorMessageId(error));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accountId, connectionStatus, enabled, reloadGeneration, service]);

  return {
    media,
    isLoading,
    errorMessageId,
    reload: () => setReloadGeneration((current) => current + 1),
  };
}
