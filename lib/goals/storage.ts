import { Goal } from './types';
import {
  VAULT_CORRUPT_MESSAGE,
  VAULT_PASSPHRASE_REQUIRED,
  VAULT_UNLOCK_FAILED,
  decodeBase64,
  deriveKek,
  encodeBase64,
} from '@/lib/credential-vault';

export interface GoalEnvelope {
  version: 1;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  updatedAt: string;
}

export const GOALS_IDB_DB = 'repopilot-goals-v1';
export const GOALS_IDB_VERSION = 1;
export const GOALS_STORE_NAME = 'goals';

const SALT_BYTES = 16;
const IV_BYTES = 12;

function getSubtle(): SubtleCrypto {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto is unavailable in this environment.');
  }
  return cryptoObj.subtle;
}

function getRandomValues(array: Uint8Array): Uint8Array {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('WebCrypto is unavailable in this environment.');
  }
  return cryptoObj.getRandomValues(array);
}

function assertPassphrase(passphrase: string): string {
  if (!passphrase || !passphrase.trim()) {
    throw new Error(VAULT_PASSPHRASE_REQUIRED);
  }
  return passphrase;
}

function isGoalEnvelopeShape(value: unknown): value is GoalEnvelope {
  if (!value || typeof value !== 'object') return false;
  const env = value as Record<string, unknown>;
  return (
    env.version === 1 &&
    typeof env.saltB64 === 'string' &&
    env.saltB64.length > 0 &&
    typeof env.ivB64 === 'string' &&
    env.ivB64.length > 0 &&
    typeof env.ciphertextB64 === 'string' &&
    env.ciphertextB64.length > 0
  );
}

export async function wrapGoal(goal: Goal, passphrase: string): Promise<GoalEnvelope> {
  const cleanPass = assertPassphrase(passphrase);
  const subtle = getSubtle();
  const salt = getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(cleanPass, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(goal));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, plaintext);

  return {
    version: 1,
    saltB64: encodeBase64(salt),
    ivB64: encodeBase64(iv),
    ciphertextB64: encodeBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

export async function unwrapGoal(envelope: GoalEnvelope, passphrase: string): Promise<Goal> {
  const cleanPass = assertPassphrase(passphrase);
  if (!isGoalEnvelopeShape(envelope)) {
    throw new Error(VAULT_CORRUPT_MESSAGE);
  }
  try {
    const subtle = getSubtle();
    const salt = decodeBase64(envelope.saltB64);
    const iv = decodeBase64(envelope.ivB64);
    const ciphertext = decodeBase64(envelope.ciphertextB64);
    const kek = await deriveKek(cleanPass, salt);
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      kek,
      ciphertext as BufferSource
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Goal;
    if (typeof parsed.sessionId !== 'string' || typeof parsed.rawText !== 'string') {
      throw new Error(VAULT_CORRUPT_MESSAGE);
    }
    return parsed;
  } catch (err) {
    if (err instanceof Error && (err.message === VAULT_PASSPHRASE_REQUIRED || err.message === VAULT_CORRUPT_MESSAGE)) {
      throw err;
    }
    throw new Error(VAULT_UNLOCK_FAILED);
  }
}

export interface GoalRecordStore {
  read(sessionId: string): Promise<GoalEnvelope | null>;
  write(sessionId: string, envelope: GoalEnvelope): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export function openGoalsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Goal vault storage is unavailable in this environment.'));
      return;
    }
    const request = indexedDB.open(GOALS_IDB_DB, GOALS_IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GOALS_STORE_NAME)) {
        db.createObjectStore(GOALS_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Goal vault storage is unavailable in this environment.'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Goal vault storage is unavailable in this environment.'));
  });
}

export function indexedDbGoalRecordStore(): GoalRecordStore {
  return {
    async read(sessionId) {
      const db = await openGoalsDb();
      try {
        const tx = db.transaction(GOALS_STORE_NAME, 'readonly');
        const value = await idbRequest(tx.objectStore(GOALS_STORE_NAME).get(sessionId));
        db.close();
        return isGoalEnvelopeShape(value) ? (value as GoalEnvelope) : null;
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignore
        }
        throw err;
      }
    },
    async write(sessionId, envelope) {
      if (!isGoalEnvelopeShape(envelope)) {
        throw new Error(VAULT_CORRUPT_MESSAGE);
      }
      const db = await openGoalsDb();
      try {
        const tx = db.transaction(GOALS_STORE_NAME, 'readwrite');
        await idbRequest(tx.objectStore(GOALS_STORE_NAME).put(envelope, sessionId));
        db.close();
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignore
        }
        throw err;
      }
    },
    async delete(sessionId) {
      const db = await openGoalsDb();
      try {
        const tx = db.transaction(GOALS_STORE_NAME, 'readwrite');
        await idbRequest(tx.objectStore(GOALS_STORE_NAME).delete(sessionId));
        db.close();
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignore
        }
        throw err;
      }
    },
  };
}

export function createMemoryGoalRecordStore(): GoalRecordStore {
  const map = new Map<string, GoalEnvelope>();
  return {
    async read(sessionId) {
      return map.get(sessionId) ?? null;
    },
    async write(sessionId, envelope) {
      if (!isGoalEnvelopeShape(envelope)) {
        throw new Error(VAULT_CORRUPT_MESSAGE);
      }
      map.set(sessionId, envelope);
    },
    async delete(sessionId) {
      map.delete(sessionId);
    },
  };
}

const defaultRecordStore = typeof indexedDB !== 'undefined' ? indexedDbGoalRecordStore() : createMemoryGoalRecordStore();

export async function saveGoal(
  goal: Goal,
  passphrase: string,
  store: GoalRecordStore = defaultRecordStore
): Promise<void> {
  const envelope = await wrapGoal(goal, passphrase);
  await store.write(goal.sessionId, envelope);
}

export async function loadGoal(
  sessionId: string,
  passphrase: string,
  store: GoalRecordStore = defaultRecordStore
): Promise<Goal | null> {
  const envelope = await store.read(sessionId);
  if (!envelope) return null;
  return unwrapGoal(envelope, passphrase);
}

export async function deleteGoal(
  sessionId: string,
  store: GoalRecordStore = defaultRecordStore
): Promise<void> {
  await store.delete(sessionId);
}
