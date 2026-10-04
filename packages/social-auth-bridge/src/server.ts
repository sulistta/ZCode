import { serve } from "@hono/node-server";
import { createSocialAuthBridgeApp } from "./app.js";
import { createMetaInstagramOAuthClient } from "./adapters/metaInstagramOAuthClient.js";
import { FileMediaCredentialStore } from "./adapters/fileMediaCredentialStore.js";
import { FileTemporaryMediaStore } from "./adapters/fileTemporaryMediaStore.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const appId = requiredEnv("SOCIAL_AUTH_BRIDGE_INSTAGRAM_APP_ID");
const appSecret = requiredEnv("SOCIAL_AUTH_BRIDGE_INSTAGRAM_APP_SECRET");
const publicBaseUrl = requiredEnv("SOCIAL_AUTH_BRIDGE_PUBLIC_BASE_URL");
const dataDir = process.env.SOCIAL_AUTH_BRIDGE_DATA_DIR?.trim() || "/var/lib/social-auth-bridge";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

const mediaCredentialStore = new FileMediaCredentialStore(`${dataDir}/credentials`);
const temporaryMediaStore = new FileTemporaryMediaStore(`${dataDir}/temporary-media`);
await Promise.all([mediaCredentialStore.initialize(), temporaryMediaStore.initialize()]);

const app = createSocialAuthBridgeApp({
  publicBaseUrl,
  instagramAppId: appId,
  oauthClient: createMetaInstagramOAuthClient({ appId, appSecret }),
  mediaCredentialStore,
  temporaryMediaStore,
});

const server = serve({ fetch: app.fetch, port });
server.once("close", temporaryMediaStore.startCleanupWorker());
