import { Goal, GoalSchema } from './types';
import { GOALS_STORE, openVaultDb } from '../vault/open-db';

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export interface GoalEnvelope {
  version: 1;
  encrypted: boolean;
  saltB64?: string;
  ivB64?: string;
  ciphertextB64?: string;
  data?: Goal;
}

const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 210000;

function getSubtle(): SubtleCrypto {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new VaultError('WebCrypto is unavailable in this environment.');
}

function getRandomValues(array: Uint8Array): Uint8Array {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    return window.crypto.getRandomValues(array);
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(array);
  }
  throw new VaultError('WebCrypto is unavailable in this environment.');
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKek(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const clean = passphrase.trim();
  if (!clean) throw new VaultError('Passphrase cannot be empty.');
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

async function encryptGoal(goal: Goal, passphrase: string): Promise<GoalEnvelope> {
  try {
    const subtle = getSubtle();
    const salt = getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = getRandomValues(new Uint8Array(IV_BYTES));
    const kek = await deriveKek(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(goal));
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, plaintext);
    return {
      version: 1,
      encrypted: true,
      saltB64: encodeBase64(salt),
      ivB64: encodeBase64(iv),
      ciphertextB64: encodeBase64(new Uint8Array(ciphertext)),
    };
  } catch (err) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(`Encryption failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function decryptGoal(envelope: GoalEnvelope, passphrase?: string): Promise<Goal> {
  if (!envelope.encrypted) {
    if (!envelope.data) throw new VaultError('Corrupt goal record: missing data in plain envelope.');
    const parsed = GoalSchema.safeParse(envelope.data);
    if (!parsed.success) throw new VaultError('Corrupt goal record schema.');
    return parsed.data;
  }

  if (!passphrase || !passphrase.trim()) {
    throw new VaultError('Passphrase required to decrypt goal record.');
  }

  if (!envelope.saltB64 || !envelope.ivB64 || !envelope.ciphertextB64) {
    throw new VaultError('Corrupt encrypted goal record.');
  }

  try {
    const subtle = getSubtle();
    const salt = decodeBase64(envelope.saltB64);
    const iv = decodeBase64(envelope.ivB64);
    const ciphertext = decodeBase64(envelope.ciphertextB64);
    const kek = await deriveKek(passphrase, salt);
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      kek,
      ciphertext as BufferSource
    );
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    const parsed = GoalSchema.safeParse(decoded);
    if (!parsed.success) throw new VaultError('Decrypted goal failed schema validation.');
    return parsed.data;
  } catch (err) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function saveGoal(goal: Goal, passphrase?: string): Promise<void> {
  const result = GoalSchema.safeParse(goal);
  if (!result.success) {
    throw new VaultError(`Invalid goal structure: ${result.error.issues[0]?.message ?? 'validation failed'}`);
  }

  let envelope: GoalEnvelope;
  if (passphrase && passphrase.trim()) {
    envelope = await encryptGoal(result.data, passphrase);
  } else {
    envelope = {
      version: 1,
      encrypted: false,
      data: result.data,
    };
  }

  try {
    const db = await openVaultDb();
    const tx = db.transaction(GOALS_STORE, 'readwrite');
    const store = tx.objectStore(GOALS_STORE);
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ ...envelope, sessionId: goal.sessionId, updatedAt: goal.updatedAt });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB put error'));
    });
    db.close();
  } catch (err) {
    throw new VaultError(`Failed to save goal to vault: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getGoal(sessionId: string, passphrase?: string): Promise<Goal | null> {
  if (!sessionId || !sessionId.trim()) {
    return null;
  }

  let envelope: GoalEnvelope | null = null;
  try {
    const db = await openVaultDb();
    const tx = db.transaction(GOALS_STORE, 'readonly');
    const store = tx.objectStore(GOALS_STORE);
    envelope = await new Promise<GoalEnvelope | null>((resolve, reject) => {
      const req = store.get(sessionId);
      req.onsuccess = () => resolve((req.result as GoalEnvelope) ?? null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get error'));
    });
    db.close();
  } catch (err) {
    throw new VaultError(`Failed to retrieve goal from vault: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!envelope) {
    return null;
  }

  return decryptGoal(envelope, passphrase);
}
