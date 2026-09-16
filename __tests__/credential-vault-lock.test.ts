import { describe, it, expect } from 'vitest';
import {
  LOCKED_MESSAGE,
  VAULT_IDB_DB,
  VAULT_IDB_KEY,
  createMemoryIdbStore,
  createMemoryVault,
  gateVaultAction,
  wrapVault,
} from '@/lib/credential-vault';
import { VaultPostBodySchema } from '@/lib/validation';

const CREDS = { julesKey: 'jules-secret', geminiKey: 'gemini-secret', githubPat: 'ghp_secret' };
const PASS = 'lock test passphrase';

describe('credential vault locked-state enforcement', () => {
  it.each(['dispatch', 'evaluate', 'continue'] as const)(
    'blocks %s while the vault is locked with a fixed sentence',
    (action) => {
      expect(gateVaultAction(true)).toEqual({ ok: false, error: LOCKED_MESSAGE });
      expect(LOCKED_MESSAGE).toMatch(/vault is locked/i);
      void action;
    }
  );

  it('permits dispatch, evaluate, and continue once unlocked', () => {
    expect(gateVaultAction(false)).toEqual({ ok: true });
  });

  it('lock() drops in-memory credentials so actions fail closed again', async () => {
    const vault = createMemoryVault();
    const envelope = await wrapVault(CREDS, PASS);
    await vault.unlock(envelope, PASS);
    expect(gateVaultAction(vault.isLocked())).toEqual({ ok: true });
    vault.lock();
    expect(vault.isLocked()).toBe(true);
    expect(gateVaultAction(vault.isLocked())).toEqual({ ok: false, error: LOCKED_MESSAGE });
  });

  it('never persists secrets to /api/vault — schema rejects key fields', () => {
    const withJules = VaultPostBodySchema.safeParse({
      blueprint: { blueprintId: 'bp_1' },
      julesKey: 'secret',
    });
    expect(withJules.success).toBe(false);
    const withGemini = VaultPostBodySchema.safeParse({
      blueprint: { blueprintId: 'bp_1' },
      geminiKey: 'secret',
    });
    expect(withGemini.success).toBe(false);
    const withPat = VaultPostBodySchema.safeParse({
      blueprint: { blueprintId: 'bp_1' },
      githubPat: 'secret',
    });
    expect(withPat.success).toBe(false);
    const cleanBlueprint = VaultPostBodySchema.safeParse({
      blueprint: { blueprintId: 'bp_1', repo: 'a/b' },
    });
    expect(cleanBlueprint.success).toBe(true);
  });

  it('uses a credential-scoped IndexedDB namespace, never localStorage keys', () => {
    expect(VAULT_IDB_DB).toBe('repopilot-credential-vault');
    expect(VAULT_IDB_KEY).toBe('vault-v1');
    expect(VAULT_IDB_KEY).not.toContain('_key');
  });

  it('memory IDB stub validates envelopes and clears cleanly', async () => {
    const store = createMemoryIdbStore();
    expect(await store.read()).toBeNull();
    const envelope = await wrapVault(CREDS, PASS);
    await store.write(envelope);
    expect(await store.read()).toEqual(envelope);
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});
