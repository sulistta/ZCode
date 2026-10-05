import type { Event } from "@social-harness/rpc";
import type {
  CreateSocialAccountRequest,
  SocialAccountConversationWorkspace,
  SocialAccountConversationWorkspaceRequest,
  SocialAccount,
  UpdateSocialAccountEditorialRequest,
  UpdateSocialAccountPolicyRequest,
} from "@social-harness/shared";
import { ServiceChannels } from "@social-harness/shared";
import { createServiceDescriptor } from "../descriptors.js";

export type {
  CreateSocialAccountRequest,
  SocialAccountConversationWorkspace,
  SocialAccountConversationWorkspaceRequest,
  EditorialMemoryEntry,
  EditorialProfile,
  SocialAccount,
  SocialAutomationPolicy,
  UpdateSocialAccountEditorialRequest,
  UpdateSocialAccountPolicyRequest,
} from "@social-harness/shared";

export type SocialAccountChange = {
  accountId: string;
  updatedAt: number;
};

export interface ISocialAccountService {
  list(): Promise<SocialAccount[]>;
  get(accountId: string): Promise<SocialAccount | null>;
  create(request: CreateSocialAccountRequest): Promise<SocialAccount>;
  resolveConversationWorkspace(
    accountId: string,
  ): Promise<SocialAccountConversationWorkspace | null>;
  validateConversationWorkspace(
    request: SocialAccountConversationWorkspaceRequest,
  ): Promise<boolean>;
  updateEditorial(request: UpdateSocialAccountEditorialRequest): Promise<SocialAccount>;
  updateAutomationPolicy(request: UpdateSocialAccountPolicyRequest): Promise<SocialAccount>;
  onChanged: Event<SocialAccountChange>;
}

export const ISocialAccountService = createServiceDescriptor<ISocialAccountService>(
  ServiceChannels.SocialAccount,
);
