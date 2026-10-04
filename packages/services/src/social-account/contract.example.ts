import type { ISocialAccountService } from "./contract.js";

/** A minimal example of creating a locally prepared account with supervised publishing. */
export async function createPreparedPodcastAccount(service: ISocialAccountService) {
  return service.create({
    displayName: "Sample Podcast",
    editorialProfile: {
      niche: "Podcast",
      audience: "People interested in independent film",
      language: "pt-BR",
      tone: ["Conversational", "Curious"],
      references: ["Long-form interviews"],
      preferredSources: ["youtube-search"],
      visualStyle: "Subtitles with high contrast and restrained color",
      memory: [],
    },
  });
}

/** A profile edit can rename the local account in the same revision-checked write. */
export async function updatePreparedAccountName(service: ISocialAccountService, accountId: string) {
  const account = await service.get(accountId);
  if (!account) throw new Error("Social account not found");
  return service.updateEditorial({
    accountId: account.accountId,
    expectedUpdatedAt: account.updatedAt,
    displayName: "Updated Podcast",
    editorialProfile: account.editorialProfile,
  });
}

/** Resolve the private conversation cwd from Host-owned account state before opening its chat. */
export async function resolvePreparedAccountConversation(
  service: ISocialAccountService,
  accountId: string,
) {
  const workspace = await service.resolveConversationWorkspace(accountId);
  if (!workspace) throw new Error("Social account not found");
  return workspace;
}
