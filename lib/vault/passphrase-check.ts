import { z } from 'zod';
import {
  VAULT_CORRUPT_MESSAGE,
  VAULT_PASSPHRASE_CHECK_VALUE,
  VAULT_PASSPHRASE_REQUIRED,
  VAULT_UNLOCK_FAILED,
  indexedDbVaultStore,
  unwrapVault,
} from '@/lib/credential-vault';
import {
  GOALS_STORE_NAME,
  VAULT_STORE_NAME,
  isIndexedDbAvailable,
  openVaultDb,
} from '@/lib/vault/open-db';
import {
  indexedDbSteeringRecordStore,
  unwrapRecord,
  wrapRecord,
  type SteeringEnvelope,
} from '@/lib/vault/steering-store';

/** IndexedDB key, inside the credential `vault` store, for the open-path verifier. */
export const PASSPHRASE_CHECK_KEY = 'passphrase-check';

const STORAGE_UNAVAILABLE = 'Credential vault storage is unavailable in this environment.';

const CheckSchema = z.object({ check: z.literal(VAULT_PASSPHRASE_CHECK_VALUE) }).strict();

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(STORAGE_UNAVAILABLE));
  });
}

function closeDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // The request result is what callers act on.
  }
}

function isEnvelope(value: unknown): value is SteeringEnvelope {
  if (!value || typeof value !== 'object') return false;
  const env = value as Record<string, unknown>;
  return (
    env.version === 1 &&
    typeof env.saltB64 === 'string' &&
    env.saltB64.length > 0 &&
    typeof env.ivB64 === 'string' &&
    env.ivB64.length > 0 &&
    typeof env.ciphertextB64 === 'string' &&
    env.ciphertextB64.length > 0 &&
    typeof env.updatedAt === 'string'
  );
}

function requirePassphrase(passphrase: string): void {
  if (!passphrase || !passphrase.trim()) {
    throw new Error(VAULT_PASSPHRASE_REQUIRED);
  }
  if (!isIndexedDbAvailable()) {
    throw new Error(STORAGE_UNAVAILABLE);
  }
}

async function readVaultKey(key: string): Promise<unknown> {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
    const value = await idbRequest(tx.objectStore(VAULT_STORE_NAME).get(key));
    closeDb(db);
    return value;
  } catch (err) {
    closeDb(db);
    throw err;
  }
}

async function writeVaultKey(key: string, value: unknown): Promise<void> {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
    await idbRequest(tx.objectStore(VAULT_STORE_NAME).put(value, key));
    closeDb(db);
  } catch (err) {
    closeDb(db);
    throw err;
  }
}

async function readGoalEnvelopes(): Promise<SteeringEnvelope[]> {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(GOALS_STORE_NAME, 'readonly');
    const values = await idbRequest(tx.objectStore(GOALS_STORE_NAME).getAll());
    closeDb(db);
    return (Array.isArray(values) ? values : []).filter(isEnvelope);
  } catch (err) {
    closeDb(db);
    throw err;
  }
}

async function collectSealedRecords(): Promise<SteeringEnvelope[]> {
  const steering = indexedDbSteeringRecordStore();
  const [snippets, profiles, goals] = await Promise.all([
    steering.list('snippets'),
    steering.list('profiles'),
    readGoalEnvelopes(),
  ]);
  const records: SteeringEnvelope[] = [];
  for (const entry of [...snippets, ...profiles]) {
    if (entry.key.startsWith('builtin-')) continue;
    records.push(entry.envelope);
  }
  records.push(...goals);
  return records;
}

/** Writes (or replaces) the open-path verifier for this passphrase. */
export async function sealPassphraseCheck(passphrase: string): Promise<void> {
  requirePassphrase(passphrase);
  const envelope = await wrapRecord({ check: VAULT_PASSPHRASE_CHECK_VALUE }, passphrase);
  await writeVaultKey(PASSPHRASE_CHECK_KEY, envelope);
}

/** Seals a verifier only when one is not already stored. */
export async function sealPassphraseCheckIfAbsent(passphrase: string): Promise<void> {
  requirePassphrase(passphrase);
  const existing = await readVaultKey(PASSPHRASE_CHECK_KEY);
  if (existing != null) return;
  await sealPassphraseCheck(passphrase);
}

/**
 * Proves a passphrase can open the vault before an unlock is treated as success.
 *
 * Order: stored check value, then the credential envelope, then any sealed
 * steering or goal record. A failed AES-GCM check throws `VAULT_UNLOCK_FAILED`.
 * An empty vault (nothing sealed yet) does not invent a passphrase.
 */
export async function assertPassphraseOpensVault(passphrase: string): Promise<void> {
  requirePassphrase(passphrase);

  const stored = await readVaultKey(PASSPHRASE_CHECK_KEY);
  if (stored != null) {
    if (!isEnvelope(stored)) {
      throw new Error(VAULT_CORRUPT_MESSAGE);
    }
    try {
      await unwrapRecord(stored, passphrase, CheckSchema);
      return;
    } catch (err) {
      if (err instanceof Error && err.message === VAULT_PASSPHRASE_REQUIRED) throw err;
      if (err instanceof Error && err.message === VAULT_UNLOCK_FAILED) {
        // A credential envelope wrapped with this passphrase wins over a stale
        // check (passphrase rotation). Repair the check and open.
        const credentials = await indexedDbVaultStore().read();
        if (credentials) {
          await unwrapVault(credentials, passphrase);
          await sealPassphraseCheck(passphrase);
          return;
        }
        throw err;
      }
      throw new Error(VAULT_CORRUPT_MESSAGE);
    }
  }

  const credentials = await indexedDbVaultStore().read();
  if (credentials) {
    await unwrapVault(credentials, passphrase);
    await sealPassphraseCheckIfAbsent(passphrase);
    return;
  }

  const records = await collectSealedRecords();
  if (records.length === 0) return;

  let proved = false;
  let mismatches = 0;
  for (const envelope of records) {
    try {
      await unwrapRecord(envelope, passphrase, z.unknown());
      proved = true;
      break;
    } catch (err) {
      if (err instanceof Error && err.message === VAULT_UNLOCK_FAILED) mismatches += 1;
    }
  }
  if (proved) {
    await sealPassphraseCheckIfAbsent(passphrase);
    return;
  }
  if (mismatches > 0) throw new Error(VAULT_UNLOCK_FAILED);
  throw new Error(VAULT_CORRUPT_MESSAGE);
}
