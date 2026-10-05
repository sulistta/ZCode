import { useState } from "react";
import type { FormEvent } from "react";
import type { IPlatformService, InstagramConnection } from "@social-harness/shared";
import type { SocialInstagramSetupService } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useInstagramBridgeSetup } from "@/hooks/useInstagramBridgeSetup.js";
import { AccountField } from "./AccountField.js";
export function SocialInstagramSetup({
  service,
  platform,
  onReady,
  onConnect,
  connectionStatus,
}: {
  service: SocialInstagramSetupService;
  platform: IPlatformService;
  onReady: () => void | boolean | Promise<void | boolean>;
  onConnect: () => void;
  connectionStatus: InstagramConnection["status"];
}) {
  const { intl } = useZCodeIntl();
  const model = useInstagramBridgeSetup(service, platform, onReady);
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const t = (key: string) => intl.formatMessage({ id: `socialConvex.${key}` });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const credential = String(data.get("provisioningCredential") ?? "");
    const deploymentUrl = String(data.get("deploymentUrl") ?? "");
    const projectName = String(data.get("projectName") ?? "");
    // 密码字段只用于一次提交，清空 DOM，不进入 React/Zustand 或本地配置。
    const secretField = form.elements.namedItem("provisioningCredential");
    if (secretField instanceof HTMLInputElement) secretField.value = "";
    data.delete("provisioningCredential");
    void model.provision(
      mode === "existing"
        ? { mode, deploymentUrl, provisioningCredential: credential }
        : { mode, projectName, provisioningCredential: credential },
    );
  };
  const submitMeta = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const request = {
      appId: String(data.get("appId") ?? ""),
      appSecret: String(data.get("appSecret") ?? ""),
      provisioningCredential: String(data.get("provisioningCredential") ?? ""),
    };
    for (const name of ["appSecret", "provisioningCredential"]) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = "";
      data.delete(name);
    }
    void model.configureMeta(request);
  };
  const copyValue = (value: string) => (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <code className="min-w-0 break-all text-ui-sm">{value}</code>
      <Button
        size="sm"
        variant="outline"
        type="button"
        aria-label={`${t("copy")} ${value}`}
        onClick={() => void model.copy(value)}
      >
        {t("copy")}
      </Button>
    </div>
  );
  return (
    <details
      className="rounded-xl border border-border bg-card p-4"
      data-testid="instagram-infrastructure-assistant"
    >
      <summary className="cursor-pointer text-ui-base font-semibold">{t("title")}</summary>
      <div className="mt-4 grid gap-5">
        <p className="text-ui-sm text-foreground-subtle">{t("ownership")}</p>
        <p className="text-ui-sm text-foreground-subtle">{t("freeLimits")}</p>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => platform.openExternal("https://docs.convex.dev/production/state/limits")}
        >
          {t("limitsLink")}
        </Button>
        <section className="grid gap-3" aria-label={t("projectStep")}>
          <h3 className="text-ui-base font-semibold">{t("projectStep")}</h3>
          <p className="text-ui-sm text-foreground-subtle">{t("projectInstructions")}</p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => platform.openExternal("https://dashboard.convex.dev/")}
          >
            {t("openConvex")}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === "existing" ? "default" : "outline"}
              onClick={() => setMode("existing")}
            >
              {t("existing")}
            </Button>
            <Button
              type="button"
              variant={mode === "create" ? "default" : "outline"}
              onClick={() => setMode("create")}
            >
              {t("create")}
            </Button>
          </div>
          <p className="text-ui-sm text-foreground-subtle">
            {t(mode === "existing" ? "keyInstructions" : "teamInstructions")}
          </p>
          <form onSubmit={submit} className="grid gap-3">
            {mode === "existing" ? (
              <AccountField label={t("deploymentUrl")}>
                <Input
                  name="deploymentUrl"
                  type="url"
                  defaultValue={model.setup?.deploymentUrl ?? ""}
                  placeholder="https://your-deployment.convex.cloud"
                  required
                />
              </AccountField>
            ) : (
              <AccountField label={t("projectName")}>
                <Input
                  name="projectName"
                  defaultValue="Social Harness Instagram"
                  maxLength={64}
                  required
                />
              </AccountField>
            )}
            <AccountField label={t(mode === "existing" ? "deployKey" : "teamToken")}>
              <Input
                name="provisioningCredential"
                type="password"
                autoComplete="off"
                required
                minLength={20}
                maxLength={8192}
                data-private="true"
              />
            </AccountField>
            <Button className="w-fit" type="submit" disabled={model.busy}>
              {t(model.busy ? "working" : "deploy")}
            </Button>
          </form>
        </section>
        <section className="grid gap-3" aria-label={t("metaStep")}>
          <h3 className="text-ui-base font-semibold">{t("metaStep")}</h3>
          <p className="text-ui-sm text-foreground-subtle">{t("metaInstructions")}</p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => platform.openExternal("https://developers.facebook.com/apps/")}
          >
            {t("openMeta")}
          </Button>
          {model.setup?.callbackUrl ? (
            copyValue(model.setup.callbackUrl)
          ) : (
            <p className="text-ui-sm text-foreground-subtle">{t("callbackPending")}</p>
          )}
          <p className="text-ui-sm text-foreground-subtle">{t("accessInstructions")}</p>
        </section>
        {model.setup?.deploymentUrl ? (
          <section className="grid gap-3" aria-label={t("secretStep")}>
            <h3 className="text-ui-base font-semibold">{t("secretStep")}</h3>
            <p className="text-ui-sm text-foreground-subtle">{t("secretInstructions")}</p>
            <form onSubmit={submitMeta} className="grid gap-3">
              <AccountField label={t("appId")}>
                <Input name="appId" inputMode="numeric" pattern="[0-9]{5,30}" required />
              </AccountField>
              <AccountField label={t("appSecret")}>
                <Input
                  name="appSecret"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={16}
                  data-private="true"
                />
              </AccountField>
              <AccountField label={t("deployKey")}>
                <Input
                  name="provisioningCredential"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={20}
                  data-private="true"
                />
              </AccountField>
              <Button className="w-fit" type="submit" disabled={model.busy}>
                {t("saveMeta")}
              </Button>
            </form>
            <p className="text-ui-sm text-foreground-subtle">{t("manualMeta")}</p>
            {copyValue("META_INSTAGRAM_APP_ID")}
            {copyValue("META_INSTAGRAM_APP_SECRET")}
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => platform.openExternal(model.setup!.dashboardUrl)}
            >
              {t("openSettings")}
            </Button>
          </section>
        ) : null}
        <section className="grid gap-3" aria-label={t("validateStep")}>
          <h3 className="text-ui-base font-semibold">{t("validateStep")}</h3>
          <p className="text-ui-sm text-foreground-subtle">{t("validationInstructions")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={model.busy || !model.setup?.deploymentUrl}
              onClick={() => void model.validate()}
            >
              {t("validate")}
            </Button>
            {model.setup?.stage === "ready" && connectionStatus !== "connected" ? (
              <Button
                type="button"
                disabled={connectionStatus === "connecting"}
                onClick={onConnect}
              >
                {t("login")}
              </Button>
            ) : null}
          </div>
          {model.setup?.stage === "ready" ? (
            <p role="status" className="text-ui-sm text-success">
              {t("ready")}
            </p>
          ) : null}
          {model.setup?.backendVersion && !model.setup.metaConfigured ? (
            <p role="status" className="text-ui-sm text-foreground-subtle">
              {t("metaMissing")}
            </p>
          ) : null}
          {connectionStatus === "connected" ? (
            <p role="status" className="text-ui-sm text-success">
              {t("connected")}
            </p>
          ) : null}
        </section>
        {model.errorId ? (
          <div role="alert" className="grid gap-2 text-ui-sm text-destructive">
            <p>{intl.formatMessage({ id: model.errorId })}</p>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={model.busy}
              onClick={() => void model.load()}
            >
              {t("reload")}
            </Button>
          </div>
        ) : null}
        {model.copied ? (
          <p role="status" className="text-ui-sm text-success">
            {t("copied")}
          </p>
        ) : null}
      </div>
    </details>
  );
}
