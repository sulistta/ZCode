import type { InstagramConnection } from "@social-harness/shared";
import {
  provisionInstagramBridgeRequestSchema,
  configureInstagramBridgeMetaRequestSchema,
} from "@social-harness/shared";
import type { ISocialInstagramSetupService } from "../setupContract.js";
import type { InstagramBridgeSetup } from "./ports/instagramBridgeSetup.js";
import { SocialPublishingError } from "./socialPublishingError.js";
function requireRequest<T>(result: { success: true; data: T } | { success: false }): T {
  // 修复：RPC 会记录失败对象；拒绝输入时不转发可能包含字段名/原始 URL 的解析异常。
  if (!result.success)
    throw new SocialPublishingError(
      "bridge-deployment-failed",
      "Check the project setup details and try again.",
    );
  return result.data;
}
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
      exclusive(() =>
        options.setup.configureMeta(
          requireRequest(configureInstagramBridgeMetaRequestSchema.safeParse(request)),
        ),
      ),
    provisionInstagramBridge: (request) =>
      exclusive(async () => {
        const input = requireRequest(provisionInstagramBridgeRequestSchema.safeParse(request));
        const existing = await options.setup.get();
        if (
          existing.deploymentUrl &&
          (input.mode !== "existing" ||
            new URL(input.deploymentUrl).toString() !== existing.deploymentUrl)
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
        return options.setup.provision(input);
      }),
  };
}
