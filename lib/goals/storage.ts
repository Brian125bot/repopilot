import { z } from 'zod';
import {
  GOALS_STORE_NAME,
  isIndexedDbAvailable,
  openVaultDb,
} from '@/lib/vault/open-db';
import {
  unwrapRecord,
  wrapRecord,
  type SteeringEnvelope,
} from '@/lib/vault/steering-store';
import { GoalSchema, parseGoal, type Goal } from '@/lib/goals/types';

/**
 * COR-56 goal storage.
 *
 * Goals never leave the browser: each record is AES-GCM encrypted with the
 * operator's vault passphrase and written to the `goals-v1` object store inside
 * the existing `repopilot-credential-vault` database. The crypto and envelope
 * format are reused verbatim from the steering store rather than reimplemented,
 * so goals and steering profiles share one passphrase and one key derivation.
 *
 * Every failure is thrown as a `GoalVaultError`. Nothing here degrades silently:
 * a storage or encryption failure must reach the operator instead of leaving
 * them believing a goal was saved.
 */

export const GOAL_STORAGE_UNAVAILABLE =
  'Credential vault storage is unavailable in this environment.';
export const GOAL_VAULT_PASSPHRASE_REQUIRED =
  'A vault passphrase is required to store or read a goal.';
export const GOAL_VAULT_SAVE_FAILED =
  'Failed to save goal to vault — please check your passphrase and retry.';
export const GOAL_VAULT_READ_FAILED =
  'Failed to read goal from vault — the passphrase may be wrong or the record corrupted.';
export const GOAL_SESSION_ID_REQUIRED = 'A non-empty goal session id is required.';

export class GoalVaultError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GoalVaultError';
  }
}

export function isGoalVaultError(value: unknown): value is GoalVaultError {
  return value instanceof GoalVaultError;
}

export type GoalEnvelope = SteeringEnvelope;

export interface GoalRecordStore {
  read(sessionId: string): Promise<GoalEnvelope | null>;
  write(sessionId: string, envelope: GoalEnvelope): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(GOAL_STORAGE_UNAVAILABLE));
  });
}

function closeDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Ignore close failures — the transaction outcome is what callers act on.
  }
}

/** IndexedDB-backed store inside the unified vault database. */
export function indexedDbGoalRecordStore(): GoalRecordStore {
  return {
    async read(sessionId) {
      const db = await openVaultDb();
      try {
        const tx = db.transaction(GOALS_STORE_NAME, 'readonly');
        const value = await idbRequest(tx.objectStore(GOALS_STORE_NAME).get(sessionId));
        closeDb(db);
        return value && typeof value === 'object' ? (value as GoalEnvelope) : null;
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
    async write(sessionId, envelope) {
      const db = await openVaultDb();
      try {
        const tx = db.transaction(GOALS_STORE_NAME, 'readwrite');
        await idbRequest(tx.objectStore(GOALS_STORE_NAME).put(envelope, sessionId));
        closeDb(db);
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
    async delete(sessionId) {
      const db = await openVaultDb();
      try {
        const tx = db.transaction(GOALS_STORE_NAME, 'readwrite');
        await idbRequest(tx.objectStore(GOALS_STORE_NAME).delete(sessionId));
        closeDb(db);
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
  };
}

/** In-memory store for hermetic tests. Never encrypted-at-rest concerns apply. */
export function createMemoryGoalRecordStore(): GoalRecordStore {
  const records = new Map<string, GoalEnvelope>();
  return {
    async read(sessionId) {
      return records.get(sessionId) ?? null;
    },
    async write(sessionId, envelope) {
      records.set(sessionId, envelope);
    },
    async delete(sessionId) {
      records.delete(sessionId);
    },
  };
}

/**
 * Resolved per call rather than at module load: `indexedDB` availability is
 * decided by the environment, and tests inject a store explicitly.
 */
function resolveStore(store?: GoalRecordStore): GoalRecordStore {
  if (store) return store;
  if (!isIndexedDbAvailable()) {
    throw new GoalVaultError(GOAL_STORAGE_UNAVAILABLE);
  }
  return indexedDbGoalRecordStore();
}

function assertPassphrase(passphrase?: string): string {
  if (!passphrase || !passphrase.trim()) {
    throw new GoalVaultError(GOAL_VAULT_PASSPHRASE_REQUIRED);
  }
  return passphrase;
}

function assertSessionId(sessionId: string): string {
  if (!sessionId || !sessionId.trim()) {
    throw new GoalVaultError(GOAL_SESSION_ID_REQUIRED);
  }
  return sessionId.trim();
}

/**
 * Encrypts and stores a goal. Throws `GoalVaultError` when the passphrase is
 * missing, storage is unavailable, encryption fails, or the write is rejected.
 */
export async function saveGoal(
  goal: Goal,
  passphrase?: string,
  store?: GoalRecordStore
): Promise<void> {
  const parsed = parseGoal(goal);
  const cleanPass = assertPassphrase(passphrase);
  const recordStore = resolveStore(store);
  let envelope: GoalEnvelope;
  try {
    envelope = await wrapRecord(parsed, cleanPass);
  } catch (err) {
    throw new GoalVaultError(GOAL_VAULT_SAVE_FAILED, err);
  }
  try {
    await recordStore.write(parsed.sessionId, envelope);
  } catch (err) {
    throw new GoalVaultError(GOAL_VAULT_SAVE_FAILED, err);
  }
}

/**
 * Decrypts and returns the goal for a session, or `null` when none is stored.
 * A wrong passphrase or a corrupt record surfaces as `GoalVaultError` rather
 * than an empty result.
 */
export async function getGoal(
  sessionId: string,
  passphrase?: string,
  store?: GoalRecordStore
): Promise<Goal | null> {
  const key = assertSessionId(sessionId);
  const cleanPass = assertPassphrase(passphrase);
  const recordStore = resolveStore(store);
  let envelope: GoalEnvelope | null;
  try {
    envelope = await recordStore.read(key);
  } catch (err) {
    throw new GoalVaultError(GOAL_VAULT_READ_FAILED, err);
  }
  if (!envelope) return null;
  try {
    return await unwrapRecord<Goal>(envelope, cleanPass, GoalSchema as unknown as z.ZodType<Goal>);
  } catch (err) {
    throw new GoalVaultError(GOAL_VAULT_READ_FAILED, err);
  }
}

export async function deleteGoal(sessionId: string, store?: GoalRecordStore): Promise<void> {
  const key = assertSessionId(sessionId);
  const recordStore = resolveStore(store);
  try {
    await recordStore.delete(key);
  } catch (err) {
    throw new GoalVaultError(GOAL_VAULT_READ_FAILED, err);
  }
}