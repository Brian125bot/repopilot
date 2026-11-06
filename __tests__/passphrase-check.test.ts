import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VAULT_CORRUPT_MESSAGE,
  VAULT_PASSPHRASE_REQUIRED,
  VAULT_UNLOCK_FAILED,
  indexedDbVaultStore,
  wrapVault,
} from '@/lib/credential-vault';
import { buildGoal } from '@/lib/goals/types';
import { indexedDbGoalRecordStore, saveGoal } from '@/lib/goals/storage';
import type { RepoProfile } from '@/lib/types/steering';
import {
  PASSPHRASE_CHECK_KEY,
  assertPassphraseOpensVault,
  sealPassphraseCheck,
} from '@/lib/vault/passphrase-check';
import { openVaultDb } from '@/lib/vault/open-db';
import { createSteeringStore, indexedDbSteeringRecordStore } from '@/lib/vault/steering-store';

const PASS = 'open path passphrase';
const OTHER = 'rotated passphrase';
const CREDS = { julesKey: 'jules-open-secret', geminiKey: 'gemini-open-secret', githubPat: 'ghp_open_secret' };

class FakeDatabase {
  version: number;
  objectStoreNames: { contains(name: string): boolean };
  private stores = new Map<string, Map<string, unknown>>();

  constructor(version: number) {
    this.version = version;
    const stores = this.stores;
    this.objectStoreNames = {
      contains(name: string) {
        return stores.has(name);
      },
    };
  }

  createObjectStore(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }

  getStore(name: string) {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return store;
  }

  transaction(storeName: string) {
    const store = this.getStore(storeName);
    const requestFor = (result: unknown) => {
      const req: {
        result: unknown;
        error: null;
        onsuccess: ((ev: unknown) => void) | null;
        onerror: ((ev: unknown) => void) | null;
      } = { result, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.({ target: req }));
      return req;
    };
    return {
      objectStore() {
        return {
          get: (key: string) => requestFor(store.get(key)),
          put: (value: unknown, key: string) => {
            store.set(key, value);
            return requestFor(key);
          },
          delete: (key: string) => {
            store.delete(key);
            return requestFor(undefined);
          },
          clear: () => {
            store.clear();
            return requestFor(undefined);
          },
          getAllKeys: () => requestFor([...store.keys()]),
          getAll: () => requestFor([...store.values()]),
        };
      },
    };
  }

  close() {}
}

function installFakeIndexedDB() {
  let db: FakeDatabase | null = null;
  const fake = {
    open(_name: string, version?: number) {
      const target = version ?? 1;
      const request: {
        result: FakeDatabase | null;
        error: Error | null;
        onsuccess: ((ev: unknown) => void) | null;
        onerror: ((ev: unknown) => void) | null;
        onupgradeneeded: ((ev: unknown) => void) | null;
      } = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (!db || target > db.version) {
          if (!db) db = new FakeDatabase(target);
          else db.version = target;
          request.result = db;
          request.onupgradeneeded?.({ target: request });
        } else {
          request.result = db;
        }
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: fake });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  };
}

function profile(): RepoProfile {
  return {
    id: 'org/repo',
    repoRef: { owner: 'org', repo: 'repo', defaultBranch: 'main' },
    stack: { packageManager: 'npm', languages: ['TypeScript'] },
    conventions: [],
    updatedAt: '2026-09-01T12:00:00.000Z',
    version: 1,
  };
}

describe('assertPassphraseOpensVault', () => {
  let restore: (() => void) | null = null;

  beforeEach(() => {
    restore = installFakeIndexedDB();
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('allows an empty vault and does not invent a passphrase', async () => {
    await expect(assertPassphraseOpensVault(PASS)).resolves.toBeUndefined();
    const db = await openVaultDb();
    const tx = db.transaction('vault', 'readonly');
    const stored = await new Promise((resolve) => {
      const req = tx.objectStore('vault').get(PASSPHRASE_CHECK_KEY);
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    expect(stored).toBeUndefined();
  });

  it('rejects a blank passphrase before touching storage', async () => {
    await expect(assertPassphraseOpensVault('   ')).rejects.toThrow(VAULT_PASSPHRASE_REQUIRED);
  });

  it('rejects a wrong passphrase against the credential envelope and then seals the right one', async () => {
    await indexedDbVaultStore().write(await wrapVault(CREDS, PASS));
    await expect(assertPassphraseOpensVault('wrong passphrase')).rejects.toThrow(VAULT_UNLOCK_FAILED);
    await expect(assertPassphraseOpensVault('wrong passphrase')).rejects.not.toThrow(CREDS.julesKey);

    await expect(assertPassphraseOpensVault(PASS)).resolves.toBeUndefined();
    await expect(assertPassphraseOpensVault('wrong passphrase')).rejects.toThrow(VAULT_UNLOCK_FAILED);
    await expect(assertPassphraseOpensVault(PASS)).resolves.toBeUndefined();
  });

  it('rejects a wrong passphrase against a sealed steering record', async () => {
    const store = createSteeringStore(indexedDbSteeringRecordStore());
    store.unlock(PASS);
    await store.saveRepoProfile(profile());

    await expect(assertPassphraseOpensVault('wrong passphrase')).rejects.toThrow(VAULT_UNLOCK_FAILED);
    await expect(assertPassphraseOpensVault(PASS)).resolves.toBeUndefined();
  });

  it('rejects a wrong passphrase against a sealed goal', async () => {
    const goal = buildGoal({
      sessionId: 'draft-open',
      repo: 'org/repo',
      rawText: 'Guard the empty scan',
      extracted: null,
    });
    await saveGoal(goal, PASS, indexedDbGoalRecordStore());

    await expect(assertPassphraseOpensVault('wrong passphrase')).rejects.toThrow(VAULT_UNLOCK_FAILED);
    await expect(assertPassphraseOpensVault('wrong passphrase')).rejects.not.toThrow('Guard the empty scan');
    await expect(assertPassphraseOpensVault(PASS)).resolves.toBeUndefined();
  });

  it('treats a non-envelope check record as corrupt', async () => {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite');
      const req = tx.objectStore('vault').put({ nope: true }, PASSPHRASE_CHECK_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();

    await expect(assertPassphraseOpensVault(PASS)).rejects.toThrow(VAULT_CORRUPT_MESSAGE);
  });

  it('repairs a stale check when the credential envelope opens with the new passphrase', async () => {
    await sealPassphraseCheck(PASS);
    await indexedDbVaultStore().write(await wrapVault(CREDS, OTHER));

    await expect(assertPassphraseOpensVault(OTHER)).resolves.toBeUndefined();
    await expect(assertPassphraseOpensVault(PASS)).rejects.toThrow(VAULT_UNLOCK_FAILED);
    await expect(assertPassphraseOpensVault(OTHER)).resolves.toBeUndefined();
  });
});
