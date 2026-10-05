import assert from "node:assert/strict";
import test from "node:test";
import type { IChannelClient } from "@social-harness/rpc";
import {
  ISocialMediaPreviewService,
  ISocialProjectService,
  ISocialPublishingService,
} from "@social-harness/services";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";

test("Social Harness RPC access exposes preview and project contracts, with publishing Desktop-only", async () => {
  const requests: Array<{ channelName: string; command: string; args: unknown[] }> = [];
  const channelClient = {
    getChannel(channelName: string) {
      return {
        call(command: string, args: unknown[] = []) {
          requests.push({ channelName, command, args });
          return Promise.resolve({});
        },
        listen() {
          throw new Error("This test does not subscribe to service events");
        },
      };
    },
  } as unknown as IChannelClient;

  const webSocketAccess = new RemoteServiceAccess(channelClient);
  assert.equal(webSocketAccess.socialPublishingService, undefined);
  await webSocketAccess.socialMediaPreviewService.prepare({
    accountId: "account-1",
    mediaId: "media-1",
  });
  await webSocketAccess.socialProjectService.list("account-1");

  assert.deepEqual(requests, [
    {
      channelName: ISocialMediaPreviewService.channelName,
      command: "prepare",
      args: [{ accountId: "account-1", mediaId: "media-1" }],
    },
    {
      channelName: ISocialProjectService.channelName,
      command: "list",
      args: ["account-1"],
    },
  ]);

  const desktopAccess = new RemoteServiceAccess(channelClient, {
    includeSocialPublishing: true,
  });
  assert.ok(desktopAccess.socialPublishingService);
  await desktopAccess.socialPublishingService.listConnections();
  assert.equal(requests.at(-1)?.channelName, ISocialPublishingService.channelName);
  assert.equal(requests.at(-1)?.command, "listConnections");
});
