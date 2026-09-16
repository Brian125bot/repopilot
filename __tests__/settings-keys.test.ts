import { describe, it, expect } from 'vitest';
import {
  clearAllVerifiedFlags,
  clearRepopilotKeys,
  clearVerifiedFlag,
  hasVerifiedKey,
  isRepopilotCredentialKey,
  markKeyVerified,
  type KeyStorage,
} from '@/lib/settings-keys';

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

describe('settings keys', () => {
  it('identifies only repopilot credential keys', () => {
    expect(isRepopilotCredentialKey('repopilot_jules_key')).toBe(true);
    expect(isRepopilotCredentialKey('repopilot_github_pat')).toBe(true);
    expect(isRepopilotCredentialKey('repopilot_verified_jules')).toBe(false);
    expect(isRepopilotCredentialKey('repopilot_vault_blueprints')).toBe(false);
    expect(isRepopilotCredentialKey('other_key')).toBe(false);
  });

  it('clear-all wipes only repopilot credential entries', () => {
    const storage = memoryStorage({
      repopilot_jules_key: 'a',
      repopilot_gemini_key: 'b',
      repopilot_github_pat: 'c',
      repopilot_vault_blueprints: '[]',
      unrelated_key: 'keep',
      session_token: 'keep',
    });
    const removed = clearRepopilotKeys(storage);
    expect(removed.sort()).toEqual(
      ['repopilot_gemini_key', 'repopilot_github_pat', 'repopilot_jules_key'].sort()
    );
    expect(storage.getItem('repopilot_jules_key')).toBeNull();
    expect(storage.getItem('repopilot_vault_blueprints')).toBe('[]');
    expect(storage.getItem('unrelated_key')).toBe('keep');
    expect(storage.getItem('session_token')).toBe('keep');
  });

  it('verified flags gate dispatch and are set per provider', () => {
    const storage = memoryStorage();
    expect(hasVerifiedKey(storage)).toBe(false);
    markKeyVerified(storage, 'github');
    expect(hasVerifiedKey(storage)).toBe(true);
    markKeyVerified(memoryStorage(), 'jules');
    expect(hasVerifiedKey(memoryStorage({ repopilot_verified_gemini: 'x' }))).toBe(true);
  });

  it('clearing a provider or all flags drops the gate', () => {
    const storage = memoryStorage();
    markKeyVerified(storage, 'jules');
    markKeyVerified(storage, 'github');
    clearVerifiedFlag(storage, 'jules');
    expect(hasVerifiedKey(storage)).toBe(true);
    clearVerifiedFlag(storage, 'github');
    expect(hasVerifiedKey(storage)).toBe(false);
    markKeyVerified(storage, 'gemini');
    expect(clearAllVerifiedFlags(storage)).toEqual(['repopilot_verified_gemini']);
    expect(hasVerifiedKey(storage)).toBe(false);
  });
});
