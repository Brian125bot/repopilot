'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Unlock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SnippetLibrary } from '@/components/SnippetLibrary';
import { VAULT_LOCKED_MESSAGE } from '@/lib/credential-vault';
import { getBuiltinSnippets } from '@/lib/snippets/builtin-loader';
import type { Snippet } from '@/lib/types/steering';
import { indexedDbSteeringStore, type SteeringStore } from '@/lib/vault/steering-store';

export default function SnippetLibrarySettingsPage() {
  const [passphrase, setPassphrase] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>(getBuiltinSnippets());

  const openStore = useCallback((): SteeringStore => {
    const store = indexedDbSteeringStore();
    store.unlock(passphrase);
    return store;
  }, [passphrase]);

  const loadSnippets = useCallback(async () => {
    const store = openStore();
    setSnippets(await store.listSnippets());
  }, [openStore]);

  // One store instance per unlocked passphrase so the library children keep a
  // stable store identity across re-renders.
  const unlockedStore = useMemo<SteeringStore | null>(() => {
    if (!isUnlocked) return null;
    return openStore();
  }, [isUnlocked, openStore]);

  useEffect(() => {
    if (isUnlocked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadSnippets();
    }
  }, [isUnlocked, loadSnippets]);

  const handleUnlock = async () => {
    if (!passphrase.trim()) return;
    try {
      const store = openStore();
      await store.listSnippets();
      setIsUnlocked(true);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to unlock vault. Incorrect passphrase?');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Snippet Library</h1>
        <p className="text-slate-500">
          Built-in steering snippets, your own copies, and encrypted import/export between browsers.
        </p>
      </div>

      {!isUnlocked ? (
        <div className="space-y-6">
          <div className="p-6 border rounded-lg bg-slate-50 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Unlock className="w-5 h-5 text-slate-700" />
              Unlock Vault
            </h2>
            <p className="text-sm text-slate-600">
              Enter your vault passphrase to manage your snippets. The built-in catalogue below is
              readable without unlocking; your own snippets are not.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Passphrase..."
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                className="max-w-md bg-white"
              />
              <Button onClick={handleUnlock}>Unlock</Button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <SnippetLibrary
            snippets={getBuiltinSnippets()}
            onChanged={() => undefined}
            readOnly
          />
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {unlockedStore && (
            <SnippetLibrary
              store={unlockedStore}
              snippets={snippets}
              onChanged={async () => {
                try {
                  await loadSnippets();
                  setError(null);
                } catch (err: unknown) {
                  setError(
                    err instanceof Error && err.message === VAULT_LOCKED_MESSAGE
                      ? 'The vault is locked again — unlock and retry.'
                      : err instanceof Error
                        ? err.message
                        : 'Could not read the snippet library.'
                  );
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
