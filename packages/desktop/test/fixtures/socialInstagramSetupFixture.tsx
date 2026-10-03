import { useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  IPlatformService,
  InstagramBridgeSetup,
  InstagramConnection,
} from "@social-harness/shared";
import type { SocialInstagramSetupService } from "@social-harness/services";
import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.js";
import { SocialInstagramSetup } from "../../../ui/src/social-accounts/SocialInstagramSetup.js";

declare global {
  interface Window {
    setupFixture: {
      copied: string[];
      opened: string[];
      provisions: number;
      configs: number;
      releaseReady: (() => void) | null;
    };
  }
}
const fixture = (window.setupFixture = {
  copied: [],
  opened: [],
  provisions: 0,
  configs: 0,
  releaseReady: null,
} as Window["setupFixture"]);
let setup: InstagramBridgeSetup = {
  stage: "project",
  deploymentUrl: null,
  callbackUrl: null,
  dashboardUrl: "https://dashboard.convex.dev/",
  metaDashboardUrl: "https://developers.facebook.com/apps/",
  backendVersion: null,
  metaConfigured: false,
};
let metaConfigured = false;
let quotaFailed = false;
const service: SocialInstagramSetupService = {
  getInstagramBridgeSetup: async () => setup,
  provisionInstagramBridge: async (request) => {
    fixture.provisions++;
    if (request.provisioningCredential.includes("invalid"))
      throw { code: "invalid-provisioning-credential" };
    if (request.provisioningCredential.includes("quota") && !quotaFailed) {
      quotaFailed = true;
      throw { code: "capacity-unavailable" };
    }
    const deploymentUrl =
      request.mode === "existing" ? request.deploymentUrl : "https://fixture-123.convex.cloud/";
    setup = {
      ...setup,
      stage: "meta",
      deploymentUrl,
      callbackUrl: `${new URL(deploymentUrl).origin.replace(".cloud", ".site")}/v1/instagram/callback`,
    };
    return setup;
  },
  configureInstagramBridgeMeta: async () => {
    fixture.configs++;
    metaConfigured = true;
    return setup;
  },
  validateInstagramBridgeSetup: async () => ({
    ...setup,
    backendVersion: 1,
    metaConfigured,
    stage: metaConfigured ? "ready" : "meta",
  }),
};
const platform = {
  openExternal: (url: string) => {
    fixture.opened.push(url);
  },
  copyTextToClipboard: async (text: string) => {
    fixture.copied.push(text);
  },
} as unknown as IPlatformService;
function Fixture() {
  const [status, setStatus] = useState<InstagramConnection["status"]>("disconnected");
  return (
    <ZCodeIntlProvider initialLocale="en-US">
      <SocialInstagramSetup
        service={service}
        platform={platform}
        connectionStatus={status}
        onReady={() =>
          new Promise<void>((resolve) => {
            fixture.releaseReady = resolve;
          })
        }
        onConnect={() => setStatus("connected")}
      />
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
