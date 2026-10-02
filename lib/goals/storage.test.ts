import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveGoal, getGoal, VaultError } from './storage';
import { Goal } from './types';
import { openVaultDb, VAULT_IDB_DB } from '../vault/open-db';

class FakeIDBDatabase {
  version = 3;
  objectStoreNames = {
    contains(name: string) {
      return name === 'goals-v1' || name === 'vault' || name === 'profiles-v1' || name === 'snippets-v1';
    },
  };
  private storeMap = new Map<string, unknown>();

  transaction(_storeName: string, _mode: 'readonly' | 'readwrite') {
    const storeMap = this.storeMap;
    return {
      objectStore() {
        return {
          get(key: string) {
            const req: any = { result: storeMap.get(key) ?? undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
          put(val: unknown, key?: string) {
            const k = key ?? (val && typeof val === 'object' && 'sessionId' in val ? (val as any).sessionId : undefined);
            storeMap.set(k, val);
            const req: any = { result: k, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
            return req;
          },
          delete(key: string) {
            storeMap.delete(key);
            const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
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
    open(_name: string, _version?: number) {
      const request: any = {
        result: null,
        error: null,
        onsuccess: null,
        onupgradeneeded: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (!dbInstance) dbInstance = new FakeIDBDatabase();
        request.result = dbInstance;
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    },
    deleteDatabase() {
      dbInstance = null;
    },
  };
}

describe('lib/goals/storage', () => {
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

  const sampleExtractedGoal: Goal = {
    id: 'goal-1',
    sessionId: 'session-123',
    repo: 'owner/repo',
    rawText: 'Add rate limiting to login endpoint',
    extracted: {
      title: 'Add rate limiting to login endpoint',
      scope: 'app/api/login/route.ts',
      acceptanceCriteria: ['Return 429 when max login attempts exceeded'],
      assumptions: ['Default limit 5 requests/min'],
      ambiguityFlags: [],
    },
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
  };

  const sampleSkippedGoal: Goal = {
    id: 'goal-2',
    sessionId: 'session-456',
    repo: 'owner/repo',
    rawText: 'Direct instruction without extraction',
    extracted: null,
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
  };

  it('saves and retrieves unencrypted goal when no passphrase is provided', async () => {
    await saveGoal(sampleExtractedGoal);
    const retrieved = await getGoal('session-123');
    expect(retrieved).toEqual(sampleExtractedGoal);
  });

  it('saves and retrieves goal with extracted: null when skipped', async () => {
    await saveGoal(sampleSkippedGoal);
    const retrieved = await getGoal('session-456');
    expect(retrieved).toEqual(sampleSkippedGoal);
  });

  it('saves and retrieves AES-GCM encrypted goal when passphrase is provided', async () => {
    const pass = 'super-secret-passphrase';
    await saveGoal(sampleExtractedGoal, pass);

    // Retrieving without passphrase should fail with VaultError
    await expect(getGoal('session-123')).rejects.toThrow(VaultError);

    // Retrieving with correct passphrase should succeed
    const retrieved = await getGoal('session-123', pass);
    expect(retrieved).toEqual(sampleExtractedGoal);
  });

  it('returns null for non-existent session ID', async () => {
    const result = await getGoal('non-existent');
    expect(result).toBeNull();
  });
});
