import assert from "node:assert/strict";
import test from "node:test";
import { socialAutomationPolicySchema, type SocialAccount } from "@social-harness/shared";
import {
  draftFromAccount,
  policyDraftFromAccount,
  policyFromDraft,
  profileFromDraft,
} from "../src/social-accounts/socialAccountsModel.js";

const account: SocialAccount = {
  accountId: "podcast-one",
  platform: "instagram",
  displayName: "Podcast One",
  editorialProfile: {
    niche: "Podcast",
    audience: "Independent film listeners",
    language: "pt-BR",
    tone: ["Curious", "Warm"],
    references: ["Interview clips"],
    preferredSources: ["youtube-search"],
    visualStyle: "High contrast subtitles",
    memory: [
      {
        id: "memory-learned-1",
        text: "Keep the opening concise",
        source: "learned",
        createdAt: 10,
        updatedAt: 20,
      },
    ],
  },
  automationPolicy: { autonomyEnabled: false },
  workspaceIdentity: "social-account:podcast-one",
  createdAt: 10,
  updatedAt: 20,
};

test("editorial form round-trips lines and keeps learned memory editable", () => {
  const draft = draftFromAccount(account);
  draft.tone = "  Direct  \n\nCurious";
  draft.memory[0]!.text = "  Keep the first sentence concise  ";

  const profile = profileFromDraft(draft);
  assert.deepEqual(profile.tone, ["Direct", "Curious"]);
  const memory = profile.memory[0]!;
  assert.equal(memory.id, "memory-learned-1");
  assert.equal(memory.text, "Keep the first sentence concise");
  assert.equal(memory.source, "learned");
  assert.equal(memory.createdAt, 10);
  assert.ok(memory.updatedAt >= 20);
});

test("supervised policy stays off and autonomous drafts serialize to the shared contract", () => {
  assert.equal(policyDraftFromAccount(account).autonomyEnabled, false);

  const parsedPolicy = socialAutomationPolicySchema.parse(
    policyFromDraft({
      autonomyEnabled: true,
      allowedSources: ["youtube-search", "video-url"],
      cadence: "weekly",
      maxPublicationsPerDay: "3",
    }),
  );
  assert.deepEqual(parsedPolicy, {
    autonomyEnabled: true,
    allowedSources: ["youtube-search", "video-url"],
    cadence: "weekly",
    maxPublicationsPerDay: 3,
  });
});
