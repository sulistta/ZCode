import type { InstagramConnection } from "@social-harness/shared";
import type { ISocialInstagramSetupService } from "../setupContract.js";
import type { InstagramBridgeSetup } from "./ports/instagramBridgeSetup.js";
import { SocialPublishingError } from "./socialPublishingError.js";
export function createSocialPublishingSetupService(options: {
  setup: InstagramBridgeSetup;
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  listConnections: () => Promise<(InstagramConnection | null)[]>;
}): ISocialInstagramSetupService {
  async function exclusive<T>(operation: () => Promise<T>) {
    if (options.isBusy())
      throw new SocialPublishingError(
        "bridge-setup-busy",
        "Finish the current authorization or setup first.",
      );
    options.setBusy(true);
    try {
      return await operation();
    } finally {
      options.setBusy(false);
    }
  }
  return {
    getInstagramBridgeSetup: () => options.setup.get(),
    validateInstagramBridgeSetup: () => options.setup.validate(),
    configureInstagramBridgeMeta: (request) =>
      exclusive(() => options.setup.configureMeta(request)),
    provisionInstagramBridge: (request) =>
      exclusive(async () => {
        const existing = await options.setup.get();
        if (
          existing.deploymentUrl &&
          (request.mode !== "existing" ||
            new URL(request.deploymentUrl).toString() !== existing.deploymentUrl)
        ) {
          if (
            (await options.listConnections()).some(
              (connection) => connection && connection.connectedAt !== null,
            )
          )
            throw new SocialPublishingError(
              "bridge-switch-requires-disconnect",
              "Disconnect Instagram accounts before switching projects.",
            );
        }
        return options.setup.provision(request);
      }),
  };
}
