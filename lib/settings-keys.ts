export const JULES_KEY_STORAGE_KEY = 'repopilot_jules_key';
export const GEMINI_KEY_STORAGE_KEY = 'repopilot_gemini_key';
export const GITHUB_PAT_STORAGE_KEY = 'repopilot_github_pat';

export const LEGACY_CREDENTIAL_STORAGE_KEYS = [
  JULES_KEY_STORAGE_KEY,
  GEMINI_KEY_STORAGE_KEY,
  GITHUB_PAT_STORAGE_KEY,
];

export const VERIFIED_JULES_KEY = 'repopilot_verified_jules';
export const VERIFIED_GEMINI_KEY = 'repopilot_verified_gemini';
export const VERIFIED_GITHUB_KEY = 'repopilot_verified_github';

export const VERIFY_BEFORE_DISPATCH_MESSAGE = 'Verify a provider key before dispatching.';

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export function isRepopilotCredentialKey(key: string): boolean {
  return (
    key.startsWith('repopilot_') && (key.endsWith('_key') || key.endsWith('_pat'))
  );
}

export function listRepopilotCredentialKeys(storage: KeyStorage): string[] {
  const found: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && isRepopilotCredentialKey(key)) found.push(key);
  }
  return found;
}

export function clearRepopilotKeys(storage: KeyStorage): string[] {
  const removed = listRepopilotCredentialKeys(storage);
  for (const key of removed) storage.removeItem(key);
  return removed;
}

export function hasVerifiedKey(storage: KeyStorage | null | undefined): boolean {
  if (!storage) return false;
  return Boolean(
    storage.getItem(VERIFIED_JULES_KEY) ||
      storage.getItem(VERIFIED_GEMINI_KEY) ||
      storage.getItem(VERIFIED_GITHUB_KEY)
  );
}

export function markKeyVerified(storage: KeyStorage, which: 'jules' | 'gemini' | 'github'): void {
  const key =
    which === 'jules' ? VERIFIED_JULES_KEY : which === 'gemini' ? VERIFIED_GEMINI_KEY : VERIFIED_GITHUB_KEY;
  storage.setItem(key, new Date().toISOString());
}

export function clearVerifiedFlag(storage: KeyStorage, which: 'jules' | 'gemini' | 'github'): void {
  const key =
    which === 'jules' ? VERIFIED_JULES_KEY : which === 'gemini' ? VERIFIED_GEMINI_KEY : VERIFIED_GITHUB_KEY;
  storage.removeItem(key);
}

export function clearAllVerifiedFlags(storage: KeyStorage): string[] {
  const flags = [VERIFIED_JULES_KEY, VERIFIED_GEMINI_KEY, VERIFIED_GITHUB_KEY];
  const removed = flags.filter((key) => storage.getItem(key) !== null);
  for (const key of removed) storage.removeItem(key);
  return removed;
}
