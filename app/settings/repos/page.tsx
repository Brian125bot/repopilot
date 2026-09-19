'use client';

import * as React from 'react';
import { RepoPicker } from '@/components/RepoPicker';
import { ScanProgress } from '@/components/ScanProgress';
import { scanRepository, ScanProgressInfo, ScanResult } from '@/lib/repo-profile/scan';
import { useCredentialVault } from '@/hooks/use-credential-vault';
import { createSteeringStore, indexedDbSteeringRecordStore } from '@/lib/vault/steering-store';
import { RepoProfile } from '@/lib/types/steering';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lock, Unlock, Database, RefreshCw, Trash2, Code2, Terminal, CheckCircle2 } from 'lucide-react';

export default function ReposSettingsPage() {
  const vault = useCredentialVault();
  const [passphraseInput, setPassphraseInput] = React.useState('');
  const [unlockedStore, setUnlockedStore] = React.useState<ReturnType<typeof createSteeringStore> | null>(null);

  const [selectedRepo, setSelectedRepo] = React.useState('');
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState<ScanProgressInfo | null>(null);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [abortController, setAbortController] = React.useState<AbortController | null>(null);

  const [savedProfiles, setSavedProfiles] = React.useState<RepoProfile[]>([]);
  const [storeError, setStoreError] = React.useState<string | null>(null);

  const handleUnlockStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphraseInput.trim()) return;
    setStoreError(null);
    try {
      const store = createSteeringStore(indexedDbSteeringRecordStore());
      store.unlock(passphraseInput);
      const profiles = await store.listRepoProfiles();
      setUnlockedStore(store);
      setSavedProfiles(profiles);
    } catch (err: any) {
      setStoreError(err.message || 'Failed to unlock encrypted browser vault with passphrase.');
    }
  };

  const refreshProfiles = React.useCallback(async () => {
    if (!unlockedStore) return;
    try {
      const list = await unlockedStore.listRepoProfiles();
      setSavedProfiles(list);
    } catch (err: any) {
      setStoreError(err.message || 'Failed to load profiles.');
    }
  }, [unlockedStore]);

  const handleStartScan = async (repoFullName: string) => {
    setSelectedRepo(repoFullName);
    const [owner, repo] = repoFullName.trim().split('/');
    if (!owner || !repo) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsScanning(true);
    setScanResult(null);
    setScanProgress({ step: 'repo', message: 'Starting scan...', completedSteps: 0, totalSteps: 4 });

    try {
      const pat = vault.credentials?.githubPat || '';
      const result = await scanRepository({
        owner,
        repo,
        pat,
        signal: controller.signal,
        onProgress: (p) => setScanProgress(p),
      });

      setScanResult(result);

      // Auto-save to store if unlocked
      if (unlockedStore && result.profile) {
        await unlockedStore.saveRepoProfile(result.profile);
        await refreshProfiles();
      }
    } catch (err: any) {
      // Scan aborted or error
    } finally {
      setIsScanning(false);
      setAbortController(null);
    }
  };

  const handleCancelScan = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!unlockedStore) return;
    try {
      await unlockedStore.deleteRepoProfile(id);
      await refreshProfiles();
    } catch (err: any) {
      setStoreError(err.message || 'Failed to delete profile.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Repository Profiles & Scanning</h1>
          <p className="text-xs text-slate-500 mt-1">
            Scan connected GitHub repositories to produce structured RepoProfiles with stack detection and coding conventions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unlockedStore ? (
            <Badge variant="indigo" className="flex items-center gap-1.5 py-1 text-xs">
              <Unlock className="h-3.5 w-3.5 text-emerald-500" />
              Vault Unlocked
            </Badge>
          ) : (
            <Badge variant="outline" className="flex items-center gap-1.5 py-1 text-xs text-amber-700 bg-amber-50 border-amber-200">
              <Lock className="h-3.5 w-3.5" />
              Vault Locked
            </Badge>
          )}
        </div>
      </div>

      {!unlockedStore && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-amber-900 flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-600" />
              Unlock Browser Credential Vault
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-amber-800">
              Enter your credential vault passphrase to view and auto-save encrypted repo profiles locally.
            </p>
            <form onSubmit={handleUnlockStore} className="flex gap-2 max-w-md">
              <Input
                type="password"
                placeholder="Vault Passphrase"
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                className="text-xs bg-white"
              />
              <Button type="submit" size="sm" className="text-xs bg-amber-700 hover:bg-amber-800 text-white shrink-0">
                Unlock
              </Button>
            </form>
            {storeError && (
              <p className="text-xs text-red-600 font-medium">{storeError}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <RepoPicker
            onSelectRepo={(repo) => handleStartScan(repo)}
            selectedRepo={selectedRepo}
            githubPat={vault.credentials?.githubPat || ''}
            disabled={isScanning}
          />

          <ScanProgress
            progress={scanProgress}
            isScanning={isScanning}
            incomplete={scanResult?.incomplete}
            errors={scanResult?.errors}
            onCancel={handleCancelScan}
          />
        </div>

        <div>
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-indigo-600" />
                Saved Repository Profiles ({savedProfiles.length})
              </CardTitle>
              {unlockedStore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshProfiles}
                  className="h-7 text-xs border-slate-200"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {!unlockedStore ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  Unlock vault to display saved repository profiles.
                </div>
              ) : savedProfiles.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  No repo profiles saved in browser vault yet. Run a scan above to generate one.
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {savedProfiles.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 space-y-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{p.id}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] bg-white">
                            {p.repoRef.defaultBranch || 'main'}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteProfile(p.id)}
                            className="h-6 w-6 p-0 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-100">
                        <div className="flex items-center gap-1">
                          <Code2 className="h-3 w-3 text-indigo-500 shrink-0" />
                          <span>Framework: <strong>{p.stack.framework || 'Unknown'}</strong></span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Terminal className="h-3 w-3 text-indigo-500 shrink-0" />
                          <span>PM: <strong>{p.stack.packageManager || 'npm'}</strong></span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-indigo-500 shrink-0" />
                          <span>Test: <strong>{p.stack.testRunner || 'None'}</strong></span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span>Langs: <strong>{p.stack.languages.join(', ') || 'JS/TS'}</strong></span>
                        </div>
                      </div>

                      {p.conventions.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            Conventions ({p.conventions.length})
                          </span>
                          <div className="space-y-1">
                            {p.conventions.map((c) => (
                              <div key={c.id} className="text-[11px] bg-white p-1.5 rounded border border-slate-100">
                                <span className="font-medium text-slate-800">{c.title}:</span>{' '}
                                <span className="text-slate-600">{c.body}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {p.notes && (
                        <Alert className="py-1.5 px-2 text-[10px] bg-amber-50 border-amber-200 text-amber-800">
                          <AlertDescription>{p.notes}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
