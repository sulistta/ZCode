import { createRoot } from "react-dom/client";
import type {
  IPlatformService,
  InstagramBridgeSetup,
  InstagramConnection,
  SocialAccount,
} from "@social-harness/shared";
import type {
  SocialInstagramSetupService,
  SocialPublishingService,
} from "@social-harness/services";
import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.js";
import { SocialInstagramSetup } from "../../../ui/src/social-accounts/SocialInstagramSetup.js";
import { useSocialInstagramConnections } from "../../../ui/src/social-accounts/useSocialInstagramConnections.js";

declare global {
  interface Window {
    oauthFixturePlatform: Pick<
      IPlatformService,
      "onOAuthCallback" | "notifyRendererReady" | "registerOAuthState"
    >;
    setupFixture: {
      copied: string[];
      opened: string[];
      provisions: number;
      configs: number;
      completions: number;
      releaseReady: (() => void) | null;
    };
  }
}
const fixture = (window.setupFixture = {
  copied: [],
  opened: [],
  provisions: 0,
  configs: 0,
  completions: 0,
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
  ...window.oauthFixturePlatform,
  openExternal: (url: string) => {
    fixture.opened.push(url);
  },
  copyTextToClipboard: async (text: string) => {
    fixture.copied.push(text);
  },
} as unknown as IPlatformService;
let connection: InstagramConnection = {
  accountId: "fixture-account",
  status: "disconnected",
  profile: null,
  connectedAt: null,
};
const connectionListeners = new Set<(event: { accountId: string }) => void>();
const fixtureAccounts: SocialAccount[] = [];
const publishing = {
  isInstagramAuthorizationAvailable: async () => true,
  listConnections: async () => [connection],
  getConnection: async () => connection,
  onConnectionChanged: (listener: (event: { accountId: string }) => void) => {
    connectionListeners.add(listener);
    return { dispose: () => connectionListeners.delete(listener) };
  },
  startInstagramConnection: async () => ({
    state: "setup-fixture-state",
    authorizeUrl: "https://www.instagram.com/oauth/authorize?state=setup-fixture-state",
    expiresAt: Date.now() + 300_000,
  }),
  completeInstagramConnection: async (request: { state: string; handoffTicket: string }) => {
    if (request.state !== "setup-fixture-state" || request.handoffTicket !== "fixture-ticket")
      throw new Error("Unexpected fixture handoff");
    fixture.completions++;
    connection = {
      ...connection,
      status: "connected",
      connectedAt: Date.now(),
    };
    for (const listener of connectionListeners) listener({ accountId: connection.accountId });
    return connection;
  },
} as unknown as SocialPublishingService;
function Fixture() {
  const connections = useSocialInstagramConnections({
    accounts: fixtureAccounts,
    service: publishing,
    platform,
    isDesktop: true,
  });
  return (
    <ZCodeIntlProvider initialLocale="en-US">
      <SocialInstagramSetup
        service={service}
        platform={platform}
        connectionStatus={
          connections.connectionByAccount["fixture-account"]?.status ?? "disconnected"
        }
        onReady={async () => {
          await new Promise<void>((resolve) => {
            fixture.releaseReady = resolve;
          });
          await connections.reloadAuthorizationAvailability();
        }}
        onConnect={() => void connections.connect("fixture-account")}
      />
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
