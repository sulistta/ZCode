import { useCallback, useEffect, useState } from "react";
import type {
  SocialMediaService,
  SocialMediaTranscriptionModelId,
  SocialMediaTranscriptionSetup,
} from "@social-harness/services";

export function useSocialMediaTranscriptionSetup(service: SocialMediaService) {
  const [setup, setSetup] = useState<SocialMediaTranscriptionSetup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await service.getTranscriptionSetup();
      setSetup(next);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    const subscription = service.onTranscriptionSetupChanged(() => void refresh());
    void refresh();
    return () => subscription.dispose();
  }, [refresh, service]);

  const hasActiveDownload = Boolean(setup?.models.some((model) => model.downloading));
  useEffect(() => {
    if (!hasActiveDownload) return;
    const timer = setInterval(() => void refresh(), 1_500);
    return () => clearInterval(timer);
  }, [hasActiveDownload, refresh]);

  const runAction = useCallback(
    async (action: () => Promise<SocialMediaTranscriptionSetup>): Promise<void> => {
      if (isBusy) return;
      setIsBusy(true);
      setActionFailed(false);
      try {
        setSetup(await action());
      } catch {
        setActionFailed(true);
      } finally {
        setIsBusy(false);
        void refresh();
      }
    },
    [isBusy, refresh],
  );

  const selectModel = useCallback(
    (modelId: SocialMediaTranscriptionModelId) =>
      runAction(() => service.selectTranscriptionModel({ modelId })),
    [runAction, service],
  );
  const downloadModel = useCallback(
    (modelId: SocialMediaTranscriptionModelId) =>
      runAction(() => service.downloadTranscriptionModel({ modelId })),
    [runAction, service],
  );
  const cancelDownload = useCallback(
    (modelId: SocialMediaTranscriptionModelId) =>
      runAction(() => service.cancelTranscriptionModelDownload({ modelId })),
    [runAction, service],
  );

  return {
    setup,
    isLoading,
    isBusy,
    loadFailed,
    actionFailed,
    hasActiveDownload,
    refresh,
    selectModel,
    downloadModel,
    cancelDownload,
  };
}
