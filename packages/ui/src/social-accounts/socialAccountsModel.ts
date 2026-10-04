import type {
  EditorialMemoryEntry,
  EditorialProfile,
  SocialAccount,
  SocialAutomationPolicy,
} from "@social-harness/shared";

export type EditorialSource = EditorialProfile["preferredSources"][number];
export type Cadence = Extract<SocialAutomationPolicy, { autonomyEnabled: true }>["cadence"];
export type SocialMediaView =
  | "accounts"
  | "conversations"
  | "library"
  | "player"
  | "automations"
  | "model-settings";

export interface EditorialDraft {
  displayName: string;
  niche: string;
  audience: string;
  language: string;
  tone: string;
  references: string;
  preferredSources: EditorialSource[];
  visualStyle: string;
  memory: EditorialMemoryEntry[];
}

export interface PolicyDraft {
  autonomyEnabled: boolean;
  allowedSources: EditorialSource[];
  cadence: Cadence;
  maxPublicationsPerDay: string;
}

export const SOURCE_OPTIONS: Array<{ value: EditorialSource; labelId: string }> = [
  { value: "youtube-search", labelId: "socialAccounts.profile.source.youtube" },
  { value: "video-url", labelId: "socialAccounts.profile.source.url" },
  { value: "local-file", labelId: "socialAccounts.profile.source.local" },
];

export const EMPTY_EDITORIAL_DRAFT: EditorialDraft = {
  displayName: "",
  niche: "",
  audience: "",
  language: "pt-BR",
  tone: "",
  references: "",
  preferredSources: ["youtube-search"],
  visualStyle: "",
  memory: [],
};

export const EMPTY_POLICY_DRAFT: PolicyDraft = {
  autonomyEnabled: false,
  allowedSources: ["youtube-search"],
  cadence: "weekly",
  maxPublicationsPerDay: "1",
};

export function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToLines(value: string[]): string {
  return value.join("\n");
}

export function draftFromAccount(account: SocialAccount): EditorialDraft {
  return {
    displayName: account.displayName,
    niche: account.editorialProfile.niche,
    audience: account.editorialProfile.audience,
    language: account.editorialProfile.language,
    tone: listToLines(account.editorialProfile.tone),
    references: listToLines(account.editorialProfile.references),
    preferredSources: [...account.editorialProfile.preferredSources],
    visualStyle: account.editorialProfile.visualStyle,
    memory: account.editorialProfile.memory.map((entry) => ({ ...entry })),
  };
}

export function profileFromDraft(draft: EditorialDraft): EditorialProfile {
  const now = Date.now();
  return {
    niche: draft.niche.trim(),
    audience: draft.audience.trim(),
    language: draft.language.trim(),
    tone: linesToList(draft.tone),
    references: linesToList(draft.references),
    preferredSources: draft.preferredSources,
    visualStyle: draft.visualStyle.trim(),
    memory: draft.memory.map((entry) => ({
      ...entry,
      text: entry.text.trim(),
      updatedAt: now,
    })),
  };
}

export function policyDraftFromAccount(account: SocialAccount): PolicyDraft {
  const policy = account.automationPolicy;
  if (!policy.autonomyEnabled) {
    return {
      autonomyEnabled: false,
      allowedSources: [...account.editorialProfile.preferredSources],
      cadence: "weekly",
      maxPublicationsPerDay: "1",
    };
  }
  return {
    autonomyEnabled: true,
    allowedSources: [...policy.allowedSources],
    cadence: policy.cadence,
    maxPublicationsPerDay: String(policy.maxPublicationsPerDay),
  };
}

export function policyFromDraft(draft: PolicyDraft): SocialAutomationPolicy {
  if (!draft.autonomyEnabled) return { autonomyEnabled: false };
  return {
    autonomyEnabled: true,
    allowedSources: draft.allowedSources,
    cadence: draft.cadence,
    maxPublicationsPerDay: Number(draft.maxPublicationsPerDay),
  };
}

export function replaceAccount(accounts: SocialAccount[], next: SocialAccount[]): SocialAccount[] {
  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  for (const account of next) byId.set(account.accountId, account);
  return [...byId.values()];
}

export function updateSourceSelection(
  current: EditorialSource[],
  source: EditorialSource,
  checked: boolean,
): EditorialSource[] {
  if (checked) return current.includes(source) ? current : [...current, source];
  return current.filter((item) => item !== source);
}
