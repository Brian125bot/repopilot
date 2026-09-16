'use client';

import * as React from 'react';
import { Key, Github, Sparkles, CheckCircle2, ShieldCheck, Bot, ExternalLink } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import {
  GEMINI_KEY_STORAGE_KEY,
  GITHUB_PAT_STORAGE_KEY,
  JULES_KEY_STORAGE_KEY,
  VERIFY_BEFORE_DISPATCH_MESSAGE,
  clearAllVerifiedFlags,
  clearRepopilotKeys,
  clearVerifiedFlag,
  hasVerifiedKey,
  markKeyVerified,
  type KeyStorage,
} from '@/lib/settings-keys';
import {
  LOCKED_MESSAGE,
  PLAINTEXT_EXPORT_WARNING,
  exportPlaintextOptIn,
  hasLegacyPlaintext,
  importPlaintextOptIn,
} from '@/lib/credential-vault';
import type { CredentialVaultApi } from '@/hooks/use-credential-vault';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  julesKey: string;
  setJulesKey: (key: string) => void;
  geminiKey: string;
  setGeminiKey: (key: string) => void;
  githubPat: string;
  setGithubPat: (pat: string) => void;
  vault: CredentialVaultApi;
}

export interface GithubVerifyResult {
  ok: boolean;
  login: string;
  name: string;
  scopes: string[];
  tokenType: 'classic' | 'fine-grained' | 'unknown';
  warnings: string[];
}

export interface GeminiVerifyResult {
  ok: boolean;
  sampleModels: string[];
  emptyModelsNotice?: string;
}

export interface JulesVerifyResult {
  ok: boolean;
  sources: Array<{ name: string; id: string }>;
  targetRepoConnected?: boolean;
  notConnectedNotice?: string;
}

export function SettingsModal({
  open,
  onOpenChange,
  julesKey,
  setJulesKey,
  geminiKey,
  setGeminiKey,
  githubPat,
  setGithubPat,
  vault,
}: SettingsModalProps) {
  const [localJules, setLocalJules] = React.useState(julesKey);
  const [localGemini, setLocalGemini] = React.useState(geminiKey);
  const [localPat, setLocalPat] = React.useState(githubPat);
  const [savedSuccess, setSavedSuccess] = React.useState(false);
  const [hasServerGemini, setHasServerGemini] = React.useState<boolean | null>(null);
  const [hasServerJules, setHasServerJules] = React.useState<boolean | null>(null);
  const [testingJules, setTestingJules] = React.useState(false);
  const [julesTestResult, setJulesTestResult] = React.useState<{ valid?: boolean; message?: string } | null>(null);
  const [testingPat, setTestingPat] = React.useState(false);
  const [patTestResult, setPatTestResult] = React.useState<{ valid?: boolean; message?: string } | null>(null);
  const [testingGemini, setTestingGemini] = React.useState(false);
  const [geminiTestResult, setGeminiTestResult] = React.useState<{ valid?: boolean; message?: string } | null>(null);
  const [githubVerify, setGithubVerify] = React.useState<GithubVerifyResult | null>(null);
  const [geminiVerify, setGeminiVerify] = React.useState<GeminiVerifyResult | null>(null);
  const [julesVerify, setJulesVerify] = React.useState<JulesVerifyResult | null>(null);
  const [julesVerifyRepo, setJulesVerifyRepo] = React.useState('');
  const [clearAllNotice, setClearAllNotice] = React.useState<string | null>(null);
  const [verifyGateNotice, setVerifyGateNotice] = React.useState<string | null>(null);
  const [passphrase, setPassphrase] = React.useState('');
  const [vaultNotice, setVaultNotice] = React.useState<string | null>(null);
  const [legacyNotice, setLegacyNotice] = React.useState<string | null>(null);
  const [importText, setImportText] = React.useState('');
  const [allowPlainExport, setAllowPlainExport] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        setLocalJules(julesKey);
        setLocalGemini(geminiKey);
        setLocalPat(githubPat);
        setJulesTestResult(null);
        setPatTestResult(null);
        setGeminiTestResult(null);
        setGithubVerify(null);
        setGeminiVerify(null);
        setJulesVerify(null);
        setClearAllNotice(null);
        setVaultNotice(null);
        setVerifyGateNotice(
          typeof window !== 'undefined' && !hasVerifiedKey(window.localStorage as unknown as KeyStorage)
            ? VERIFY_BEFORE_DISPATCH_MESSAGE
            : null
        );
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [julesKey, geminiKey, githubPat, open]);

  React.useEffect(() => {
    if (open && typeof window !== 'undefined') {
      const timer = setTimeout(() => {
        try {
          setLegacyNotice(
            hasLegacyPlaintext(window.localStorage as unknown as KeyStorage)
              ? 'Plaintext provider keys were found in this browser. Set a passphrase to migrate them into the encrypted vault.'
              : null
          );
        } catch {
          setLegacyNotice(null);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Check if server environment variables are available
  React.useEffect(() => {
    // Check server Gemini API key via presence probe (no Gemini call spent)
    fetch('/api/audit/evaluate', { method: 'GET' })
      .then((res) => res.json())
      .then((data) => {
        setHasServerGemini(data.hasServerKey === true);
      })
      .catch(() => setHasServerGemini(null));

    // Check server Jules API key
    fetch('/api/jules/sources')
      .then((res) => res.json())
      .then((data) => {
        setHasServerJules(data.hasServerKey === true);
      })
      .catch(() => setHasServerJules(null));
  }, []);

  const handleTestJulesKey = async () => {
    setTestingJules(true);
    setJulesTestResult(null);
    setJulesVerify(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (localJules.trim()) {
        headers['x-jules-api-key'] = localJules.trim();
      }
      const res = await fetch('/api/settings/verify-jules', {
        method: 'POST',
        headers,
        body: JSON.stringify(julesVerifyRepo.trim() ? { repo: julesVerifyRepo.trim() } : {}),
      });
      const data = await res.json();
      if (res.ok && data.success !== false && data.ok) {
        const result: JulesVerifyResult = {
          ok: true,
          sources: Array.isArray(data.sources) ? data.sources : [],
          targetRepoConnected: data.targetRepoConnected,
          notConnectedNotice: data.notConnectedNotice,
        };
        setJulesVerify(result);
        if (typeof window !== 'undefined') {
          markKeyVerified(window.localStorage as unknown as KeyStorage, 'jules');
        }
        setJulesTestResult({
          valid: true,
          message:
            result.targetRepoConnected === false && result.notConnectedNotice
              ? result.notConnectedNotice
              : `Connected successfully! (${result.sources.length} repository sources connected)`,
        });
      } else {
        setJulesTestResult({
          valid: false,
          message: data.error || data.message || 'Key rejected by Google Jules API.',
        });
      }
    } catch (e) {
      setJulesTestResult({
        valid: false,
        message: e instanceof Error ? e.message : 'Network test error',
      });
    } finally {
      setTestingJules(false);
    }
  };

  const handleTestGeminiKey = async () => {
    setTestingGemini(true);
    setGeminiTestResult(null);
    setGeminiVerify(null);
    try {
      const headers: Record<string, string> = {};
      if (localGemini.trim()) {
        headers['x-gemini-api-key'] = localGemini.trim();
      }
      const res = await fetch('/api/settings/verify-gemini', { method: 'POST', headers });
      const data = await res.json();
      if (res.ok && data.success !== false && data.ok) {
        const result: GeminiVerifyResult = {
          ok: true,
          sampleModels: Array.isArray(data.sampleModels) ? data.sampleModels : [],
          emptyModelsNotice: data.emptyModelsNotice,
        };
        setGeminiVerify(result);
        if (typeof window !== 'undefined') {
          markKeyVerified(window.localStorage as unknown as KeyStorage, 'gemini');
        }
        const first = result.sampleModels[0];
        setGeminiTestResult({
          valid: true,
          message: first
            ? `Connected successfully! (e.g. ${first})`
            : result.emptyModelsNotice ||
              'Key accepted but no models returned — confirm the Generative Language API is enabled.',
        });
      } else {
        setGeminiTestResult({
          valid: false,
          message: data.error || data.message || 'Key rejected by Gemini API.',
        });
      }
    } catch (e) {
      setGeminiTestResult({
        valid: false,
        message: e instanceof Error ? e.message : 'Network test error',
      });
    } finally {
      setTestingGemini(false);
    }
  };

  const handleTestPat = async () => {
    setTestingPat(true);
    setPatTestResult(null);
    setGithubVerify(null);
    try {
      const headers: Record<string, string> = {};
      if (localPat.trim()) {
        headers['x-github-pat'] = localPat.trim();
      }
      const res = await fetch('/api/settings/verify-github', { method: 'POST', headers });
      const data = await res.json();
      if (res.ok && data.success !== false && data.ok) {
        const result: GithubVerifyResult = {
          ok: true,
          login: data.login || '',
          name: data.name || '',
          scopes: Array.isArray(data.scopes) ? data.scopes : [],
          tokenType: data.tokenType || 'unknown',
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        };
        setGithubVerify(result);
        if (typeof window !== 'undefined') {
          markKeyVerified(window.localStorage as unknown as KeyStorage, 'github');
        }
        setPatTestResult({
          valid: true,
          message: `Connected as @${result.login || 'user'}!`,
        });
      } else {
        setPatTestResult({
          valid: false,
          message: data.error || data.message || 'GitHub token rejected (401 Bad credentials)',
        });
      }
    } catch (e) {
      setPatTestResult({
        valid: false,
        message: e instanceof Error ? e.message : 'Network test error',
      });
    } finally {
      setTestingPat(false);
    }
  };

  const handleSave = async () => {
    if (!passphrase.trim() && typeof window !== 'undefined') {
      try {
        if (hasLegacyPlaintext(window.localStorage as unknown as KeyStorage) || !vault.vaultExists) {
          setVaultNotice('Set a passphrase to encrypt credentials before saving.');
          return;
        }
      } catch {
        // Fall through to vault save attempt.
      }
    }
    const ok = await vault.saveCredentials(
      { julesKey: localJules.trim(), geminiKey: localGemini.trim(), githubPat: localPat.trim() },
      passphrase
    );
    if (!ok) {
      setVaultNotice(vault.lastError || LOCKED_MESSAGE);
      return;
    }
    setJulesKey(localJules.trim());
    setGeminiKey(localGemini.trim());
    setGithubPat(localPat.trim());
    if (typeof window !== 'undefined') {
      localStorage.removeItem(JULES_KEY_STORAGE_KEY);
      localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
      localStorage.removeItem(GITHUB_PAT_STORAGE_KEY);
    }
    setPassphrase('');
    setVaultNotice(null);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onOpenChange(false);
    }, 600);
  };

  const handleUnlock = async () => {
    setVaultNotice(null);
    const ok = await vault.unlock(passphrase);
    if (!ok) {
      setVaultNotice(vault.lastError || LOCKED_MESSAGE);
      return;
    }
    const creds = vault.credentials;
    if (creds) {
      setLocalJules(creds.julesKey);
      setLocalGemini(creds.geminiKey);
      setLocalPat(creds.githubPat);
      setJulesKey(creds.julesKey);
      setGeminiKey(creds.geminiKey);
      setGithubPat(creds.githubPat);
    }
    setPassphrase('');
    setVaultNotice('Vault unlocked — keys live in memory only.');
  };

  const handleMigrateLegacy = async () => {
    setVaultNotice(null);
    try {
      const result = await vault.setupAndMigrate(passphrase);
      const creds = vault.credentials;
      if (creds) {
        setLocalJules(creds.julesKey);
        setLocalGemini(creds.geminiKey);
        setLocalPat(creds.githubPat);
        setJulesKey(creds.julesKey);
        setGeminiKey(creds.geminiKey);
        setGithubPat(creds.githubPat);
      }
      setPassphrase('');
      setLegacyNotice(null);
      setVaultNotice(
        result.migrated.length > 0
          ? `Migrated ${result.migrated.length} key${result.migrated.length === 1 ? '' : 's'} and wiped plaintext localStorage.`
          : 'No plaintext keys found — vault is ready.'
      );
    } catch (err) {
      setVaultNotice(err instanceof Error ? err.message : 'Migration failed — vault remains locked.');
    }
  };

  const handleExportEncrypted = async () => {
    const json = await vault.exportVault();
    if (!json) {
      setVaultNotice('No encrypted vault to export yet.');
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'repopilot-vault-encrypted.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setVaultNotice('Exported encrypted vault file.');
  };

  const handleExportPlaintext = () => {
    if (!allowPlainExport) return;
    const blob = new Blob(
      [exportPlaintextOptIn({ julesKey: localJules.trim(), geminiKey: localGemini.trim(), githubPat: localPat.trim() })],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'repopilot-keys-plaintext.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setAllowPlainExport(false);
    setVaultNotice('Exported plaintext keys — rotate them if this file leaves your machine.');
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const looksPlain = (() => {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return typeof parsed.julesKey === 'string';
      } catch {
        return false;
      }
    })();
    if (looksPlain) {
      try {
        const creds = importPlaintextOptIn(text);
        setLocalJules(creds.julesKey);
        setLocalGemini(creds.geminiKey);
        setLocalPat(creds.githubPat);
        setVaultNotice('Plaintext file loaded into the form — set a passphrase and save to encrypt.');
      } catch {
        setVaultNotice('Import file is not an encrypted vault — plaintext imports are blocked.');
      }
      return;
    }
    setImportText(text);
    const ok = await vault.importVaultFile(text, passphrase);
    if (!ok) {
      setVaultNotice(vault.lastError || LOCKED_MESSAGE);
      return;
    }
    const creds = vault.credentials;
    if (creds) {
      setLocalJules(creds.julesKey);
      setLocalGemini(creds.geminiKey);
      setLocalPat(creds.githubPat);
      setJulesKey(creds.julesKey);
      setGeminiKey(creds.geminiKey);
      setGithubPat(creds.githubPat);
    }
    setVaultNotice('Imported encrypted vault and unlocked.');
  };

  const handleClearProvider = (which: 'jules' | 'gemini' | 'github') => {
    if (typeof window !== 'undefined') {
      clearVerifiedFlag(window.localStorage as unknown as KeyStorage, which);
    }
    if (which === 'jules') {
      setLocalJules('');
      setJulesKey('');
      setJulesTestResult(null);
      setJulesVerify(null);
      if (typeof window !== 'undefined') localStorage.removeItem(JULES_KEY_STORAGE_KEY);
    } else if (which === 'gemini') {
      setLocalGemini('');
      setGeminiKey('');
      setGeminiTestResult(null);
      setGeminiVerify(null);
      if (typeof window !== 'undefined') localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    } else {
      setLocalPat('');
      setGithubPat('');
      setPatTestResult(null);
      setGithubVerify(null);
      if (typeof window !== 'undefined') localStorage.removeItem(GITHUB_PAT_STORAGE_KEY);
    }
  };

  const handleClearAllKeys = async () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Clear all saved provider keys in this browser?')) return;
    const removed = clearRepopilotKeys(window.localStorage as unknown as KeyStorage);
    clearAllVerifiedFlags(window.localStorage as unknown as KeyStorage);
    await vault.clearVault();
    setLocalJules('');
    setLocalGemini('');
    setLocalPat('');
    setJulesKey('');
    setGeminiKey('');
    setGithubPat('');
    setJulesTestResult(null);
    setPatTestResult(null);
    setGeminiTestResult(null);
    setGithubVerify(null);
    setGeminiVerify(null);
    setJulesVerify(null);
    setClearAllNotice(
      removed.length > 0 ? `Cleared ${removed.length} saved key${removed.length === 1 ? '' : 's'}.` : 'No saved keys found.'
    );
  };

  const handleClear = async () => {
    setLocalJules('');
    setLocalGemini('');
    setLocalPat('');
    setJulesKey('');
    setGeminiKey('');
    setGithubPat('');
    setJulesTestResult(null);
    setPatTestResult(null);
    setGeminiTestResult(null);
    setGithubVerify(null);
    setGeminiVerify(null);
    setJulesVerify(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(JULES_KEY_STORAGE_KEY);
      localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
      localStorage.removeItem(GITHUB_PAT_STORAGE_KEY);
      clearAllVerifiedFlags(window.localStorage as unknown as KeyStorage);
    }
    await vault.clearVault();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader onClose={() => onOpenChange(false)}>
        <DialogTitle className="flex items-center gap-2">
          <Key className="h-5 w-5 text-indigo-600" />
          API Credentials & Service Tokens
        </DialogTitle>
        <DialogDescription>
          Configure dedicated keys for Google Jules asynchronous dispatch, Gemini audit evaluation, and GitHub access.
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <div className="space-y-5">
          <div className="space-y-2 p-3.5 rounded-xl bg-slate-900 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Encrypted credential vault</span>
              <Badge
                variant="outline"
                className={`text-[11px] ${
                  vault.status === 'unlocked'
                    ? 'text-emerald-300 border-emerald-400'
                    : vault.status === 'locked'
                      ? 'text-amber-300 border-amber-400'
                      : 'text-slate-300 border-slate-500'
                }`}
              >
                {vault.status === 'unlocked' ? 'Unlocked' : vault.status === 'locked' ? 'Locked' : 'No vault'}
              </Badge>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Keys are wrapped with AES-GCM from your passphrase and stored in IndexedDB. Unlocking restores them in memory only.
            </p>
            {legacyNotice && (
              <p className="text-[11px] font-medium text-amber-300">{legacyNotice}</p>
            )}
            <Input
              type="password"
              placeholder="Vault passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="font-mono text-xs bg-white text-slate-900"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleUnlock} className="text-xs bg-white/10 border-white/30 text-white hover:bg-white/20">
                Unlock
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleMigrateLegacy} className="text-xs bg-white/10 border-white/30 text-white hover:bg-white/20">
                Encrypt & wipe plaintext
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => vault.lock()} className="text-xs bg-white/10 border-white/30 text-white hover:bg-white/20">
                Lock
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleExportEncrypted} className="text-xs bg-white/10 border-white/30 text-white hover:bg-white/20">
                Export encrypted
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs bg-white/10 border-white/30 text-white hover:bg-white/20"
              >
                Import file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  void handleImportFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            {importText ? (
              <p className="text-[11px] text-slate-400">Import file staged — enter the passphrase and press Import file again to unlock.</p>
            ) : null}
            <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allowPlainExport}
                onChange={(e) => setAllowPlainExport(e.target.checked)}
                className="mt-0.5 rounded border-slate-500"
              />
              <span>
                Opt in to plaintext JSON export. {PLAINTEXT_EXPORT_WARNING}
              </span>
            </label>
            {allowPlainExport && (
              <Button type="button" variant="outline" size="sm" onClick={handleExportPlaintext} className="text-xs bg-amber-500/20 border-amber-400 text-amber-100 hover:bg-amber-500/30">
                Export plaintext (not recommended)
              </Button>
            )}
            {(vaultNotice || vault.lastError) && (
              <p className="text-[11px] font-medium text-slate-200">{vaultNotice || vault.lastError}</p>
            )}
          </div>
          {verifyGateNotice && (
            <Alert variant="info" className="bg-indigo-50 border-indigo-200">
              <AlertDescription className="text-xs text-indigo-900">{verifyGateNotice}</AlertDescription>
            </Alert>
          )}
          {/* 1. Google Jules API Key */}
          <div className="space-y-2 p-3.5 rounded-xl bg-indigo-50/40 border border-indigo-100/80">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Bot className="h-4 w-4 text-indigo-600" />
                Google Jules API Key (Agent Dispatch)
              </label>
              <div className="flex items-center gap-1.5">
                {hasServerJules ? (
                  <Badge variant="success" className="gap-1 text-[11px]">
                    <CheckCircle2 className="h-3 w-3" />
                    Server JULES_API_KEY
                  </Badge>
                ) : localJules ? (
                  <Badge variant="indigo" className="text-[11px]">
                    User Key Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] text-amber-700 border-amber-300 bg-amber-50">
                    Required for Live Dispatch
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={hasServerJules ? 'Inheriting server JULES_API_KEY (optional override)' : 'Paste key from jules.google.com/settings'}
                value={localJules}
                onChange={(e) => {
                  setLocalJules(e.target.value);
                  setJulesTestResult(null);
                  setJulesVerify(null);
                }}
                className="font-mono text-xs flex-1 bg-white"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestJulesKey}
                disabled={testingJules || (!localJules && !hasServerJules)}
                className="text-xs shrink-0"
              >
                {testingJules ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClearProvider('jules')}
                disabled={!localJules && !julesVerify}
                className="text-xs shrink-0 text-slate-500 hover:text-red-600"
              >
                Clear
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="owner/repo (optional — checks Jules connection)"
                value={julesVerifyRepo}
                onChange={(e) => {
                  setJulesVerifyRepo(e.target.value);
                  setJulesVerify(null);
                  setJulesTestResult(null);
                }}
                className="font-mono text-xs flex-1 bg-white"
              />
            </div>

            {julesTestResult && (
              <p
                className={`text-[11px] font-medium ${
                  julesTestResult.valid ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                {julesTestResult.message}
              </p>
            )}

            {julesVerify && (
              <div className="rounded-lg border border-indigo-200 bg-white p-2.5 space-y-1 text-xs text-slate-700">
                <p>
                  Sources connected: <strong>{julesVerify.sources.length}</strong>
                </p>
                {julesVerify.targetRepoConnected === true && (
                  <p className="text-emerald-700 font-medium">Target repo is connected.</p>
                )}
                {julesVerify.targetRepoConnected === false && julesVerify.notConnectedNotice && (
                  <p className="text-amber-700 font-medium">{julesVerify.notConnectedNotice}</p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>
                Must be a Jules key from settings — Gemini / AI Studio keys return &ldquo;API keys are not supported&rdquo;.
              </span>
              <a
                href="https://jules.google.com/settings"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium underline"
              >
                Get Jules Key
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* 2. Gemini API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Gemini API Key (Criteria & PR Audit)
              </label>
              {hasServerGemini ? (
                <Badge variant="success" className="gap-1 text-[11px]">
                  <CheckCircle2 className="h-3 w-3" />
                  Server Key Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[11px]">
                  Custom Override
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={hasServerGemini ? 'Inheriting server GEMINI_API_KEY (optional override)' : 'AIzaSy...'}
                value={localGemini}
                onChange={(e) => {
                  setLocalGemini(e.target.value);
                  setGeminiTestResult(null);
                  setGeminiVerify(null);
                }}
                className="font-mono text-xs flex-1 bg-white"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestGeminiKey}
                disabled={testingGemini || (!localGemini.trim() && !hasServerGemini)}
                className="text-xs shrink-0"
              >
                {testingGemini ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClearProvider('gemini')}
                disabled={!localGemini && !geminiVerify}
                className="text-xs shrink-0 text-slate-500 hover:text-red-600"
              >
                Clear
              </Button>
            </div>

            {geminiTestResult && (
              <p
                className={`text-[11px] font-medium ${
                  geminiTestResult.valid ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                {geminiTestResult.message}
              </p>
            )}

            {geminiVerify && geminiVerify.sampleModels.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">Sample models</p>
                <ul className="list-disc list-inside font-mono text-[11px]">
                  {geminiVerify.sampleModels.slice(0, 3).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              Powers Stage 1 AI Criteria Architect and Stage 2 Structured PR Evaluation via server-side Gemini 3.8 models.
            </p>
          </div>

          {/* 3. GitHub Personal Access Token */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Github className="h-4 w-4 text-slate-900" />
                GitHub Personal Access Token (PAT)
              </label>
              {localPat ? (
                <Badge variant="success" className="gap-1 text-[11px]">
                  <CheckCircle2 className="h-3 w-3" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[11px]">
                  Public / Optional
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="ghp_... or github_pat_..."
                value={localPat}
                onChange={(e) => {
                  setLocalPat(e.target.value);
                  setPatTestResult(null);
                  setGithubVerify(null);
                }}
                className="font-mono text-xs flex-1 bg-white"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestPat}
                disabled={testingPat || !localPat.trim()}
                className="text-xs shrink-0"
              >
                {testingPat ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClearProvider('github')}
                disabled={!localPat && !githubVerify}
                className="text-xs shrink-0 text-slate-500 hover:text-red-600"
              >
                Clear
              </Button>
            </div>

            {patTestResult && (
              <p
                className={`text-[11px] font-medium ${
                  patTestResult.valid ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                {patTestResult.message}
              </p>
            )}

            {githubVerify && (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-1 text-xs text-slate-700">
                <p>
                  Identity: <strong className="font-mono">@{githubVerify.login || 'unknown'}</strong>
                  {githubVerify.name ? ` (${githubVerify.name})` : ''}
                </p>
                <p>
                  Token type: <strong className="font-mono">{githubVerify.tokenType}</strong>
                </p>
                {githubVerify.scopes.length > 0 && (
                  <p>
                    Scopes:{' '}
                    <span className="font-mono text-[11px]">{githubVerify.scopes.join(', ')}</span>
                  </p>
                )}
                {githubVerify.warnings.map((w) => (
                  <p key={w} className="text-amber-700 font-medium">
                    {w}
                  </p>
                ))}
              </div>
            )}

            {githubVerify?.tokenType === 'classic' && githubVerify.scopes.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <p className="font-semibold">Classic PAT with broad scopes</p>
                <p className="font-mono text-[11px]">{githubVerify.scopes.join(', ')}</p>
                <p>Fine-grained is recommended.</p>
              </div>
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              Required for private repositories, pre-dispatch accessibility checks, and avoiding GitHub unauthenticated rate limits.
            </p>
          </div>

          {clearAllNotice && (
            <p className="text-[11px] font-medium text-slate-600">{clearAllNotice}</p>
          )}

          {/* Security Guarantee Alert */}
          <Alert variant="info" className="bg-slate-50 border-slate-200">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            <AlertDescription className="text-xs text-slate-600">
              <strong className="font-semibold text-slate-800">Stateless Security: </strong>
              Keys are transmitted strictly via HTTPS request headers (<code className="bg-slate-200/60 px-1 rounded">x-jules-api-key</code>, <code className="bg-slate-200/60 px-1 rounded">x-gemini-api-key</code>, <code className="bg-slate-200/60 px-1 rounded">x-github-pat</code>) directly to server proxies and are never logged or stored in remote databases.
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={handleClear} className="text-slate-500 hover:text-red-600">
          Clear Keys
        </Button>
        <Button variant="ghost" size="sm" onClick={handleClearAllKeys} className="text-slate-500 hover:text-red-600">
          Clear all keys
        </Button>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} className="bg-slate-900 text-white hover:bg-slate-800">
          {savedSuccess ? 'Saved!' : 'Save Credentials'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

