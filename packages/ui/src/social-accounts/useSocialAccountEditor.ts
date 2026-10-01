import { useCallback, useEffect, useRef, useState } from "react";
import type { SocialAccount } from "@social-harness/shared";
import type { SocialAccountService } from "@social-harness/services";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  draftFromAccount,
  EMPTY_EDITORIAL_DRAFT,
  EMPTY_POLICY_DRAFT,
  policyDraftFromAccount,
  policyFromDraft,
  profileFromDraft,
  replaceAccount,
} from "./socialAccountsModel.js";
import type { EditorialDraft, PolicyDraft } from "./socialAccountsModel.js";

export function useSocialAccountEditor(service: SocialAccountService) {
  const { intl } = useZCodeIntl();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [formRevision, setFormRevision] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditorialDraft>(EMPTY_EDITORIAL_DRAFT);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(EMPTY_POLICY_DRAFT);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const selectedAccount =
    accounts.find((account) => account.accountId === selectedAccountId) ?? null;

  const loadAccounts = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const nextAccounts = await service.list();
      if (generation !== loadGeneration.current) return;
      setAccounts(nextAccounts);
      setLoadFailed(false);
    } catch {
      if (generation !== loadGeneration.current) return;
      setLoadFailed(true);
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    const subscription = service.onChanged(() => {
      void loadAccounts();
    });
    void loadAccounts();
    return () => {
      loadGeneration.current += 1;
      subscription.dispose();
    };
  }, [loadAccounts, service]);

  useEffect(() => {
    if (!isCreating && !selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0]!.accountId);
    }
  }, [accounts, isCreating, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    const account = accountsRef.current.find(
      (candidate) => candidate.accountId === selectedAccountId,
    );
    if (!account) return;
    setDraft(draftFromAccount(account));
    setPolicyDraft(policyDraftFromAccount(account));
    setFormRevision(account.updatedAt);
    setFormError(null);
    // 创建回调会立即选中刚写入的账号；此处再清空 notice 会吞掉保存成功反馈。
  }, [selectedAccountId]);

  const beginCreate = useCallback(() => {
    setSelectedAccountId(null);
    setFormRevision(null);
    setDraft(EMPTY_EDITORIAL_DRAFT);
    setPolicyDraft(EMPTY_POLICY_DRAFT);
    setIsCreating(true);
    setFormError(null);
    setNotice(null);
  }, []);

  const selectAccount = useCallback((accountId: string) => {
    const account = accountsRef.current.find((candidate) => candidate.accountId === accountId);
    if (!account) return;
    setIsCreating(false);
    setSelectedAccountId(accountId);
    setDraft(draftFromAccount(account));
    setPolicyDraft(policyDraftFromAccount(account));
    setFormRevision(account.updatedAt);
    setFormError(null);
    setNotice(null);
  }, []);

  const saveProfile = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const editorialProfile = profileFromDraft(draft);
      if (isCreating) {
        const created = await service.create({
          displayName: draft.displayName.trim(),
          editorialProfile,
        });
        setAccounts((current) => replaceAccount(current, [created]));
        setSelectedAccountId(created.accountId);
        setFormRevision(created.updatedAt);
        setDraft(draftFromAccount(created));
        setPolicyDraft(policyDraftFromAccount(created));
        setIsCreating(false);
      } else if (selectedAccount) {
        const updated = await service.updateEditorial({
          accountId: selectedAccount.accountId,
          expectedUpdatedAt: formRevision ?? selectedAccount.updatedAt,
          displayName: draft.displayName.trim(),
          editorialProfile,
        });
        setAccounts((current) => replaceAccount(current, [updated]));
        setFormRevision(updated.updatedAt);
      } else {
        setFormError(intl.formatMessage({ id: "socialAccounts.status.required" }));
        return;
      }
      setNotice(intl.formatMessage({ id: "socialAccounts.status.saved" }));
    } catch (error) {
      setFormError(
        error instanceof Error && error.name === "ZodError"
          ? intl.formatMessage({ id: "socialAccounts.status.required" })
          : intl.formatMessage({ id: "socialAccounts.status.saveFailed" }),
      );
      if (!isCreating) void loadAccounts();
    } finally {
      setIsSaving(false);
    }
  }, [draft, formRevision, intl, isCreating, isSaving, loadAccounts, selectedAccount, service]);

  const savePolicy = useCallback(async () => {
    if (!selectedAccount || isSaving) return;
    setIsSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const updated = await service.updateAutomationPolicy({
        accountId: selectedAccount.accountId,
        expectedUpdatedAt: formRevision ?? selectedAccount.updatedAt,
        automationPolicy: policyFromDraft(policyDraft),
      });
      setAccounts((current) => replaceAccount(current, [updated]));
      setFormRevision(updated.updatedAt);
      setNotice(intl.formatMessage({ id: "socialAccounts.status.saved" }));
    } catch (error) {
      setFormError(
        error instanceof Error && error.name === "ZodError"
          ? intl.formatMessage({ id: "socialAccounts.status.required" })
          : intl.formatMessage({ id: "socialAccounts.status.saveFailed" }),
      );
      void loadAccounts();
    } finally {
      setIsSaving(false);
    }
  }, [formRevision, intl, isSaving, loadAccounts, policyDraft, selectedAccount, service]);

  const reloadSelectedAccount = useCallback(async () => {
    if (!selectedAccountId) return;
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const latest = await service.get(selectedAccountId);
      if (!latest) throw new Error("Social account no longer exists");
      setAccounts((current) => replaceAccount(current, [latest]));
      setDraft(draftFromAccount(latest));
      setPolicyDraft(policyDraftFromAccount(latest));
      setFormRevision(latest.updatedAt);
      setFormError(null);
      setNotice(null);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountId, service]);

  return {
    accounts,
    beginCreate,
    draft,
    formError,
    isCreating,
    isLoading,
    isSaving,
    loadAccounts,
    loadFailed,
    notice,
    policyDraft,
    reloadSelectedAccount,
    savePolicy,
    saveProfile,
    selectedAccount,
    selectedAccountId,
    selectAccount,
    setDraft,
    setPolicyDraft,
  };
}
