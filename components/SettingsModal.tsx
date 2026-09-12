'use client';

import * as React from 'react';
import { Key, Github, Sparkles, CheckCircle2, ShieldCheck, Bot, ExternalLink } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  julesKey: string;
  setJulesKey: (key: string) => void;
  geminiKey: string;
  setGeminiKey: (key: string) => void;
  githubPat: string;
  setGithubPat: (pat: string) => void;
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

  React.useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        setLocalJules(julesKey);
        setLocalGemini(geminiKey);
        setLocalPat(githubPat);
        setJulesTestResult(null);
        setPatTestResult(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [julesKey, geminiKey, githubPat, open]);

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
    try {
      const headers: Record<string, string> = {};
      if (localJules.trim()) {
        headers['x-jules-api-key'] = localJules.trim();
      }
      const res = await fetch('/api/jules/sources', { headers });
      const data = await res.json();
      if (data.valid) {
        setJulesTestResult({
          valid: true,
          message: `Connected successfully! (${data.sources?.length ?? 0} repository sources connected)`,
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

  const handleTestPat = async () => {
    setTestingPat(true);
    setPatTestResult(null);
    try {
      const headers: Record<string, string> = {};
      if (localPat.trim()) {
        headers['x-github-pat'] = localPat.trim();
      }
      const res = await fetch('/api/github/status', { headers });
      const data = await res.json();
      if (data.isValid) {
        setPatTestResult({
          valid: true,
          message: `Connected as @${data.login || 'user'}! (${data.rateLimit?.remaining ?? 5000} req/hr remaining)`,
        });
      } else {
        setPatTestResult({
          valid: false,
          message: data.error || 'GitHub token rejected (401 Bad credentials)',
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

  const handleSave = () => {
    setJulesKey(localJules.trim());
    setGeminiKey(localGemini.trim());
    setGithubPat(localPat.trim());
    if (typeof window !== 'undefined') {
      localStorage.setItem('repopilot_jules_key', localJules.trim());
      localStorage.setItem('repopilot_gemini_key', localGemini.trim());
      localStorage.setItem('repopilot_github_pat', localPat.trim());
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onOpenChange(false);
    }, 600);
  };

  const handleClear = () => {
    setLocalJules('');
    setLocalGemini('');
    setLocalPat('');
    setJulesKey('');
    setGeminiKey('');
    setGithubPat('');
    setJulesTestResult(null);
    setPatTestResult(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('repopilot_jules_key');
      localStorage.removeItem('repopilot_gemini_key');
      localStorage.removeItem('repopilot_github_pat');
    }
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
                placeholder={hasServerJules ? 'Inheriting server JULES_API_KEY (optional override)' : 'AIzaSy... (Jules API Key)'}
                value={localJules}
                onChange={(e) => {
                  setLocalJules(e.target.value);
                  setJulesTestResult(null);
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
                {testingJules ? 'Testing...' : 'Test Key'}
              </Button>
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

            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>
                Dispatches sessions directly to <code className="text-indigo-700 bg-indigo-100/60 px-1 py-0.5 rounded font-mono">jules.googleapis.com</code>.
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
            <Input
              type="password"
              placeholder={hasServerGemini ? 'Inheriting server GEMINI_API_KEY (optional override)' : 'AIzaSy...'}
              value={localGemini}
              onChange={(e) => setLocalGemini(e.target.value)}
              className="font-mono text-xs"
            />
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
                {testingPat ? 'Testing...' : 'Test Token'}
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

            <p className="text-xs text-slate-500 leading-relaxed">
              Required for private repositories, pre-dispatch accessibility checks, and avoiding GitHub unauthenticated rate limits.
            </p>
          </div>

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

