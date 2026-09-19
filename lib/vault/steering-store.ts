import { z } from 'zod';
import {
  VAULT_CORRUPT_MESSAGE,
  VAULT_LOCKED_MESSAGE,
  VAULT_PASSPHRASE_REQUIRED,
  decodeBase64,
  deriveKek,
  encodeBase64,
} from '@/lib/credential-vault';
import {
  VAULT_IDB_DB,
  VAULT_IDB_VERSION,
  STEERING_PROFILES_STORE,
  STEERING_SNIPPETS_STORE,
  openVaultDb,
} from '@/lib/vault/open-db';
import { getBuiltinSnippets } from '@/lib/snippets/builtin-loader';
import { RepoProfileSchema, SnippetSchema, type RepoProfile, type Snippet } from '@/lib/types/steering';

export class VaultLockedError extends Error {
  constructor() {
    super(VAULT_LOCKED_MESSAGE);
    this.name = 'VaultLockedError';
  }
}

export const STEERING_CORRUPT_MESSAGE =
  'Saved steering data is unreadable — it may be corrupted or use a different passphrase.';
export const STEERING_BUILTIN_DELETE_MESSAGE = 'Built-in snippets cannot be deleted.';
export const STEERING_BUILTIN_OVERWRITE_MESSAGE = 'Custom snippets must not use the builtin- id prefix.';
export const STEERING_INVALID_ID_MESSAGE = 'A non-empty record id is required.';

export class SteeringCorruptError extends Error {
  constructor() {
    super(STEERING_CORRUPT_MESSAGE);
    this.name = 'SteeringCorruptError';
  }
}

export class SteeringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SteeringValidationError';
  }
}

export interface SteeringEnvelope {
  version: 1;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  updatedAt: string;
}

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

function assertRecordId(id: string): string {
  if (!id || !id.trim()) {
    throw new SteeringValidationError(STEERING_INVALID_ID_MESSAGE);
  }
  return id;
}

function isSteeringEnvelopeShape(value: unknown): value is SteeringEnvelope {
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

export async function wrapRecord<T>(obj: T, passphrase: string): Promise<SteeringEnvelope> {
  const cleanPass = assertPassphrase(passphrase);
  const subtle = getSubtle();
  const salt = getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(cleanPass, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, plaintext);
  return {
    version: 1,
    saltB64: encodeBase64(salt),
    ivB64: encodeBase64(iv),
    ciphertextB64: encodeBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

export async function unwrapRecord<T>(
  envelope: SteeringEnvelope,
  passphrase: string,
  schema: z.ZodType<T>
): Promise<T> {
  const cleanPass = assertPassphrase(passphrase);
  if (!isSteeringEnvelopeShape(envelope)) {
    throw new SteeringCorruptError();
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
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new SteeringCorruptError();
    }
    return result.data;
  } catch (err) {
    if (err instanceof SteeringCorruptError) throw err;
    if (err instanceof Error && err.message === VAULT_PASSPHRASE_REQUIRED) throw err;
    if (err instanceof Error && err.message === VAULT_CORRUPT_MESSAGE) {
      throw new SteeringCorruptError();
    }
    throw new SteeringCorruptError();
  }
}

export const STEERING_IDB_DB = VAULT_IDB_DB;
export const STEERING_IDB_VERSION = VAULT_IDB_VERSION;
export { STEERING_PROFILES_STORE, STEERING_SNIPPETS_STORE };

export type SteeringStoreName = 'profiles' | 'snippets';

function storeNameFor(name: SteeringStoreName): string {
  return name === 'profiles' ? STEERING_PROFILES_STORE : STEERING_SNIPPETS_STORE;
}

export interface SteeringRecordStore {
  read(store: SteeringStoreName, key: string): Promise<SteeringEnvelope | null>;
  write(store: SteeringStoreName, key: string, envelope: SteeringEnvelope): Promise<void>;
  delete(store: SteeringStoreName, key: string): Promise<void>;
  list(store: SteeringStoreName): Promise<Array<{ key: string; envelope: SteeringEnvelope }>>;
  clear(): Promise<void>;
}

function openSteeringDb(): Promise<IDBDatabase> {
  return openVaultDb();
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Credential vault storage is unavailable in this environment.'));
  });
}

function closeDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Ignore close failures.
  }
}

export function indexedDbSteeringRecordStore(): SteeringRecordStore {
  return {
    async read(store, key) {
      const db = await openSteeringDb();
      try {
        const tx = db.transaction(storeNameFor(store), 'readonly');
        const value = await idbRequest(tx.objectStore(storeNameFor(store)).get(key));
        closeDb(db);
        return isSteeringEnvelopeShape(value) ? (value as SteeringEnvelope) : null;
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
    async write(store, key, envelope) {
      if (!isSteeringEnvelopeShape(envelope)) {
        throw new SteeringCorruptError();
      }
      const db = await openSteeringDb();
      try {
        const tx = db.transaction(storeNameFor(store), 'readwrite');
        await idbRequest(tx.objectStore(storeNameFor(store)).put(envelope, key));
        closeDb(db);
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
    async delete(store, key) {
      const db = await openSteeringDb();
      try {
        const tx = db.transaction(storeNameFor(store), 'readwrite');
        await idbRequest(tx.objectStore(storeNameFor(store)).delete(key));
        closeDb(db);
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
    async list(store) {
      const db = await openSteeringDb();
      try {
        const tx = db.transaction(storeNameFor(store), 'readonly');
        const objectStore = tx.objectStore(storeNameFor(store));
        const [keys, values] = await Promise.all([
          idbRequest(objectStore.getAllKeys()),
          idbRequest(objectStore.getAll()),
        ]);
        closeDb(db);
        const out: Array<{ key: string; envelope: SteeringEnvelope }> = [];
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i];
          const value = values[i];
          if (typeof key === 'string' && isSteeringEnvelopeShape(value)) {
            out.push({ key, envelope: value as SteeringEnvelope });
          }
        }
        return out;
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
    async clear() {
      const db = await openSteeringDb();
      try {
        const txProfiles = db.transaction(STEERING_PROFILES_STORE, 'readwrite');
        await idbRequest(txProfiles.objectStore(STEERING_PROFILES_STORE).clear());
        const txSnippets = db.transaction(STEERING_SNIPPETS_STORE, 'readwrite');
        await idbRequest(txSnippets.objectStore(STEERING_SNIPPETS_STORE).clear());
        closeDb(db);
      } catch (err) {
        closeDb(db);
        throw err;
      }
    },
  };
}

export function createMemorySteeringRecordStore(): SteeringRecordStore {
  const profiles = new Map<string, SteeringEnvelope>();
  const snippets = new Map<string, SteeringEnvelope>();
  const mapFor = (store: SteeringStoreName) => (store === 'profiles' ? profiles : snippets);
  return {
    async read(store, key) {
      return mapFor(store).get(key) ?? null;
    },
    async write(store, key, envelope) {
      if (!isSteeringEnvelopeShape(envelope)) {
        throw new SteeringCorruptError();
      }
      mapFor(store).set(key, envelope);
    },
    async delete(store, key) {
      mapFor(store).delete(key);
    },
    async list(store) {
      return [...mapFor(store).entries()].map(([key, envelope]) => ({ key, envelope }));
    },
    async clear() {
      profiles.clear();
      snippets.clear();
    },
  };
}

export interface SteeringStore {
  unlock(passphrase: string): void;
  lock(): void;
  isLocked(): boolean;
  saveRepoProfile(profile: RepoProfile): Promise<void>;
  getRepoProfile(id: string): Promise<RepoProfile | null>;
  listRepoProfiles(): Promise<RepoProfile[]>;
  deleteRepoProfile(id: string): Promise<void>;
  saveSnippet(snippet: Snippet): Promise<void>;
  getSnippet(id: string): Promise<Snippet | null>;
  listSnippets(): Promise<Snippet[]>;
  deleteSnippet(id: string): Promise<void>;
}

export function createSteeringStore(recordStore: SteeringRecordStore): SteeringStore {
  let passphrase: string | null = null;

  function requirePassphrase(): string {
    if (!passphrase) throw new VaultLockedError();
    return passphrase;
  }

  return {
    unlock(next: string) {
      passphrase = assertPassphrase(next);
    },
    lock() {
      passphrase = null;
    },
    isLocked() {
      return passphrase === null;
    },
    async saveRepoProfile(profile) {
      const pass = requirePassphrase();
      const result = RepoProfileSchema.safeParse(profile);
      if (!result.success) {
        const message = result.error.issues[0]?.message ?? 'Invalid RepoProfile.';
        throw new SteeringValidationError(message);
      }
      const envelope = await wrapRecord(result.data, pass);
      await recordStore.write('profiles', result.data.id, envelope);
    },
    async getRepoProfile(id) {
      const pass = requirePassphrase();
      const key = assertRecordId(id);
      const envelope = await recordStore.read('profiles', key);
      if (!envelope) return null;
      return unwrapRecord(envelope, pass, RepoProfileSchema);
    },
    async listRepoProfiles() {
      const pass = requirePassphrase();
      const entries = await recordStore.list('profiles');
      const out: RepoProfile[] = [];
      for (const entry of entries) {
        try {
          out.push(await unwrapRecord(entry.envelope, pass, RepoProfileSchema));
        } catch (err) {
          if (err instanceof VaultLockedError) throw err;
          if (err instanceof Error && err.message === VAULT_PASSPHRASE_REQUIRED) throw err;
          console.warn('[steering-store] Skipping unreadable profile entry:', entry.key, err);
        }
      }
      return out;
    },
    async deleteRepoProfile(id) {
      requirePassphrase();
      const key = assertRecordId(id);
      await recordStore.delete('profiles', key);
    },
    async saveSnippet(snippet) {
      const pass = requirePassphrase();
      const result = SnippetSchema.safeParse(snippet);
      if (!result.success) {
        const message = result.error.issues[0]?.message ?? 'Invalid Snippet.';
        throw new SteeringValidationError(message);
      }
      if (result.data.id.startsWith('builtin-')) {
        throw new SteeringValidationError(STEERING_BUILTIN_OVERWRITE_MESSAGE);
      }
      const envelope = await wrapRecord(result.data, pass);
      await recordStore.write('snippets', result.data.id, envelope);
    },
    async getSnippet(id) {
      const pass = requirePassphrase();
      const key = assertRecordId(id);
      if (key.startsWith('builtin-')) {
        return getBuiltinSnippets().find((snippet) => snippet.id === key) ?? null;
      }
      const envelope = await recordStore.read('snippets', key);
      if (!envelope) return null;
      return unwrapRecord(envelope, pass, SnippetSchema);
    },
    async listSnippets() {
      const pass = requirePassphrase();
      const builtins = getBuiltinSnippets();
      const builtinIds = new Set(builtins.map((snippet) => snippet.id));
      const entries = await recordStore.list('snippets');
      const customs: Snippet[] = [];
      for (const entry of entries) {
        if (builtinIds.has(entry.key) || entry.key.startsWith('builtin-')) continue;
        try {
          customs.push(await unwrapRecord(entry.envelope, pass, SnippetSchema));
        } catch (err) {
          if (err instanceof VaultLockedError) throw err;
          if (err instanceof Error && err.message === VAULT_PASSPHRASE_REQUIRED) throw err;
          console.warn('[steering-store] Skipping unreadable snippet entry:', entry.key, err);
        }
      }
      return [...builtins, ...customs];
    },
    async deleteSnippet(id) {
      requirePassphrase();
      const key = assertRecordId(id);
      if (key.startsWith('builtin-')) {
        throw new SteeringValidationError(STEERING_BUILTIN_DELETE_MESSAGE);
      }
      await recordStore.delete('snippets', key);
    },
  };
}

export function createMemorySteeringStore(): SteeringStore {
  return createSteeringStore(createMemorySteeringRecordStore());
}

export function indexedDbSteeringStore(): SteeringStore {
  return createSteeringStore(indexedDbSteeringRecordStore());
}
