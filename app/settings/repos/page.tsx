'use client';

import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RepoPicker } from '@/components/RepoPicker';
import { ScanProgress } from '@/components/ScanProgress';
import { scanRepository } from '@/lib/repo-profile/scan';
import { ScanResult, ScanStage } from '@/lib/repo-profile/types';
import {
  decideSave,
  isProfileEmpty,
  EMPTY_REPLACE_MESSAGE,
  SaveDecision,
} from '@/lib/repo-profile/save-policy';
import { describeScanOutcome, describeScanError } from '@/lib/repo-profile/describe';
import { RepoProfile } from '@/lib/types/steering';
import { indexedDbSteeringStore } from '@/lib/vault/steering-store';
import { indexedDbVaultStore, unwrapVault } from '@/lib/credential-vault';
import { AlertCircle, Trash2, Unlock, Save, Check } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function ReposSettingsPage() {
  const [passphrase, setPassphrase] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [githubPat, setGithubPat] = useState<string | null>(null);
  const [hasVaultPat, setHasVaultPat] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState<ScanStage | string>('metadata');
  const [scanMessage, setScanMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [saveDecision, setSaveDecision] = useState<SaveDecision | null>(null);
  const [operatorSaved, setOperatorSaved] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [savedProfiles, setSavedProfiles] = useState<RepoProfile[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const existingProfileRef = useRef<RepoProfile | null>(null);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to unlock vault. Incorrect passphrase?');
    }
  };

  const handleScan = async (target: { owner: string; repo: string }) => {
    if (!githubPat) {
      setError('GitHub PAT is required to scan repositories.');
      return;
    }
    setError(null);
    setStatusNotice(null);
    setScanning(true);
    setScanResult(null);
    setSaveDecision(null);
    setOperatorSaved(false);
    existingProfileRef.current = null;

    abortControllerRef.current = new AbortController();

    try {
      const result = await scanRepository(target, {
        githubPat,
        signal: abortControllerRef.current.signal,
        onProgress: (stage, msg) => {
          setScanStage(stage);
          setScanMessage(msg);
        },
      });

      setScanResult(result);

      // Look up existing saved profile (case-insensitive id match)
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      const existingProfiles = await store.listRepoProfiles();
      const existing = existingProfiles.find(
        (p) => p.id.toLowerCase() === result.profile.id.toLowerCase()
      ) || null;
      existingProfileRef.current = existing;

      const decision = decideSave(existing, result);
      setSaveDecision(decision);

      if (decision.action === 'save' && result.outcome === 'complete') {
        await store.saveRepoProfile(decision.profile);
        await loadProfiles();
        setStatusNotice('Scan completed and profile saved.');
      } else if (decision.action === 'save') {
        setStatusNotice('Incomplete scan. Review it below, then choose Save to keep it.');
      } else if (existing && !existing.incomplete && result.outcome !== 'complete') {
        const formattedDate = existing.updatedAt
          ? new Date(existing.updatedAt).toLocaleDateString()
          : 'earlier';
        setStatusNotice(`Kept your saved profile from ${formattedDate}`);
      } else if (result.outcome === 'cancelled' || result.outcome === 'timed_out') {
        setStatusNotice('Cancelled before any data was collected. Nothing saved.');
      } else {
        setStatusNotice('Nothing meaningful was collected. Nothing saved.');
      }
    } catch (err: unknown) {
      setError(describeScanError(err));
    } finally {
      setScanning(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleConfirmSave = async () => {
    if (!saveDecision || !isUnlocked) return;
    if (isProfileEmpty(saveDecision.profile)) {
      setError(EMPTY_REPLACE_MESSAGE);
      return;
    }
    const wasReplace = existingProfileRef.current !== null;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);

      await store.saveRepoProfile(saveDecision.profile);
      await loadProfiles();

      setSaveDecision((prev) => (prev ? { ...prev, action: 'save' } : null));
      setOperatorSaved(true);
      setStatusNotice(
        saveDecision.profile.incomplete
          ? wasReplace
            ? 'Replaced saved profile with this partial scan.'
            : 'Saved incomplete profile.'
          : 'Scan completed and profile saved.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!isUnlocked) return;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      await store.deleteRepoProfile(id);
      await loadProfiles();
    } catch (err: unknown) {
      console.error(err);
    }
  };

  const activeProfile = saveDecision?.profile || scanResult?.profile || null;
  const candidateProfile = saveDecision?.profile ?? null;
  const isCandidateEmpty = candidateProfile ? isProfileEmpty(candidateProfile) : false;
  const isAlreadySaved = saveDecision?.action === 'save';
  const isSaved = isAlreadySaved && (!candidateProfile?.incomplete || operatorSaved);
  const isPendingSave = isAlreadySaved && Boolean(candidateProfile?.incomplete) && !operatorSaved;
  const canReplace = !isAlreadySaved && !isCandidateEmpty;

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
              {activeProfile && scanResult && (
                <div className="p-4 border rounded-lg shadow-sm space-y-4 bg-white relative">
                  {scanResult.outcome !== 'complete' && (
                    <div className="absolute top-4 right-4 bg-amber-100 text-amber-800 text-xs font-bold px-2 py-1 rounded">
                      {scanResult.outcome === 'cancelled'
                        ? 'Incomplete Scan (Cancelled)'
                        : scanResult.outcome === 'timed_out'
                          ? 'Incomplete Scan (Timed out)'
                          : 'Partial Scan'}
                    </div>
                  )}

                  <h3 className="text-lg font-bold">
                    {activeProfile.repoRef.owner}/{activeProfile.repoRef.repo}
                  </h3>

                  <div className="text-xs text-slate-500 font-sans">
                    {describeScanOutcome(scanResult)}
                  </div>

                  {statusNotice && (
                    <div className="p-2 bg-indigo-50 text-indigo-800 text-xs rounded border border-indigo-200">
                      {statusNotice}
                    </div>
                  )}

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
                    {isSaved ? (
                      <Button disabled className="flex-1">
                        <Check className="w-4 h-4 mr-2" />
                        Saved
                      </Button>
                    ) : isPendingSave ? (
                      <Button onClick={handleConfirmSave} className="flex-1">
                        <Save className="w-4 h-4 mr-2" />
                        Save partial profile
                      </Button>
                    ) : canReplace ? (
                      <Button onClick={handleConfirmSave} className="flex-1">
                        <Save className="w-4 h-4 mr-2" />
                        Replace saved profile with this partial
                      </Button>
                    ) : (
                      <Button disabled className="flex-1">
                        <Save className="w-4 h-4 mr-2" />
                        Nothing to save from this scan
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      onClick={() => {
                        setScanResult(null);
                        setSaveDecision(null);
                        setOperatorSaved(false);
                        setStatusNotice(null);
                        existingProfileRef.current = null;
                      }}
                    >
                      {isSaved ? 'Close' : 'Discard'}
                    </Button>
                  </div>

                  {isCandidateEmpty && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                      This scan was cancelled or timed out before any data was collected. Your saved
                      profile has not been changed.
                    </p>
                  )}
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
