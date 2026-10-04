import assert from "node:assert/strict";
import test from "node:test";
import { createSocialAccountWorkspaceIdentity } from "@social-harness/shared";
import { isConversationSharingAvailable } from "../src/lib/conversationSharingAvailability.js";

test("conversation sharing is unavailable in account-scoped Social Harness workspaces", () => {
  assert.equal(
    isConversationSharingAvailable(createSocialAccountWorkspaceIdentity("account-1")),
    false,
  );
});

test("conversation sharing remains available to other workspace identities", () => {
  assert.equal(isConversationSharingAvailable(undefined), true);
  assert.equal(isConversationSharingAvailable("/workspace/project"), true);
  assert.equal(isConversationSharingAvailable("ssh://host/workspace/project"), true);
});
