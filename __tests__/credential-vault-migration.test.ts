import { describe, it, expect } from 'vitest';
import {
  createMemoryIdbStore,
  hasAnyLegacyKey,
  hasLegacyPlaintext,
  importPlaintextOptIn,
  migrateLegacyKeys,
  PLAINTEXT_EXPORT_WARNING,
} from '@/lib/credential-vault';
import type { KeyStorage } from '@/lib/settings-keys';

function memoryStorage(initial: Record<string, string> = {}): KeyStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const LEGACY = {
  repopilot_jules_key: 'jules-legacy-secret',
  repopilot_gemini_key: 'AIzaSy-legacy-gemini-secret',
  repopilot_github_pat: 'ghp_legacygithubsecret',
};

describe('credential vault migration & wipe', () => {
  it('ingests legacy keys, writes the encrypted blob, and wipes localStorage', async () => {
    const storage = memoryStorage({
      ...LEGACY,
      repopilot_vault_blueprints: '[{"blueprintId":"bp_keep"}]',
      unrelated_key: 'keep',
    });
    const store = createMemoryIdbStore();
    const result = await migrateLegacyKeys(storage, 'migration passphrase', store);

    expect(result.migrated.sort()).toEqual(
      ['repopilot_gemini_key', 'repopilot_github_pat', 'repopilot_jules_key'].sort()
    );
    const envelope = await store.read();
    expect(envelope).not.toBeNull();
    expect(envelope!.version).toBe(1);

    expect(storage.getItem('repopilot_jules_key')).toBeNull();
    expect(storage.getItem('repopilot_gemini_key')).toBeNull();
    expect(storage.getItem('repopilot_github_pat')).toBeNull();
    expect(hasLegacyPlaintext(storage)).toBe(false);
    expect(hasAnyLegacyKey(storage)).toBe(false);
  });

  it('preserves non-credential localStorage entries during the wipe', async () => {
    const storage = memoryStorage({
      ...LEGACY,
      repopilot_vault_blueprints: '[{"blueprintId":"bp_keep"}]',
      repopilot_verified_jules: '2026-01-01T00:00:00.000Z',
      repopilot_onboarding_dismissed: '1',
      unrelated_key: 'keep',
      session_token: 'keep',
    });
    const store = createMemoryIdbStore();
    await migrateLegacyKeys(storage, 'migration passphrase', store);

    expect(storage.getItem('repopilot_vault_blueprints')).toBe('[{"blueprintId":"bp_keep"}]');
    expect(storage.getItem('repopilot_verified_jules')).toBe('2026-01-01T00:00:00.000Z');
    expect(storage.getItem('repopilot_onboarding_dismissed')).toBe('1');
    expect(storage.getItem('unrelated_key')).toBe('keep');
    expect(storage.getItem('session_token')).toBe('keep');
  });

  it('fails closed on empty passphrase without wiping', async () => {
    const storage = memoryStorage({ ...LEGACY });
    const store = createMemoryIdbStore();
    await expect(migrateLegacyKeys(storage, '   ', store)).rejects.toThrow();
    expect(await store.read()).toBeNull();
    expect(storage.getItem('repopilot_jules_key')).toBe('jules-legacy-secret');
  });

  it('migrates only keys that exist and still wipes empties', async () => {
    const storage = memoryStorage({ repopilot_jules_key: 'only-jules' });
    const store = createMemoryIdbStore();
    const result = await migrateLegacyKeys(storage, 'migration passphrase', store);
    expect(result.migrated).toEqual(['repopilot_jules_key']);
    expect(await store.read()).not.toBeNull();
    expect(storage.getItem('repopilot_jules_key')).toBeNull();
  });

  it('detects legacy plaintext presence for the fail-closed prompt', () => {
    expect(hasLegacyPlaintext(memoryStorage({ repopilot_jules_key: 'x' }))).toBe(true);
    expect(hasLegacyPlaintext(memoryStorage({ repopilot_jules_key: '   ' }))).toBe(false);
    expect(hasLegacyPlaintext(memoryStorage({ repopilot_vault_blueprints: '[]' }))).toBe(false);
    expect(hasLegacyPlaintext(memoryStorage({}))).toBe(false);
  });

  it('labels opt-in plaintext transfers with an explicit warning', () => {
    const creds = importPlaintextOptIn(
      JSON.stringify({ julesKey: 'a', geminiKey: 'b', githubPat: 'c' })
    );
    expect(creds).toEqual({ julesKey: 'a', geminiKey: 'b', githubPat: 'c' });
    expect(PLAINTEXT_EXPORT_WARNING).toMatch(/exposes live secrets/i);
  });
});
