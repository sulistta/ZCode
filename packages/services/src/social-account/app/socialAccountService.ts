import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Emitter } from "@social-harness/rpc";
import type {
  CreateSocialAccountRequest,
  EditorialProfile,
  SocialAccountConversationWorkspace,
  SocialAccountConversationWorkspaceRequest,
  SocialAccount,
  SocialAutomationPolicy,
  UpdateSocialAccountEditorialRequest,
  UpdateSocialAccountPolicyRequest,
} from "@social-harness/shared";
import {
  createSocialAccountRequestSchema,
  createSocialAccountWorkspaceIdentity,
  editorialProfileSchema,
  parseSocialAccountWorkspaceIdentity,
  socialAccountConversationWorkspaceRequestSchema,
  socialAccountConversationWorkspaceSchema,
  socialAccountIdSchema,
  socialAccountSchema,
  socialAutomationPolicySchema,
  updateSocialAccountEditorialRequestSchema,
  updateSocialAccountPolicyRequestSchema,
} from "@social-harness/shared";
import type { ISocialAccountService, SocialAccountChange } from "../contract.js";
import type { SocialAccountStore } from "./ports/socialAccountStore.js";
import {
  SocialAccountNotFoundError,
  SocialAccountRevisionConflictError,
  SocialAccountWorkspaceUnavailableError,
} from "./errors.js";
import { isSocialAccountConversationWorkspacePath } from "../../paths.js";

interface SocialAccountServiceOptions {
  store: SocialAccountStore;
  now?: () => number;
  createAccountId?: () => string;
  workspacePathForAccount?: (accountId: string) => string;
  ensureConversationWorkspace?: (workspacePath: string) => Promise<void>;
}

function nextUpdatedAt(current: number, now: number): number {
  return Math.max(current + 1, Math.trunc(now));
}

function comparableWorkspacePath(workspacePath: string): string {
  const path = resolve(workspacePath);
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function createSocialAccountService(
  options: SocialAccountServiceOptions,
): ISocialAccountService {
  const now = options.now ?? Date.now;
  const createAccountId = options.createAccountId ?? randomUUID;
  const changed = new Emitter<SocialAccountChange>();

  function notify(account: SocialAccount): void {
    changed.fire({ accountId: account.accountId, updatedAt: account.updatedAt });
  }

  async function update(
    accountId: string,
    expectedUpdatedAt: number,
    transform: (account: SocialAccount) => SocialAccount,
  ): Promise<SocialAccount> {
    const account = await options.store.update(accountId, (current) => {
      if (current.updatedAt !== expectedUpdatedAt) {
        throw new SocialAccountRevisionConflictError(accountId, current.updatedAt);
      }
      return socialAccountSchema.parse(
        transform({ ...current, updatedAt: nextUpdatedAt(current.updatedAt, now()) }),
      );
    });
    if (!account) throw new SocialAccountNotFoundError(accountId);
    notify(account);
    return account;
  }

  return {
    async list() {
      return options.store.list();
    },
    async get(accountId) {
      return options.store.get(accountId);
    },
    async create(request: CreateSocialAccountRequest) {
      const input = createSocialAccountRequestSchema.parse(request);
      const createdAt = Math.max(0, Math.trunc(now()));
      const accountId = createAccountId();
      const account = socialAccountSchema.parse({
        accountId,
        platform: "instagram",
        displayName: input.displayName,
        editorialProfile: input.editorialProfile,
        automationPolicy: { autonomyEnabled: false },
        workspaceIdentity: createSocialAccountWorkspaceIdentity(accountId),
        createdAt,
        updatedAt: createdAt,
      });
      const storedAccount = await options.store.create(account);
      notify(storedAccount);
      return storedAccount;
    },
    async resolveConversationWorkspace(
      rawAccountId,
    ): Promise<SocialAccountConversationWorkspace | null> {
      const accountId = socialAccountIdSchema.parse(rawAccountId);
      const account = await options.store.get(accountId);
      if (!account) return null;
      if (!options.workspacePathForAccount || !options.ensureConversationWorkspace) {
        throw new SocialAccountWorkspaceUnavailableError();
      }
      const workspacePath = options.workspacePathForAccount(accountId);
      await options.ensureConversationWorkspace(workspacePath);
      return socialAccountConversationWorkspaceSchema.parse({
        workspaceIdentity: account.workspaceIdentity,
        workspacePath,
      });
    },
    async validateConversationWorkspace(
      rawRequest: SocialAccountConversationWorkspaceRequest,
    ): Promise<boolean> {
      const request = socialAccountConversationWorkspaceRequestSchema.parse(rawRequest);
      const identity = request.workspaceIdentity;
      const accountId = parseSocialAccountWorkspaceIdentity(identity);
      if (identity?.startsWith("social-account:") && !accountId) return false;
      if (!accountId) {
        if (isSocialAccountConversationWorkspacePath(request.workspacePath)) return false;
        const workspacePathForAccount = options.workspacePathForAccount;
        if (!workspacePathForAccount) return true;
        const requestedPath = comparableWorkspacePath(request.workspacePath);
        const accounts = await options.store.list();
        return !accounts.some(
          (account) =>
            comparableWorkspacePath(workspacePathForAccount(account.accountId)) === requestedPath,
        );
      }
      if (!options.workspacePathForAccount) return false;
      const account = await options.store.get(accountId);
      if (!account || account.workspaceIdentity !== identity) return false;
      return (
        comparableWorkspacePath(request.workspacePath) ===
        comparableWorkspacePath(options.workspacePathForAccount(accountId))
      );
    },
    async updateEditorial(request: UpdateSocialAccountEditorialRequest) {
      const input = updateSocialAccountEditorialRequestSchema.parse(request);
      const editorialProfile: EditorialProfile = editorialProfileSchema.parse(
        input.editorialProfile,
      );
      return update(input.accountId, input.expectedUpdatedAt, (account) => ({
        ...account,
        displayName: input.displayName,
        editorialProfile,
      }));
    },
    async updateAutomationPolicy(request: UpdateSocialAccountPolicyRequest) {
      const input = updateSocialAccountPolicyRequestSchema.parse(request);
      const automationPolicy: SocialAutomationPolicy = socialAutomationPolicySchema.parse(
        input.automationPolicy,
      );
      return update(input.accountId, input.expectedUpdatedAt, (account) => ({
        ...account,
        automationPolicy,
      }));
    },
    onChanged: changed.event,
  };
}
