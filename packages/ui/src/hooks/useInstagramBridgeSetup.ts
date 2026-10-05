import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InstagramBridgeSetup,
  ProvisionInstagramBridgeRequest,
  ConfigureInstagramBridgeMetaRequest,
  IPlatformService,
} from "@social-harness/shared";
import type { SocialInstagramSetupService } from "@social-harness/services";
export function useInstagramBridgeSetup(
  service: SocialInstagramSetupService | undefined,
  platform: IPlatformService,
  onReady: () => void | boolean | Promise<void | boolean>,
) {
  const [setup, setSetup] = useState<InstagramBridgeSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!service) return;
    try {
      const result = await service.getInstagramBridgeSetup();
      if (current === generation.current) setSetup(result);
    } catch {
      if (current === generation.current) setErrorId("socialConvex.error.unavailable");
    }
  }, [service]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const perform = useCallback(
    async (operation: () => Promise<InstagramBridgeSetup>) => {
      const current = ++generation.current;
      setBusy(true);
      setErrorId(null);
      try {
        const result = await operation();
        if (current !== generation.current) return;
        // 等连接 owner 刷新可用性再开放登录，避免按钮读取上一次未配置状态。
        if (result.stage === "ready" && (await onReady()) === false)
          throw { code: "bridge-setup-unavailable" };
        if (current === generation.current) setSetup(result);
      } catch (error) {
        if (current !== generation.current) return;
        const code =
          error && typeof error === "object" && "code" in error ? String(error.code) : "failed";
        const known = [
          "capacity-unavailable",
          "invalid-provisioning-credential",
          "bridge-not-dedicated",
          "bridge-switch-requires-disconnect",
          "bridge-setup-busy",
        ];
        setErrorId(
          known.includes(code) ? `socialConvex.error.${code}` : "socialConvex.error.failed",
        );
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [onReady],
  );
  const provision = useCallback(
    (request: ProvisionInstagramBridgeRequest) =>
      service ? perform(() => service.provisionInstagramBridge(request)) : Promise.resolve(),
    [perform, service],
  );
  const configureMeta = useCallback(
    (request: ConfigureInstagramBridgeMetaRequest) =>
      service ? perform(() => service.configureInstagramBridgeMeta(request)) : Promise.resolve(),
    [perform, service],
  );
  const validate = useCallback(
    () => (service ? perform(() => service.validateInstagramBridgeSetup()) : Promise.resolve()),
    [perform, service],
  );
  const copy = useCallback(
    async (value: string) => {
      try {
        if (!platform.copyTextToClipboard) throw new Error("unavailable");
        await platform.copyTextToClipboard(value);
        setCopied(true);
      } catch {
        setErrorId("socialConvex.error.copy");
      }
    },
    [platform],
  );
  return { setup, busy, errorId, copied, load, provision, configureMeta, validate, copy };
}
