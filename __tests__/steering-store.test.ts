import { describe, it, expect } from 'vitest';
import { VAULT_LOCKED_MESSAGE } from '@/lib/credential-vault';
import { BUILTIN_SNIPPET_IDS } from '@/lib/snippets/builtin-loader';
import type { RepoProfile, Snippet } from '@/lib/types/steering';
import {
  STEERING_BUILTIN_DELETE_MESSAGE,
  SteeringCorruptError,
  SteeringValidationError,
  VaultLockedError,
  createMemorySteeringRecordStore,
  createSteeringStore,
  unwrapRecord,
  wrapRecord,
} from '@/lib/vault/steering-store';
import { RepoProfileSchema, SnippetSchema } from '@/lib/types/steering';

const STAMP = '2026-09-01T12:00:00.000Z';
const PASS = 'correct horse battery staple';

function profile(id = 'octo/hello-world'): RepoProfile {
  return {
    id,
    repoRef: { owner: 'octo', repo: 'hello-world', defaultBranch: 'main' },
    stack: { packageManager: 'npm', testRunner: 'vitest', framework: 'next', languages: ['TypeScript'] },
    conventions: [{ id: 'conv-commits', title: 'Conventional commits', body: 'Use conventional commit prefixes.' }],
    updatedAt: STAMP,
    version: 1,
  };
}

function snippet(id = 'custom-scope-check'): Snippet {
  return {
    id,
    title: 'Check scope',
    content: 'List every file in scope and flag anything unintended.',
    category: 'investigation',
    isBuiltin: false,
    isPinned: false,
    usageCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

describe('steering store round-trip persistence', () => {
  it('encrypts, stores, decrypts, and retrieves profiles and snippets exactly', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    await store.saveRepoProfile(profile());
    await store.saveSnippet(snippet());
    expect(await store.getRepoProfile(profile().id)).toEqual(profile());
    expect(await store.getSnippet(snippet().id)).toEqual(snippet());
    expect(await store.listRepoProfiles()).toEqual([profile()]);
  });

  it('stores only ciphertext — serialized envelopes never contain plaintext', async () => {
    const profileEnvelope = await wrapRecord(profile(), PASS);
    const snippetEnvelope = await wrapRecord(snippet(), PASS);
    const serialized = JSON.stringify([profileEnvelope, snippetEnvelope]);
    expect(serialized).not.toContain('flag anything unintended');
    expect(serialized).not.toContain('Conventional commits');
    expect(serialized).not.toContain('hello-world');
    expect(profileEnvelope.ciphertextB64.length).toBeGreaterThan(0);
    expect(snippetEnvelope.ciphertextB64.length).toBeGreaterThan(0);
    expect(await unwrapRecord(profileEnvelope, PASS, RepoProfileSchema)).toEqual(profile());
    expect(await unwrapRecord(snippetEnvelope, PASS, SnippetSchema)).toEqual(snippet());
  });

  it('produces distinct envelopes per wrap of the same record', async () => {
    const a = await wrapRecord(snippet(), PASS);
    const b = await wrapRecord(snippet(), PASS);
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.saltB64).not.toBe(b.saltB64);
  });

  it('combines saved customs with built-ins and lets built-ins win collisions', async () => {
    const records = createMemorySteeringRecordStore();
    const store = createSteeringStore(records);
    store.unlock(PASS);
    await store.saveSnippet(snippet());
    const listed = await store.listSnippets();
    const ids = listed.map((entry) => entry.id);
    for (const builtinId of BUILTIN_SNIPPET_IDS) {
      expect(ids).toContain(builtinId);
    }
    expect(ids).toContain(snippet().id);
    await records.write('snippets', BUILTIN_SNIPPET_IDS[0], await wrapRecord(snippet('custom-rogue'), PASS));
    const afterCollision = await store.listSnippets();
    expect(afterCollision.find((entry) => entry.id === BUILTIN_SNIPPET_IDS[0])?.isBuiltin).toBe(true);
  });

  it('deletes profiles and custom snippets, returns null afterwards', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    await store.saveRepoProfile(profile());
    await store.saveSnippet(snippet());
    await store.deleteRepoProfile(profile().id);
    await store.deleteSnippet(snippet().id);
    expect(await store.getRepoProfile(profile().id)).toBeNull();
    expect(await store.getSnippet(snippet().id)).toBeNull();
  });
});

describe('steering store failure modes', () => {
  it('fails cleanly with VaultLockedError while locked', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    expect(store.isLocked()).toBe(true);
    await expect(store.saveRepoProfile(profile())).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.saveRepoProfile(profile())).rejects.toThrow(VAULT_LOCKED_MESSAGE);
    await expect(store.getRepoProfile('x')).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.listRepoProfiles()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.deleteRepoProfile('x')).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.saveSnippet(snippet())).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.getSnippet('x')).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.listSnippets()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.deleteSnippet('x')).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('locks again after lock() and rejects empty passphrases on unlock', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    expect(store.isLocked()).toBe(false);
    store.lock();
    expect(store.isLocked()).toBe(true);
    await expect(store.listRepoProfiles()).rejects.toBeInstanceOf(VaultLockedError);
    expect(() => store.unlock('   ')).toThrow();
  });

  it('prevents deleting built-in snippets', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    await expect(store.deleteSnippet(BUILTIN_SNIPPET_IDS[0])).rejects.toThrow(STEERING_BUILTIN_DELETE_MESSAGE);
  });

  it('rejects custom saves that collide with builtin- ids', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    await expect(store.saveSnippet(snippet('builtin-sneaky'))).rejects.toBeInstanceOf(SteeringValidationError);
  });

  it('handles corrupted ciphertext and mismatched versions without unhandled throws', async () => {
    const records = createMemorySteeringRecordStore();
    const store = createSteeringStore(records);
    store.unlock(PASS);
    const envelope = await wrapRecord(profile(), PASS);
    await records.write('profiles', profile().id, {
      ...envelope,
      ciphertextB64: '!!!not-base64-or-ciphertext!!!',
    });
    await expect(store.getRepoProfile(profile().id)).rejects.toBeInstanceOf(SteeringCorruptError);
    await expect(
      records.write('profiles', profile().id, { ...envelope, version: 999 as never })
    ).rejects.toBeInstanceOf(SteeringCorruptError);
    await records.delete('profiles', profile().id);
    await expect(store.listRepoProfiles()).resolves.toEqual([]);
    await expect(unwrapRecord({ ...envelope, version: 999 as never }, PASS, RepoProfileSchema)).rejects.toBeInstanceOf(
      SteeringCorruptError
    );
  });

  it('rejects wrong passphrases without leaking plaintext', async () => {
    const envelope = await wrapRecord(snippet(), PASS);
    await expect(unwrapRecord(envelope, 'wrong passphrase', SnippetSchema)).rejects.toBeInstanceOf(
      SteeringCorruptError
    );
    await expect(unwrapRecord(envelope, 'wrong passphrase', SnippetSchema)).rejects.not.toThrow(
      'flag anything unintended'
    );
  });
});
