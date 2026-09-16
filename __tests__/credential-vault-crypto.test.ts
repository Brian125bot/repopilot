import { describe, it, expect } from 'vitest';
import {
  LOCKED_MESSAGE,
  VAULT_PASSPHRASE_REQUIRED,
  VAULT_UNLOCK_FAILED,
  createMemoryVault,
  exportEncryptedEnvelope,
  exportPlaintextOptIn,
  gateVaultAction,
  importEncryptedEnvelope,
  unwrapVault,
  wrapVault,
} from '@/lib/credential-vault';
import { redactSecrets } from '@/lib/redact-secrets';

const CREDS = { julesKey: 'jules-live-secret-1', geminiKey: 'AIzaSy-test-gemini-secret', githubPat: 'ghp_testgithubsecret' };
const PASS = 'correct horse battery staple';

describe('credential vault AES-GCM round-trip', () => {
  it('wraps and unwraps credentials with the right passphrase', async () => {
    const envelope = await wrapVault(CREDS, PASS);
    expect(envelope.version).toBe(1);
    expect(envelope.saltB64.length).toBeGreaterThan(0);
    expect(envelope.ivB64.length).toBeGreaterThan(0);
    expect(envelope.ciphertextB64.length).toBeGreaterThan(0);
    const back = await unwrapVault(envelope, PASS);
    expect(back).toEqual(CREDS);
  });

  it('produces distinct envelopes per wrap of the same secrets', async () => {
    const a = await wrapVault(CREDS, PASS);
    const b = await wrapVault(CREDS, PASS);
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.saltB64).not.toBe(b.saltB64);
  });

  it('fails closed with a fixed sentence on wrong passphrase', async () => {
    const envelope = await wrapVault(CREDS, PASS);
    await expect(unwrapVault(envelope, 'wrong passphrase')).rejects.toThrow(VAULT_UNLOCK_FAILED);
    await expect(unwrapVault(envelope, 'wrong passphrase')).rejects.not.toThrow(CREDS.julesKey);
  });

  it.each([{ name: 'empty', value: '' }, { name: 'whitespace', value: '   ' }])(
    'rejects $name passphrase without touching crypto',
    async ({ value }) => {
      await expect(wrapVault(CREDS, value)).rejects.toThrow(VAULT_PASSPHRASE_REQUIRED);
      const envelope = await wrapVault(CREDS, PASS);
      await expect(unwrapVault(envelope, value)).rejects.toThrow(VAULT_PASSPHRASE_REQUIRED);
    }
  );

  it('stores only ciphertext — envelope never contains plaintext', async () => {
    const envelope = await wrapVault(CREDS, PASS);
    const serialized = exportEncryptedEnvelope(envelope);
    expect(serialized).not.toContain(CREDS.julesKey);
    expect(serialized).not.toContain(CREDS.geminiKey);
    expect(serialized).not.toContain(CREDS.githubPat);
  });

  it('round-trips through encrypted export/import without plaintext fields', async () => {
    const envelope = await wrapVault(CREDS, PASS);
    const json = exportEncryptedEnvelope(envelope);
    expect(json).toContain('repopilot-encrypted-vault');
    const back = importEncryptedEnvelope(json);
    expect(await unwrapVault(back, PASS)).toEqual(CREDS);
  });

  it('blocks plaintext material from the encrypted import path', () => {
    expect(() =>
      importEncryptedEnvelope(JSON.stringify({ ...CREDS, kind: 'repopilot-plaintext-keys' }))
    ).toThrow();
    expect(() => importEncryptedEnvelope('not json')).toThrow();
    expect(() => importEncryptedEnvelope(JSON.stringify({ version: 1 }))).toThrow();
  });

  it('redactSecrets strips fake key material from logged envelopes', async () => {
    const envelope = await wrapVault(
      { julesKey: 'AQAbcdefghijklmnop-qr-stuvwxyz1234', geminiKey: '', githubPat: '' },
      PASS
    );
    const logged = `vault write ${exportEncryptedEnvelope(envelope)} key=AQAbcdefghijklmnop-qr-stuvwxyz1234`;
    const redacted = redactSecrets(logged);
    expect(redacted).not.toContain('AQAbcdefghijklmnop-qr-stuvwxyz1234');
    expect(redacted).toContain('[REDACTED]');
  });

  it('memory vault zeroes credentials on lock', async () => {
    const vault = createMemoryVault();
    expect(vault.isLocked()).toBe(true);
    const envelope = await wrapVault(CREDS, PASS);
    await vault.unlock(envelope, PASS);
    expect(vault.isLocked()).toBe(false);
    expect(vault.getCredentials()).toEqual(CREDS);
    vault.lock();
    expect(vault.isLocked()).toBe(true);
    expect(vault.getCredentials()).toBeNull();
    expect(() => vault.requireCredentials()).toThrow(LOCKED_MESSAGE);
  });

  it('plaintext export is explicit and labeled', () => {
    const plain = exportPlaintextOptIn(CREDS);
    expect(plain).toContain('repopilot-plaintext-keys');
    expect(plain).toContain(CREDS.julesKey);
  });
});
