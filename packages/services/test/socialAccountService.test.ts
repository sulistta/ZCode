import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EditorialProfile } from "@social-harness/shared";
import { createSocialAccountFileStore } from "../src/social-account/adapters/socialAccountFileStore.js";
import {
  SocialAccountNotFoundError,
  SocialAccountRevisionConflictError,
} from "../src/social-account/app/errors.js";
import { createSocialAccountService } from "../src/social-account/app/socialAccountService.js";
import {
  getAppConfigDir,
  getConversationWorkspaceDir,
  getSocialHarnessDataRootDir,
  getZCodeDataRootDir,
  setDataBaseDir,
} from "../src/paths.js";

function createEditorialProfile(niche = "Podcast"): EditorialProfile {
  return {
    niche,
    audience: "People interested in independent film",
    language: "pt-BR",
    tone: ["Conversational", "Curious"],
    references: ["Long-form interviews"],
    preferredSources: ["youtube-search"],
    visualStyle: "Subtitles with high contrast and restrained color",
    memory: [],
  };
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "social-account-service-"));
  const filePath = join(directory, "accounts.json");
  let clock = 100;
  let nextAccountId = 1;
  const store = createSocialAccountFileStore({ filePath });
  const conversationWorkspaceOptions = {
    workspacePathForAccount: (accountId: string) => join(directory, "workspaces", accountId),
    ensureConversationWorkspace: async (workspacePath: string) => {
      await mkdir(workspacePath, { recursive: true });
    },
  };
  const service = createSocialAccountService({
    store,
    now: () => clock++,
    createAccountId: () => `account-${nextAccountId++}`,
    ...conversationWorkspaceOptions,
  });
  return {
    directory,
    filePath,
    service,
    makeService: () =>
      createSocialAccountService({
        store: createSocialAccountFileStore({ filePath }),
        ...conversationWorkspaceOptions,
      }),
    async dispose() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("account conversation workspaces are Host-derived and reject cross-account paths", async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.service.create({
      displayName: "Podcast account",
      editorialProfile: createEditorialProfile(),
    });
    const second = await fixture.service.create({
      displayName: "Music account",
      editorialProfile: createEditorialProfile("Music"),
    });
    const firstWorkspace = await fixture.service.resolveConversationWorkspace(first.accountId);
    const secondWorkspace = await fixture.service.resolveConversationWorkspace(second.accountId);
    assert.ok(firstWorkspace);
    assert.ok(secondWorkspace);
    assert.notEqual(firstWorkspace.workspacePath, secondWorkspace.workspacePath);
    assert.equal(firstWorkspace.workspaceIdentity, first.workspaceIdentity);
    assert.equal(await fixture.service.validateConversationWorkspace(firstWorkspace), true);
    assert.equal(
      await fixture.service.validateConversationWorkspace({
        workspaceIdentity: firstWorkspace.workspaceIdentity,
        workspacePath: secondWorkspace.workspacePath,
      }),
      false,
    );
    assert.equal(
      await fixture.service.validateConversationWorkspace({
        workspaceIdentity: "social-account:missing",
        workspacePath: firstWorkspace.workspacePath,
      }),
      false,
    );
    assert.equal(
      await fixture.service.validateConversationWorkspace({
        workspacePath: firstWorkspace.workspacePath,
      }),
      false,
    );
    assert.equal(
      await fixture.service.validateConversationWorkspace({
        workspacePath: "/tmp/ordinary-workspace",
      }),
      true,
    );
  } finally {
    await fixture.dispose();
  }
});

test("new accounts start supervised with an isolated identity and no publishing-owned state", async () => {
  const fixture = await createFixture();
  try {
    const account = await fixture.service.create({
      displayName: "Podcast account",
      editorialProfile: createEditorialProfile(),
    });

    assert.equal("connectionStatus" in account, false);
    assert.equal("instagramHandle" in account, false);
    assert.deepEqual(account.automationPolicy, { autonomyEnabled: false });
    assert.equal(account.workspaceIdentity, "social-account:account-1");
    assert.equal((await fixture.service.get(account.accountId))?.accountId, account.accountId);
  } finally {
    await fixture.dispose();
  }
});

test("legacy account publishing fields are ignored during account loading", async () => {
  const fixture = await createFixture();
  try {
    const account = await fixture.service.create({
      displayName: "Podcast account",
      editorialProfile: createEditorialProfile(),
    });
    await writeFile(
      fixture.filePath,
      `${JSON.stringify([
        { ...account, instagramHandle: "@podcast", connectionStatus: "connected" },
      ])}\n`,
      "utf8",
    );

    const loaded = await fixture.makeService().get(account.accountId);

    assert.ok(loaded);
    assert.equal("instagramHandle" in loaded, false);
    assert.equal("connectionStatus" in loaded, false);
  } finally {
    await fixture.dispose();
  }
});

test("automation policy requires sources, cadence, and a bounded daily publication limit", async () => {
  const fixture = await createFixture();
  try {
    const account = await fixture.service.create({
      displayName: "Music account",
      editorialProfile: createEditorialProfile("Music"),
    });
    const policy = {
      autonomyEnabled: true as const,
      allowedSources: ["youtube-search" as const],
      cadence: "weekly" as const,
      maxPublicationsPerDay: 3,
    };

    const updated = await fixture.service.updateAutomationPolicy({
      accountId: account.accountId,
      expectedUpdatedAt: account.updatedAt,
      automationPolicy: policy,
    });

    assert.deepEqual(updated.automationPolicy, policy);
    assert.equal(updated.updatedAt, account.updatedAt + 1);
  } finally {
    await fixture.dispose();
  }
});

test("account name edits persist with the editorial profile under one revision", async () => {
  const fixture = await createFixture();
  try {
    const account = await fixture.service.create({
      displayName: "Podcast account",
      editorialProfile: createEditorialProfile(),
    });

    const updated = await fixture.service.updateEditorial({
      accountId: account.accountId,
      expectedUpdatedAt: account.updatedAt,
      displayName: "Film conversations",
      editorialProfile: createEditorialProfile("Film"),
    });

    assert.equal(updated.displayName, "Film conversations");
    assert.equal(updated.editorialProfile.niche, "Film");
    assert.equal(updated.updatedAt, account.updatedAt + 1);
    assert.equal((await fixture.service.get(account.accountId))?.displayName, "Film conversations");
  } finally {
    await fixture.dispose();
  }
});

test("stale concurrent revisions apply once, persist before events, and never mutate another account", async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.service.create({
      displayName: "Podcast account",
      editorialProfile: createEditorialProfile(),
    });
    const second = await fixture.service.create({
      displayName: "Music account",
      editorialProfile: createEditorialProfile("Music"),
    });
    const events: Array<{ accountId: string; updatedAt: number; persisted: boolean }> = [];
    const subscription = fixture.service.onChanged((event) => {
      const stored = JSON.parse(readFileSync(fixture.filePath, "utf8")) as Array<{
        accountId: string;
        updatedAt: number;
      }>;
      events.push({
        ...event,
        persisted: stored.some(
          (record) => record.accountId === event.accountId && record.updatedAt === event.updatedAt,
        ),
      });
    });

    const updates = await Promise.allSettled([
      fixture.service.updateEditorial({
        accountId: first.accountId,
        expectedUpdatedAt: first.updatedAt,
        displayName: "Podcast account A",
        editorialProfile: createEditorialProfile("Podcast A"),
      }),
      fixture.service.updateEditorial({
        accountId: first.accountId,
        expectedUpdatedAt: first.updatedAt,
        displayName: "Podcast account B",
        editorialProfile: createEditorialProfile("Podcast B"),
      }),
    ]);

    subscription.dispose();
    assert.equal(updates.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = updates.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof SocialAccountRevisionConflictError);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.persisted, true);
    assert.equal(events[0]?.accountId, first.accountId);
    assert.equal((await fixture.service.get(first.accountId))?.updatedAt, events[0]?.updatedAt);
    assert.ok((events[0]?.updatedAt ?? 0) > first.updatedAt);
    assert.equal((await fixture.service.get(second.accountId))?.editorialProfile.niche, "Music");

    await assert.rejects(
      fixture.service.updateEditorial({
        accountId: "missing-account",
        expectedUpdatedAt: 0,
        displayName: "Never created",
        editorialProfile: createEditorialProfile("Never created"),
      }),
      SocialAccountNotFoundError,
    );
  } finally {
    await fixture.dispose();
  }
});

test("Social Harness account data uses its new root and leaves the ZCode root distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-harness-root-"));
  setDataBaseDir(directory);
  try {
    assert.equal(getSocialHarnessDataRootDir(), join(directory, ".social-harness", "v1"));
    assert.equal(getZCodeDataRootDir(), join(directory, ".zcode"));
    assert.notEqual(getSocialHarnessDataRootDir(), getZCodeDataRootDir());
    assert.equal(getAppConfigDir(), join(directory, ".social-harness", "v1", "config"));
    assert.equal(
      getConversationWorkspaceDir(),
      join(directory, ".social-harness", "v1", "workspace", "default"),
    );
  } finally {
    setDataBaseDir(null);
    await rm(directory, { recursive: true, force: true });
  }
});
