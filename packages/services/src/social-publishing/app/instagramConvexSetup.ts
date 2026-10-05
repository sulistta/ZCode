import { createHash, randomBytes } from "node:crypto";
import type {
  InstagramBridgeConfiguration,
  InstagramBridgeSetup,
  ProvisionInstagramBridgeRequest,
} from "@social-harness/shared";
import {
  provisionInstagramBridgeRequestSchema,
  configureInstagramBridgeMetaRequestSchema,
} from "@social-harness/shared";
import type {
  InstagramBridgeConfigurationStore,
  InstagramConvexProvisioner,
  InstagramBridgeSetup as SetupPort,
} from "./ports/instagramBridgeSetup.js";
import type { InstagramCredentialStore } from "./ports/instagramCredentialStore.js";
import { SocialPublishingError } from "./socialPublishingError.js";
export const CONVEX_INSTALLATION_VAULT_KEY = "convex-bridge-installation";
export function convexSiteUrl(deploymentUrl: string): string {
  return new URL(deploymentUrl).origin.replace(/\.convex\.cloud$/u, ".convex.site");
}
function projectSetup(config: InstagramBridgeConfiguration | null): InstagramBridgeSetup {
  const name = config ? new URL(config.deploymentUrl).hostname.split(".")[0] : null;
  return {
    stage: config ? "meta" : "project",
    deploymentUrl: config?.deploymentUrl ?? null,
    callbackUrl: config ? `${convexSiteUrl(config.deploymentUrl)}/v1/instagram/callback` : null,
    dashboardUrl: name
      ? `https://dashboard.convex.dev/d/${name}/settings`
      : "https://dashboard.convex.dev/",
    metaDashboardUrl: "https://developers.facebook.com/apps/",
    backendVersion: null,
    metaConfigured: false,
  };
}
export function createInstagramConvexSetup(options: {
  store: InstagramBridgeConfigurationStore;
  credentials: InstagramCredentialStore;
  provisioner: InstagramConvexProvisioner;
  status: (
    deploymentUrl: string,
    installationCredential: string,
  ) => Promise<{ version: number; metaConfigured: boolean }>;
}): SetupPort {
  return {
    async get() {
      return projectSetup(await options.store.read());
    },
    async provision(request: ProvisionInstagramBridgeRequest) {
      const input = provisionInstagramBridgeRequestSchema.parse(request);
      return options.store.exclusive(async () => {
        const selected =
          input.mode === "existing"
            ? { deploymentUrl: input.deploymentUrl, deployKey: input.provisioningCredential }
            : await options.provisioner.createProject(input);
        const name = new URL(selected.deploymentUrl).hostname.split(".")[0];
        if (!selected.deployKey.startsWith(`prod:${name}|`) || selected.deployKey.length < 20) {
          throw new SocialPublishingError(
            "invalid-provisioning-credential",
            "Use a production deployment key for the selected project.",
          );
        }
        const previousConfig = await options.store.read();
        const previous = await options.credentials.load(CONVEX_INSTALLATION_VAULT_KEY);
        const sameProject =
          previousConfig?.deploymentUrl === new URL(selected.deploymentUrl).toString();
        const credential =
          sameProject && previous ? previous.accessToken : randomBytes(32).toString("base64url");
        try {
          await options.provisioner.deploy({
            ...selected,
            installationCredentialHash: createHash("sha256").update(credential).digest("base64url"),
          });
          await options.credentials.store(CONVEX_INSTALLATION_VAULT_KEY, {
            accessToken: credential,
          });
          const config: InstagramBridgeConfiguration = {
            version: 1,
            deploymentUrl: new URL(selected.deploymentUrl).toString(),
            configuredAt: Date.now(),
          };
          try {
            await options.store.write(config);
          } catch {
            if (previous) await options.credentials.store(CONVEX_INSTALLATION_VAULT_KEY, previous);
            else await options.credentials.delete(CONVEX_INSTALLATION_VAULT_KEY);
            throw new Error("configuration-write-failed");
          }
          return projectSetup(config);
        } catch (error) {
          if (error instanceof SocialPublishingError) throw error;
          throw new SocialPublishingError(
            "bridge-deployment-failed",
            "Bridge deployment or secure storage failed. Retry setup.",
          );
        }
      });
    },
    async configureMeta(request) {
      const input = configureInstagramBridgeMetaRequestSchema.parse(request);
      return options.store.exclusive(async () => {
        const config = await options.store.read();
        if (!config)
          throw new SocialPublishingError(
            "bridge-setup-unavailable",
            "Connect a dedicated project first.",
          );
        const name = new URL(config.deploymentUrl).hostname.split(".")[0];
        if (!input.provisioningCredential.startsWith(`prod:${name}|`))
          throw new SocialPublishingError(
            "invalid-provisioning-credential",
            "Use this project's production deployment key.",
          );
        await options.provisioner.configureMeta({
          deploymentUrl: config.deploymentUrl,
          deployKey: input.provisioningCredential,
          appId: input.appId,
          appSecret: input.appSecret,
        });
        return projectSetup(config);
      });
    },
    async validate() {
      const config = await options.store.read();
      const credential = await options.credentials.load(CONVEX_INSTALLATION_VAULT_KEY);
      if (!config || !credential)
        throw new SocialPublishingError(
          "bridge-setup-unavailable",
          "Connect a dedicated Convex project first.",
        );
      const status = await options.status(config.deploymentUrl, credential.accessToken);
      if (status.version !== 1)
        throw new SocialPublishingError(
          "bridge-deployment-failed",
          "Update the bridge backend before continuing.",
        );
      return {
        ...projectSetup(config),
        stage: status.metaConfigured ? "ready" : "meta",
        backendVersion: status.version,
        metaConfigured: status.metaConfigured,
      };
    },
  };
}
