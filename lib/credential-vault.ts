import {
  GEMINI_KEY_STORAGE_KEY,
  GITHUB_PAT_STORAGE_KEY,
  JULES_KEY_STORAGE_KEY,
  LEGACY_CREDENTIAL_STORAGE_KEYS,
  clearRepopilotKeys,
  type KeyStorage,
} from './settings-keys';

export interface VaultCredentials {
  julesKey: string;
  geminiKey: string;
  githubPat: string;
}

export interface VaultEnvelope {
  version: 1;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  updatedAt: string;
}

export type VaultStatus = 'locked' | 'unlocked' | 'empty';

export const VAULT_LOCKED_MESSAGE =
  'Credential vault is locked — unlock with your passphrase to continue.';
export const LOCKED_MESSAGE = VAULT_LOCKED_MESSAGE;
export const VAULT_PASSPHRASE_REQUIRED =
  'A passphrase is required to unlock the credential vault.';
export const VAULT_UNLOCK_FAILED = 'Incorrect passphrase — vault remains locked.';
export const VAULT_CORRUPT_MESSAGE =
  'Saved vault is unreadable — clear it and set up again.';
export const VAULT_IMPORT_INVALID =
  'Import file is not an encrypted vault — plaintext imports are blocked.';
export const VAULT_WIPE_FAILED =
  'Failed to wipe plaintext keys — vault setup aborted.';
export const PLAINTEXT_EXPORT_WARNING =
  'Plain JSON exposes live secrets — anyone with this file controls your Jules/Gemini/GitHub access.';

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const EMPTY_VAULT_CREDENTIALS: VaultCredentials = {
  julesKey: '',
  geminiKey: '',
  githubPat: '',
};

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

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(b64: string): Uint8Array {
  if (!b64 || typeof b64 !== 'string') {
    throw new Error(VAULT_CORRUPT_MESSAGE);
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function assertPassphrase(passphrase: string): string {
  if (!passphrase || !passphrase.trim()) {
    throw new Error(VAULT_PASSPHRASE_REQUIRED);
  }
  return passphrase;
}

export async function deriveKek(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const clean = assertPassphrase(passphrase);
  if (!salt || salt.length < SALT_BYTES) {
    throw new Error(VAULT_CORRUPT_MESSAGE);
  }
  const subtle = getSubtle();
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(clean),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function normalizeCredentials(creds: Partial<VaultCredentials>): VaultCredentials {
  return {
    julesKey: (creds.julesKey ?? '').trim(),
    geminiKey: (creds.geminiKey ?? '').trim(),
    githubPat: (creds.githubPat ?? '').trim(),
  };
}

export async function wrapVault(
  creds: Partial<VaultCredentials>,
  passphrase: string
): Promise<VaultEnvelope> {
  const cleanPass = assertPassphrase(passphrase);
  const normalized = normalizeCredentials(creds);
  const subtle = getSubtle();
  const salt = getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(cleanPass, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(normalized));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, plaintext);
  return {
    version: 1,
    saltB64: encodeBase64(salt),
    ivB64: encodeBase64(iv),
    ciphertextB64: encodeBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

function isEnvelopeShape(value: unknown): value is VaultEnvelope {
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

export async function unwrapVault(
  envelope: VaultEnvelope,
  passphrase: string
): Promise<VaultCredentials> {
  const cleanPass = assertPassphrase(passphrase);
  if (!isEnvelopeShape(envelope)) {
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
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultCredentials>;
    if (
      typeof parsed.julesKey !== 'string' ||
      typeof parsed.geminiKey !== 'string' ||
      typeof parsed.githubPat !== 'string'
    ) {
      throw new Error(VAULT_CORRUPT_MESSAGE);
    }
    return normalizeCredentials(parsed);
  } catch (err) {
    if (err instanceof Error && (err.message === VAULT_PASSPHRASE_REQUIRED || err.message === VAULT_CORRUPT_MESSAGE)) {
      throw err;
    }
    throw new Error(VAULT_UNLOCK_FAILED);
  }
}

export interface VaultIdbStore {
  read(): Promise<VaultEnvelope | null>;
  write(envelope: VaultEnvelope): Promise<void>;
  clear(): Promise<void>;
}

import { VAULT_IDB_DB, VAULT_IDB_VERSION, openVaultDb } from './vault/open-db';
export { VAULT_IDB_DB, VAULT_IDB_VERSION, openVaultDb };
export const VAULT_IDB_KEY = 'vault-v1';

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Credential vault storage is unavailable in this environment.'));
  });
}

export function indexedDbVaultStore(): VaultIdbStore {
  return {
    async read() {
      const db = await openVaultDb();
      try {
        const tx = db.transaction('vault', 'readonly');
        const value = await idbRequest(tx.objectStore('vault').get(VAULT_IDB_KEY));
        db.close();
        return isEnvelopeShape(value) ? (value as VaultEnvelope) : null;
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
        throw err;
      }
    },
    async write(envelope) {
      if (!isEnvelopeShape(envelope)) {
        throw new Error(VAULT_CORRUPT_MESSAGE);
      }
      const db = await openVaultDb();
      try {
        const tx = db.transaction('vault', 'readwrite');
        await idbRequest(tx.objectStore('vault').put(envelope, VAULT_IDB_KEY));
        db.close();
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
        throw err;
      }
    },
    async clear() {
      const db = await openVaultDb();
      try {
        const tx = db.transaction('vault', 'readwrite');
        await idbRequest(tx.objectStore('vault').delete(VAULT_IDB_KEY));
        db.close();
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
        throw err;
      }
    },
  };
}

export function createMemoryIdbStore(): VaultIdbStore {
  let stored: VaultEnvelope | null = null;
  return {
    async read() {
      return stored;
    },
    async write(envelope) {
      if (!isEnvelopeShape(envelope)) {
        throw new Error(VAULT_CORRUPT_MESSAGE);
      }
      stored = envelope;
    },
    async clear() {
      stored = null;
    },
  };
}

export function hasLegacyPlaintext(storage: KeyStorage): boolean {
  return LEGACY_CREDENTIAL_STORAGE_KEYS.some((key) => {
    const value = storage.getItem(key);
    return value !== null && value.trim().length > 0;
  });
}

export function hasAnyLegacyKey(storage: KeyStorage): boolean {
  return LEGACY_CREDENTIAL_STORAGE_KEYS.some((key) => storage.getItem(key) !== null);
}

export async function migrateLegacyKeys(
  storage: KeyStorage,
  passphrase: string,
  store: VaultIdbStore
): Promise<{ migrated: string[]; wiped: string[] }> {
  const cleanPass = assertPassphrase(passphrase);
  const existed = LEGACY_CREDENTIAL_STORAGE_KEYS.filter((key) => storage.getItem(key) !== null);
  const creds: VaultCredentials = {
    julesKey: (storage.getItem(JULES_KEY_STORAGE_KEY) ?? '').trim(),
    geminiKey: (storage.getItem(GEMINI_KEY_STORAGE_KEY) ?? '').trim(),
    githubPat: (storage.getItem(GITHUB_PAT_STORAGE_KEY) ?? '').trim(),
  };
  const envelope = await wrapVault(creds, cleanPass);
  await store.write(envelope);
  const wiped = clearRepopilotKeys(storage);
  for (const key of LEGACY_CREDENTIAL_STORAGE_KEYS) {
    storage.removeItem(key);
    if (!wiped.includes(key) && existed.includes(key)) wiped.push(key);
  }
  for (const key of LEGACY_CREDENTIAL_STORAGE_KEYS) {
    if (storage.getItem(key) !== null) {
      throw new Error(VAULT_WIPE_FAILED);
    }
  }
  return { migrated: existed, wiped };
}

export function exportEncryptedEnvelope(envelope: VaultEnvelope): string {
  if (!isEnvelopeShape(envelope)) {
    throw new Error(VAULT_CORRUPT_MESSAGE);
  }
  return JSON.stringify({ kind: 'repopilot-encrypted-vault', ...envelope });
}

export function importEncryptedEnvelope(json: string): VaultEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  const obj = parsed as Record<string, unknown>;
  if ('julesKey' in obj || 'geminiKey' in obj || 'githubPat' in obj) {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  if (!isEnvelopeShape(obj)) {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  return {
    version: 1,
    saltB64: obj.saltB64,
    ivB64: obj.ivB64,
    ciphertextB64: obj.ciphertextB64,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  };
}

export function exportPlaintextOptIn(creds: Partial<VaultCredentials>): string {
  const normalized = normalizeCredentials(creds);
  return JSON.stringify({ kind: 'repopilot-plaintext-keys', warning: PLAINTEXT_EXPORT_WARNING, ...normalized });
}

export function importPlaintextOptIn(json: string): VaultCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.julesKey !== 'string' ||
    typeof obj.geminiKey !== 'string' ||
    typeof obj.githubPat !== 'string'
  ) {
    throw new Error(VAULT_IMPORT_INVALID);
  }
  return normalizeCredentials(obj as Partial<VaultCredentials>);
}

export type VaultGateResult = { ok: true } | { ok: false; error: string };

export function gateVaultAction(isLocked: boolean): VaultGateResult {
  if (isLocked) return { ok: false, error: VAULT_LOCKED_MESSAGE };
  return { ok: true };
}

export interface MemoryVault {
  unlock(envelope: VaultEnvelope, passphrase: string): Promise<VaultCredentials>;
  setCredentials(creds: Partial<VaultCredentials>): VaultCredentials;
  lock(): void;
  getCredentials(): VaultCredentials | null;
  isLocked(): boolean;
  requireCredentials(): VaultCredentials;
}

export function createMemoryVault(): MemoryVault {
  let creds: VaultCredentials | null = null;
  return {
    async unlock(envelope, passphrase) {
      const unwrapped = await unwrapVault(envelope, passphrase);
      creds = { ...unwrapped };
      return { ...unwrapped };
    },
    setCredentials(next) {
      const normalized = normalizeCredentials(next);
      creds = { ...normalized };
      return { ...normalized };
    },
    lock() {
      if (creds) {
        creds.julesKey = '';
        creds.geminiKey = '';
        creds.githubPat = '';
      }
      creds = null;
    },
    getCredentials() {
      return creds ? { ...creds } : null;
    },
    isLocked() {
      return creds === null;
    },
    requireCredentials() {
      if (!creds) throw new Error(VAULT_LOCKED_MESSAGE);
      return { ...creds };
    },
  };
}
