'use client';

import * as React from 'react';
import {
  LOCKED_MESSAGE,
  VAULT_PASSPHRASE_REQUIRED,
  createMemoryIdbStore,
  createMemoryVault,
  hasAnyLegacyKey,
  importEncryptedEnvelope,
  indexedDbVaultStore,
  migrateLegacyKeys,
  unwrapVault,
  wrapVault,
  type MemoryVault,
  type VaultCredentials,
  type VaultEnvelope,
  type VaultIdbStore,
  type VaultStatus,
} from '@/lib/credential-vault';
import type { KeyStorage } from '@/lib/settings-keys';

export const VAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

export interface CredentialVaultApi {
  status: VaultStatus;
  credentials: VaultCredentials | null;
  isLocked: boolean;
  vaultExists: boolean;
  lastError: string | null;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  saveCredentials: (creds: Partial<VaultCredentials>, passphrase: string) => Promise<boolean>;
  setupAndMigrate: (passphrase: string) => Promise<{ migrated: string[]; wiped: string[] }>;
  exportVault: () => Promise<string | null>;
  importVaultFile: (json: string, passphrase: string) => Promise<boolean>;
  requireUnlockedFor: (action: 'dispatch' | 'evaluate' | 'continue') => { ok: true } | { ok: false; error: string };
  clearVault: () => Promise<void>;
}

function resolveStore(): VaultIdbStore {
  if (typeof indexedDB !== 'undefined') return indexedDbVaultStore();
  return createMemoryIdbStore();
}

function resolveStorage(): KeyStorage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage as unknown as KeyStorage;
}

export function useCredentialVault(storeOverride?: VaultIdbStore): CredentialVaultApi {
  const [vaultRef] = React.useState<MemoryVault>(() => createMemoryVault());
  const [storeRef] = React.useState<VaultIdbStore>(() => storeOverride ?? resolveStore());

  const [status, setStatus] = React.useState<VaultStatus>('empty');
  const [credentials, setCredentials] = React.useState<VaultCredentials | null>(null);
  const [vaultExists, setVaultExists] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);

  const refreshExists = React.useCallback(async () => {
    try {
      const envelope = await storeRef.read();
      const timer = setTimeout(() => {
        setVaultExists(envelope !== null);
        if (envelope === null && vaultRef.isLocked()) setStatus('empty');
      }, 0);
      return () => clearTimeout(timer);
    } catch {
      // Storage unavailable — surface as locked-empty without throwing.
      return undefined;
    }
  }, []);

  React.useEffect(() => {
    void refreshExists();
  }, [refreshExists]);

  const lock = React.useCallback(() => {
    vaultRef.lock();
    setCredentials(null);
    setStatus((prev) => (prev === 'empty' ? 'empty' : 'locked'));
    setLastError(null);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => lock(), VAULT_IDLE_TIMEOUT_MS);
    };
    const onActivity = () => arm();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') lock();
    };
    const onPageHide = () => lock();
    arm();
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('scroll', onActivity, true);
    window.addEventListener('focus', onActivity);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('scroll', onActivity, true);
      window.removeEventListener('focus', onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [lock]);

  const unlock = React.useCallback(
    async (passphrase: string) => {
      if (!passphrase || !passphrase.trim()) {
        setLastError(VAULT_PASSPHRASE_REQUIRED);
        return false;
      }
      try {
        const envelope = await storeRef.read();
        if (!envelope) {
          setLastError('No encrypted vault found — set a passphrase to create one.');
          return false;
        }
        const unwrapped = await vaultRef.unlock(envelope, passphrase);
        setCredentials({ ...unwrapped });
        setStatus('unlocked');
        setLastError(null);
        return true;
      } catch (err) {
        lock();
        setLastError(err instanceof Error ? err.message : 'Incorrect passphrase — vault remains locked.');
        return false;
      }
    },
    [lock]
  );

  const saveCredentials = React.useCallback(
    async (creds: Partial<VaultCredentials>, passphrase: string) => {
      if (!passphrase || !passphrase.trim()) {
        setLastError(VAULT_PASSPHRASE_REQUIRED);
        return false;
      }
      try {
        const envelope = await wrapVault(creds, passphrase);
        await storeRef.write(envelope);
        const unwrapped = await unwrapVault(envelope, passphrase);
        vaultRef.setCredentials(unwrapped);
        setCredentials({ ...unwrapped });
        setVaultExists(true);
        setStatus('unlocked');
        setLastError(null);
        const storage = resolveStorage();
        if (storage && hasAnyLegacyKey(storage)) {
          for (const key of [
            'repopilot_jules_key',
            'repopilot_gemini_key',
            'repopilot_github_pat',
          ]) {
            storage.removeItem(key);
          }
        }
        return true;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Failed to save encrypted vault.');
        return false;
      }
    },
    []
  );

  const setupAndMigrate = React.useCallback(
    async (passphrase: string) => {
      const storage = resolveStorage();
      if (!storage) throw new Error('Browser storage is unavailable for migration.');
      const result = await migrateLegacyKeys(storage, passphrase, storeRef);
      const envelope = await storeRef.read();
      if (envelope) {
        const unwrapped = await vaultRef.unlock(envelope, passphrase);
        setCredentials({ ...unwrapped });
        setStatus('unlocked');
        setVaultExists(true);
        setLastError(null);
      }
      return result;
    },
    []
  );

  const exportVault = React.useCallback(async () => {
    const envelope = await storeRef.read();
    if (!envelope) return null;
    return JSON.stringify({ kind: 'repopilot-encrypted-vault', ...envelope });
  }, []);

  const importVaultFile = React.useCallback(
    async (json: string, passphrase: string) => {
      try {
        const envelope: VaultEnvelope = importEncryptedEnvelope(json);
        const unwrapped = await vaultRef.unlock(envelope, passphrase);
        await storeRef.write(envelope);
        setCredentials({ ...unwrapped });
        setStatus('unlocked');
        setVaultExists(true);
        setLastError(null);
        return true;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Import failed — vault remains locked.');
        return false;
      }
    },
    []
  );

  const requireUnlockedFor = React.useCallback(
    (_action: 'dispatch' | 'evaluate' | 'continue') => {
      if (vaultRef.isLocked()) return { ok: false as const, error: LOCKED_MESSAGE };
      return { ok: true as const };
    },
    []
  );

  const clearVault = React.useCallback(async () => {
    await storeRef.clear();
    lock();
    setVaultExists(false);
    setStatus('empty');
  }, [lock]);

  return {
    status,
    credentials,
    isLocked: status !== 'unlocked',
    vaultExists,
    lastError,
    unlock,
    lock,
    saveCredentials,
    setupAndMigrate,
    exportVault,
    importVaultFile,
    requireUnlockedFor,
    clearVault,
  };
}
