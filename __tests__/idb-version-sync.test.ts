import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  indexedDbVaultStore,
  VAULT_IDB_KEY,
  wrapVault,
  unwrapVault,
} from '@/lib/credential-vault';
import {
  indexedDbSteeringRecordStore,
  createSteeringStore,
} from '@/lib/vault/steering-store';
import { openVaultDb, VAULT_IDB_DB, VAULT_IDB_VERSION } from '@/lib/vault/open-db';
import { getGoal, indexedDbGoalRecordStore, saveGoal } from '@/lib/goals/storage';
import { buildGoal } from '@/lib/goals/types';
import type { RepoProfile } from '@/lib/types/steering';

const PASS = 'upgrade test passphrase';
const CREDS = { julesKey: 'jules-key-123', geminiKey: 'gemini-key-456', githubPat: 'ghp_pat789' };

function sampleProfile(): RepoProfile {
  return {
    id: 'org/repo',
    repoRef: { owner: 'org', repo: 'repo', defaultBranch: 'main' },
    stack: { packageManager: 'npm', languages: ['TypeScript'] },
    conventions: [],
    updatedAt: '2026-09-01T12:00:00.000Z',
    version: 1,
  };
}

class FakeIDBDatabase {
  version: number;
  objectStoreNames: {
    contains(name: string): boolean;
  };
  private stores = new Map<string, Map<string, unknown>>();

  constructor(version: number) {
    this.version = version;
    const storeMap = this.stores;
    this.objectStoreNames = {
      contains(name: string) {
        return storeMap.has(name);
      },
    };
  }

  createObjectStore(name: string) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
  }

  getStore(name: string) {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
    }
    return s;
  }

  transaction(storeName: string, mode: 'readonly' | 'readwrite') {
    const storeMap = this.getStore(storeName);
    return {
      objectStore() {
        return {
          get(key: string) {
            const req: any = { result: storeMap.get(key) ?? undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
          put(val: unknown, key: string) {
            storeMap.set(key, val);
            const req: any = { result: key, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
          delete(key: string) {
            storeMap.delete(key);
            const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
          getAllKeys() {
            const keys = Array.from(storeMap.keys());
            const req: any = { result: keys, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
          getAll() {
            const vals = Array.from(storeMap.values());
            const req: any = { result: vals, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
        };
      },
    };
  }

  close() {}
}

function createFakeIndexedDB() {
  let dbInstance: FakeIDBDatabase | null = null;

  return {
    open(name: string, version?: number) {
      const targetVersion = version ?? 1;
      const request: any = {
        result: null,
        error: null,
        onsuccess: null,
        onupgradeneeded: null,
        onerror: null,
      };

      queueMicrotask(() => {
        if (!dbInstance) {
          dbInstance = new FakeIDBDatabase(targetVersion);
          request.result = dbInstance;
          if (request.onupgradeneeded) {
            request.onupgradeneeded({ target: request });
          }
        } else if (targetVersion > dbInstance.version) {
          dbInstance.version = targetVersion;
          request.result = dbInstance;
          if (request.onupgradeneeded) {
            request.onupgradeneeded({ target: request });
          }
        } else if (targetVersion < dbInstance.version) {
          request.error = new Error(`VersionError: expected ${dbInstance.version} <= ${targetVersion}`);
          if (request.onerror) {
            request.onerror({ target: request });
          }
          return;
        } else {
          request.result = dbInstance;
        }

        if (request.onsuccess) {
          request.onsuccess({ target: request });
        }
      });

      return request;
    },
    deleteDatabase() {
      dbInstance = null;
    },
    getDb() {
      return dbInstance;
    },
  };
}

describe('IndexedDB Version Synchronization & Upgrade Path', () => {
  let fakeIDB: ReturnType<typeof createFakeIndexedDB>;
  let originalIndexedDB: any;

  beforeEach(() => {
    fakeIDB = createFakeIndexedDB();
    originalIndexedDB = (globalThis as any).indexedDB;
    (globalThis as any).indexedDB = fakeIDB;
  });

  afterEach(() => {
    (globalThis as any).indexedDB = originalIndexedDB;
  });

  it('opens credential vault store then steering store without VersionError', async () => {
    const credStore = indexedDbVaultStore();
    const env = await wrapVault(CREDS, PASS);
    await credStore.write(env);

    const steeringRecordStore = indexedDbSteeringRecordStore();
    const steeringStore = createSteeringStore(steeringRecordStore);
    steeringStore.unlock(PASS);

    await steeringStore.saveRepoProfile(sampleProfile());

    expect(await credStore.read()).toEqual(env);
    expect(await steeringStore.getRepoProfile('org/repo')).toEqual(sampleProfile());
  });

  it('opens steering store then credential vault store without VersionError', async () => {
    const steeringRecordStore = indexedDbSteeringRecordStore();
    const steeringStore = createSteeringStore(steeringRecordStore);
    steeringStore.unlock(PASS);

    await steeringStore.saveRepoProfile(sampleProfile());

    const credStore = indexedDbVaultStore();
    const env = await wrapVault(CREDS, PASS);
    await credStore.write(env);

    expect(await steeringStore.getRepoProfile('org/repo')).toEqual(sampleProfile());
    expect(await credStore.read()).toEqual(env);
  });

  it('upgrades legacy v1 DB (vault store only) to the current version cleanly while retaining vault data', async () => {
    const envelope = await wrapVault(CREDS, PASS);

    // 1. Manually open DB at version 1 and populate 'vault' store as in old COR-35
    const req1 = indexedDB.open(VAULT_IDB_DB, 1);
    await new Promise<void>((resolve) => {
      req1.onupgradeneeded = () => {
        req1.result.createObjectStore('vault');
      };
      req1.onsuccess = () => resolve();
    });

    const credStoreV1 = indexedDbVaultStore();
    await credStoreV1.write(envelope);

    // 2. Open via the unified openVaultDb
    const db = await openVaultDb();
    expect(db.version).toBe(VAULT_IDB_VERSION);
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains('vault')).toBe(true);
    expect(db.objectStoreNames.contains('profiles-v1')).toBe(true);
    expect(db.objectStoreNames.contains('snippets-v1')).toBe(true);
    // COR-56: goals live in the same database, provisioned by the same upgrade.
    expect(db.objectStoreNames.contains('goals-v1')).toBe(true);

    // 3. Verify credential vault still reads and unwraps existing ciphertext envelope
    const credStore = indexedDbVaultStore();
    const readEnv = await credStore.read();
    expect(readEnv).not.toBeNull();
    const unwrapped = await unwrapVault(readEnv!, PASS);
    expect(unwrapped).toEqual(CREDS);

    // 4. Verify steering store operates normally on the upgraded DB
    const steeringRecordStore = indexedDbSteeringRecordStore();
    const steeringStore = createSteeringStore(steeringRecordStore);
    steeringStore.unlock(PASS);
    await steeringStore.saveRepoProfile(sampleProfile());
    expect(await steeringStore.getRepoProfile('org/repo')).toEqual(sampleProfile());
  });

  it('provisions goals-v1 when upgrading an operator already on vault version 2', async () => {
    // A v2 database already exists for anyone who ran the pre-COR-56 build. Its
    // upgrade handler must not re-run, so the bump to 3 is the only thing that
    // can add the goals store — that is the regression this pins.
    const req2 = indexedDB.open(VAULT_IDB_DB, 2);
    await new Promise<void>((resolve) => {
      req2.onupgradeneeded = () => {
        req2.result.createObjectStore('vault');
        req2.result.createObjectStore('profiles-v1');
        req2.result.createObjectStore('snippets-v1');
      };
      req2.onsuccess = () => resolve();
    });
    expect(fakeIDB.getDb()!.objectStoreNames.contains('goals-v1')).toBe(false);

    const db = await openVaultDb();
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains('goals-v1')).toBe(true);
    // Idempotent: re-opening at the same version must not throw a store error.
    const reopened = await openVaultDb();
    expect(reopened.objectStoreNames.contains('goals-v1')).toBe(true);
  });

  it('round-trips a goal through the goals-v1 store sharing the credential passphrase', async () => {
    const goal = buildGoal({
      sessionId: 'draft-1234',
      repo: 'org/repo',
      rawText: 'Add an empty-scan save guard',
      extracted: {
        title: 'Add empty-scan save guard',
        scope: ['lib/repo-profile/save-policy.ts'],
        acceptanceCriteria: ['npm test lib/repo-profile/save-policy.test.ts covers the empty scan'],
        assumptions: ['No new dependencies'],
        ambiguityFlags: [],
      },
    });

    const goalStore = indexedDbGoalRecordStore();
    await saveGoal(goal, PASS, goalStore);
    expect(await getGoal(goal.sessionId, PASS, goalStore)).toEqual(goal);

    // The credential vault written before the goal is untouched by the goal write.
    const credStore = indexedDbVaultStore();
    const env = await wrapVault(CREDS, PASS);
    await credStore.write(env);
    expect(await getGoal(goal.sessionId, PASS, goalStore)).toEqual(goal);
  });
});
