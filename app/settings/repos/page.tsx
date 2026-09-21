'use client';

import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RepoPicker } from '@/components/RepoPicker';
import { ScanProgress } from '@/components/ScanProgress';
import { scanRepository } from '@/lib/repo-profile/scan';
import { RepoProfile } from '@/lib/types/steering';
import { indexedDbSteeringStore } from '@/lib/vault/steering-store';
import { indexedDbVaultStore, unwrapVault } from '@/lib/credential-vault';
import { AlertCircle, Trash2, Unlock, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function ReposSettingsPage() {
  const [passphrase, setPassphrase] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [githubPat, setGithubPat] = useState<string | null>(null);
  const [hasVaultPat, setHasVaultPat] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<(RepoProfile & { incomplete?: boolean }) | null>(null);
  const [cancelReason, setCancelReason] = useState<'cancelled' | 'timed_out' | null>(null);

  const [savedProfiles, setSavedProfiles] = useState<RepoProfile[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const wasCancelledRef = useRef<boolean>(false);

  const loadProfiles = useCallback(async () => {
    if (!isUnlocked) return;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      const profiles = await store.listRepoProfiles();
      setSavedProfiles(profiles);
    } catch (err) {
      console.error('Failed to load profiles', err);
    }
  }, [isUnlocked, passphrase]);

  useEffect(() => {
    if (isUnlocked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadProfiles();
    }
  }, [isUnlocked, loadProfiles]);

  const handleUnlock = async () => {
    if (!passphrase.trim()) return;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      await store.listRepoProfiles();

      // Try loading GitHub PAT from existing credential vault
      const vaultStore = indexedDbVaultStore();
      const envelope = await vaultStore.read();
      if (envelope) {
        try {
          const creds = await unwrapVault(envelope, passphrase);
          if (creds.githubPat && creds.githubPat.trim()) {
            setGithubPat(creds.githubPat.trim());
            setHasVaultPat(true);
          }
        } catch {
          // Vault passphrase mismatch or corrupt vault - keep fallback input
        }
      }

      setIsUnlocked(true);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to unlock vault. Incorrect passphrase?');
    }
  };

  const handleScan = async (target: { owner: string; repo: string }) => {
    if (!githubPat) {
      setError('GitHub PAT is required to scan repositories.');
      return;
    }
    setError(null);
    setScanning(true);
    setActiveProfile(null);
    setCancelReason(null);
    wasCancelledRef.current = false;

    abortControllerRef.current = new AbortController();

    try {
      const profile = await scanRepository(target, {
        githubPat,
        signal: abortControllerRef.current.signal,
        onProgress: (stage, msg) => {
          setScanStage(stage);
          setScanMessage(msg);
        },
      });

      if (profile.incomplete) {
        setCancelReason(wasCancelledRef.current ? 'cancelled' : 'timed_out');
        try {
          const store = indexedDbSteeringStore();
          store.unlock(passphrase);
          await store.saveRepoProfile(profile);
          await loadProfiles();
        } catch (saveErr: any) {
          setError(saveErr.message || 'Failed to auto-save incomplete profile.');
        }
      }

      setActiveProfile(profile);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during the scan.');
    } finally {
      setScanning(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    wasCancelledRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSaveProfile = async () => {
    if (!activeProfile || !isUnlocked) return;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);

      await store.saveRepoProfile(activeProfile as RepoProfile);

      setActiveProfile(null);
      await loadProfiles();
    } catch (err: any) {
      setError(err.message || 'Failed to save profile');
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!isUnlocked) return;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      await store.deleteRepoProfile(id);
      await loadProfiles();
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Repository Profiles</h1>
        <p className="text-slate-500">Scan and manage GitHub repository conventions and metadata.</p>
      </div>

      {!isUnlocked ? (
        <div className="p-6 border rounded-lg bg-slate-50 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Unlock className="w-5 h-5 text-slate-700" />
            Unlock Vault
          </h2>
          <p className="text-sm text-slate-600">Enter your vault passphrase to access profiles and initiate scans.</p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Passphrase..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="max-w-md"
            />
            <Button onClick={handleUnlock}>Unlock</Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-8">
          {!hasVaultPat && (
            <div className="p-4 border rounded-lg bg-amber-50 border-amber-200">
              <h3 className="font-semibold text-amber-900 mb-1">Fallback GitHub PAT</h3>
              <p className="text-xs text-amber-800 mb-3">
                No GitHub token was found in your credential vault. Enter a fallback PAT for scan operations.
              </p>
              <Input
                type="password"
                placeholder="ghp_..."
                value={githubPat || ''}
                onChange={(e) => setGithubPat(e.target.value)}
                className="max-w-md bg-white"
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h2 className="text-xl font-semibold border-b pb-2">Scan New Repository</h2>
              <RepoPicker
                githubPat={githubPat || ''}
                onSelect={handleScan}
                disabled={scanning || !githubPat}
              />

              {scanning && (
                <ScanProgress
                  stage={scanStage}
                  message={scanMessage}
                  onCancel={handleCancel}
                />
              )}
            </div>

            <div>
              {activeProfile && (
                <div className="p-4 border rounded-lg shadow-sm space-y-4 bg-white relative">
                  {activeProfile.incomplete && (
                    <div className="absolute top-4 right-4 bg-amber-100 text-amber-800 text-xs font-bold px-2 py-1 rounded">
                      {cancelReason === 'cancelled' ? 'Incomplete Scan (Cancelled)' : 'Incomplete Scan (Timed out)'}
                    </div>
                  )}

                  <h3 className="text-lg font-bold">
                    {activeProfile.repoRef.owner}/{activeProfile.repoRef.repo}
                  </h3>

                  <div className="text-sm space-y-1 text-slate-600">
                    <p>
                      <strong>Branch:</strong> {activeProfile.repoRef.defaultBranch || '-'}
                    </p>
                    <p>
                      <strong>Languages:</strong> {activeProfile.stack.languages.join(', ') || 'None detected'}
                    </p>
                    {activeProfile.stack.packageManager && (
                      <p>
                        <strong>Package Manager:</strong> {activeProfile.stack.packageManager}
                      </p>
                    )}
                    {activeProfile.stack.framework && (
                      <p>
                        <strong>Framework:</strong> {activeProfile.stack.framework}
                      </p>
                    )}
                    {activeProfile.stack.testRunner && (
                      <p>
                        <strong>Test Runner:</strong> {activeProfile.stack.testRunner}
                      </p>
                    )}
                  </div>

                  {activeProfile.conventions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm">Detected Conventions</h4>
                      <ul className="text-sm space-y-2">
                        {activeProfile.conventions.map((c) => (
                          <li key={c.id} className="bg-slate-50 p-2 rounded border">
                            <strong>{c.title}</strong>
                            <pre className="text-xs whitespace-pre-wrap mt-1 text-slate-600 font-sans">
                              {c.body}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-2 pt-4">
                    <Button onClick={handleSaveProfile} className="flex-1">
                      <Save className="w-4 h-4 mr-2" />
                      Save Profile
                    </Button>
                    <Button variant="outline" onClick={() => setActiveProfile(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold border-b pb-2">Saved Profiles</h2>
            {savedProfiles.length === 0 ? (
              <p className="text-sm text-slate-500">No profiles saved yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {savedProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="p-4 border rounded bg-white flex justify-between items-start"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold">
                          {profile.repoRef.owner}/{profile.repoRef.repo}
                        </h4>
                        {profile.incomplete && (
                          <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            Incomplete
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {profile.conventions.length} conventions detected
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteProfile(profile.id)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
