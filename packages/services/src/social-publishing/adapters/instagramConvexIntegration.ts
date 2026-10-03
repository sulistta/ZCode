import type { InstagramAuthBridge } from "../app/ports/instagramAuthBridge.js";
import { createHash } from "node:crypto";
import type { InstagramCredentialStore } from "../app/ports/instagramCredentialStore.js";
import {
  createInstagramConvexSetup,
  CONVEX_INSTALLATION_VAULT_KEY,
  convexSiteUrl,
} from "../app/instagramConvexSetup.js";
import { createInstagramBridgeConfigurationFileStore } from "./instagramBridgeConfigurationFileStore.js";
import { createInstagramConvexProvisioner } from "./instagramConvexProvisioner.js";
import { createInstagramConvexBridgeHttpClient } from "./instagramConvexBridgeHttpClient.js";
import { SocialPublishingError } from "../app/socialPublishingError.js";
export function createInstagramConvexIntegration(options: {
  configurationPath: string;
  assetsDir: string;
  credentials: InstagramCredentialStore;
}) {
  const store = createInstagramBridgeConfigurationFileStore(options.configurationPath);
  async function client() {
    const config = await store.read();
    const credential = await options.credentials.load(CONVEX_INSTALLATION_VAULT_KEY);
    if (!config || !credential)
      throw new SocialPublishingError(
        "authorization-unavailable",
        "Complete Convex project setup first.",
      );
    return createInstagramConvexBridgeHttpClient({
      deploymentUrl: config.deploymentUrl,
      installationCredential: credential.accessToken,
    });
  }
  const bridge: InstagramAuthBridge = {
    async isAvailable() {
      if (!(await store.read()) || !(await options.credentials.load(CONVEX_INSTALLATION_VAULT_KEY)))
        return false;
      const status = await (await client()).status();
      return status.version === 1 && status.metaConfigured;
    },
    async acceptsCredential(tokens) {
      const config = await store.read();
      const installation = await options.credentials.load(CONVEX_INSTALLATION_VAULT_KEY);
      // 相同部署里丢失安装身份后重新 provision，旧账号 key 仍绑定旧 installation。
      return Boolean(
        config &&
        installation &&
        tokens.bridgeOrigin === convexSiteUrl(config.deploymentUrl) &&
        tokens.bridgeInstallationHash ===
          createHash("sha256").update(installation.accessToken).digest("base64url"),
      );
    },
    async createAuthorization(input) {
      return (await client()).createAuthorization(input);
    },
    async redeemHandoff(input) {
      return (await client()).redeemHandoff(input);
    },
    async revokeMediaUploadCredential(credential) {
      await (
        await client()
      ).revokeMediaUploadCredential!(credential);
    },
    async revokeAllMediaUploadCredentials(credential) {
      await (
        await client()
      ).revokeAllMediaUploadCredentials!(credential);
    },
    async uploadTemporaryMedia(input) {
      return (await client()).uploadTemporaryMedia!(input);
    },
    async deleteTemporaryMedia(input) {
      await (
        await client()
      ).deleteTemporaryMedia!(input);
    },
  };
  return {
    bridge,
    setup: createInstagramConvexSetup({
      store,
      credentials: options.credentials,
      provisioner: createInstagramConvexProvisioner({ assetsDir: options.assetsDir }),
      status: async (deploymentUrl, installationCredential) =>
        createInstagramConvexBridgeHttpClient({ deploymentUrl, installationCredential }).status(),
    }),
  };
}
