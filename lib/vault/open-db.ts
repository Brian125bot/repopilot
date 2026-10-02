export const VAULT_IDB_DB = 'repopilot-credential-vault';
// COR-56 bumped this from 2 to 3 to provision the goals-v1 store. An IndexedDB
// upgrade handler only runs when the version number increases, so adding a
// store to the v2 handler would leave every operator already on v2 without it.
export const VAULT_IDB_VERSION = 3;

export const VAULT_STORE_NAME = 'vault';
export const STEERING_PROFILES_STORE = 'profiles-v1';
export const STEERING_SNIPPETS_STORE = 'snippets-v1';
export const GOALS_STORE_NAME = 'goals-v1';

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
      if (!db.objectStoreNames.contains(GOALS_STORE_NAME)) {
        db.createObjectStore(GOALS_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Credential vault storage is unavailable in this environment.'));
  });
}
