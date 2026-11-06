import { afterEach, describe, expect, it } from 'vitest';
import {
  GOALS_STORE_NAME,
  STEERING_PROFILES_STORE,
  STEERING_SNIPPETS_STORE,
  VAULT_IDB_DB,
  VAULT_IDB_VERSION,
  VAULT_STORE_NAME,
  isIndexedDbAvailable,
  openVaultDb,
} from '@/lib/vault/open-db';

const STORAGE_UNAVAILABLE = 'Credential vault storage is unavailable in this environment.';

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
      } = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (!db) {
          db = new FakeDatabase(target);
          request.result = db;
          request.onupgradeneeded?.({ target: request });
        } else if (target > db.version) {
          db.version = target;
          request.result = db;
          request.onupgradeneeded?.({ target: request });
        } else if (target < db.version) {
          request.error = new Error('VersionError');
          request.onerror?.({ target: request });
          return;
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

describe('openVaultDb', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('reports the fixed database name, version, and store names', () => {
    expect(VAULT_IDB_DB).toBe('repopilot-credential-vault');
    expect(VAULT_IDB_VERSION).toBe(3);
    expect(VAULT_STORE_NAME).toBe('vault');
    expect(STEERING_PROFILES_STORE).toBe('profiles-v1');
    expect(STEERING_SNIPPETS_STORE).toBe('snippets-v1');
    expect(GOALS_STORE_NAME).toBe('goals-v1');
  });

  it('rejects with a fixed sentence when IndexedDB is unavailable', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      expect(isIndexedDbAvailable()).toBe(false);
      await expect(openVaultDb()).rejects.toThrow(STORAGE_UNAVAILABLE);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    }
  });

  it('rejects open failures with the same fixed sentence', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: {
        open() {
          const request: {
            error: Error;
            onsuccess: null;
            onerror: ((ev: unknown) => void) | null;
            onupgradeneeded: null;
          } = {
            error: new Error('secret-disk-path'),
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          queueMicrotask(() => request.onerror?.({ target: request }));
          return request;
        },
      },
    });
    try {
      await expect(openVaultDb()).rejects.toThrow(STORAGE_UNAVAILABLE);
      await expect(openVaultDb()).rejects.not.toThrow('secret-disk-path');
    } finally {
      if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
      else delete (globalThis as { indexedDB?: unknown }).indexedDB;
    }
  });

  it('creates every vault store on first open and reopens the same version', async () => {
    restore = installFakeIndexedDB();
    const db = await openVaultDb();
    expect(db.version).toBe(VAULT_IDB_VERSION);
    expect(db.objectStoreNames.contains(VAULT_STORE_NAME)).toBe(true);
    expect(db.objectStoreNames.contains(STEERING_PROFILES_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(STEERING_SNIPPETS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(GOALS_STORE_NAME)).toBe(true);

    const again = await openVaultDb();
    expect(again.version).toBe(3);
    expect(again.objectStoreNames.contains(GOALS_STORE_NAME)).toBe(true);
    expect(isIndexedDbAvailable()).toBe(true);
  });
});
