export const VAULT_IDB_DB = 'repopilot-credential-vault';
export const VAULT_IDB_VERSION = 2;

export const VAULT_STORE_NAME = 'vault';
export const STEERING_PROFILES_STORE = 'profiles-v1';
export const STEERING_SNIPPETS_STORE = 'snippets-v1';

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('Credential vault storage is unavailable in this environment.'));
      return;
    }
    const request = indexedDB.open(VAULT_IDB_DB, VAULT_IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
        db.createObjectStore(VAULT_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(STEERING_PROFILES_STORE)) {
        db.createObjectStore(STEERING_PROFILES_STORE);
      }
      if (!db.objectStoreNames.contains(STEERING_SNIPPETS_STORE)) {
        db.createObjectStore(STEERING_SNIPPETS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Credential vault storage is unavailable in this environment.'));
  });
}
