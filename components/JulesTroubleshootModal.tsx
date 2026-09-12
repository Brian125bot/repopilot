'use client';

import * as React from 'react';
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  RefreshCw,
  FolderGit2,
  GitBranch,
  Key,
  ShieldAlert,
  Send,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { findJulesSource } from '@/lib/jules';

export interface JulesSourceSummary {
  name: string;
  id: string;
  githubRepo?: {
    owner: string;
    repo: string;
    defaultBranch?: { displayName?: string };
    branches?: Array<{ displayName?: string }>;
    isPrivate?: boolean;
  };
}

interface JulesTroubleshootModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetRepo: string;
  onSelectRepo: (repo: string, defaultBranch?: string) => void;
  julesKey: string;
  baseBranch: string;
  onOpenSettings: () => void;
}

export function JulesTroubleshootModal({
  open,
  onOpenChange,
  targetRepo,
  onSelectRepo,
  julesKey,
  baseBranch,
  onOpenSettings,
}: JulesTroubleshootModalProps) {
  const [isRunningDiagnostic, setIsRunningDiagnostic] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'sources' | 'probe' | 'guide'>('overview');

  // Diagnostic state
  const [keyStatus, setKeyStatus] = React.useState<{
    configured: boolean;
    valid: boolean;
    hasServerKey: boolean;
    sourcesCount: number;
    error?: string;
  } | null>(null);

  const [sources, setSources] = React.useState<JulesSourceSummary[]>([]);
  const [sourcesTruncated, setSourcesTruncated] = React.useState(false);
  const [searchFilter, setSearchFilter] = React.useState('');

  // Live probe state
  const [isProbing, setIsProbing] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<{
    success: boolean;
    status?: number;
    apiStatus?: string;
    sessionId?: string;
    sessionUrl?: string;
    warningMessage?: string;
    error?: string;
    raw?: unknown;
  } | null>(null);

  const cleanCurrentRepo = React.useMemo(() => {
    return targetRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
  }, [targetRepo]);

  const matchedSource = React.useMemo(() => {
    if (!cleanCurrentRepo) return null;
    // Single shared matcher with the server bind path (lib/jules.ts).
    return findJulesSource(sources, cleanCurrentRepo);
  }, [cleanCurrentRepo, sources]);

  const runDiagnostic = React.useCallback(async () => {
    setIsRunningDiagnostic(true);
    try {
      const headers: Record<string, string> = {};
      if (julesKey.trim()) {
        headers['x-jules-api-key'] = julesKey.trim();
      }

      const res = await fetch('/api/jules/sources', { headers });
      const data = await res.json();

      setKeyStatus({
        configured: data.configured === true,
        valid: data.valid === true,
        hasServerKey: data.hasServerKey === true,
        sourcesCount: Array.isArray(data.sources) ? data.sources.length : 0,
        error: data.error || (data.valid ? undefined : data.message),
      });

      if (data.valid && Array.isArray(data.sources)) {
        setSources(data.sources);
        setSourcesTruncated(data.truncated === true);
      } else {
        setSources([]);
        setSourcesTruncated(false);
      }
    } catch (err) {
      setKeyStatus({
        configured: true,
        valid: false,
        hasServerKey: false,
        sourcesCount: 0,
        error: err instanceof Error ? err.message : 'Network error testing Google Jules endpoint',
      });
    } finally {
      setIsRunningDiagnostic(false);
    }
  }, [julesKey]);

  React.useEffect(() => {
    if (!open) return;
    let isCancelled = false;

    const executeCheck = async () => {
      try {
        const headers: Record<string, string> = {};
        if (julesKey.trim()) {
          headers['x-jules-api-key'] = julesKey.trim();
        }

        const res = await fetch('/api/jules/sources', { headers });
        const data = await res.json();

        if (!isCancelled) {
          setKeyStatus({
            configured: data.configured === true,
            valid: data.valid === true,
            hasServerKey: data.hasServerKey === true,
            sourcesCount: Array.isArray(data.sources) ? data.sources.length : 0,
            error: data.error || (data.valid ? undefined : data.message),
          });

          if (data.valid && Array.isArray(data.sources)) {
            setSources(data.sources);
            setSourcesTruncated(data.truncated === true);
          } else {
            setSources([]);
            setSourcesTruncated(false);
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setKeyStatus({
            configured: true,
            valid: false,
            hasServerKey: false,
            sourcesCount: 0,
            error: err instanceof Error ? err.message : 'Network error testing Google Jules endpoint',
          });
        }
      }
    };

    executeCheck();
    return () => {
      isCancelled = true;
    };
  }, [open, julesKey]);

  const filteredSources = React.useMemo(() => {
    if (!searchFilter.trim()) return sources;
    const q = searchFilter.toLowerCase().trim();
    return sources.filter((s) => {
      const id = (s.id || s.name || '').toLowerCase();
      const owner = (s.githubRepo?.owner || '').toLowerCase();
      const name = (s.githubRepo?.repo || '').toLowerCase();
      return id.includes(q) || owner.includes(q) || name.includes(q);
    });
  }, [sources, searchFilter]);

  const handleTestProbe = async () => {
    setIsProbing(true);
    setProbeResult(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (julesKey.trim()) headers['x-jules-api-key'] = julesKey.trim();

      const response = await fetch('/api/jules/dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repo: cleanCurrentRepo,
          baseBranch: baseBranch || 'main',
          objective: 'RepoPilot Jules Dispatch Diagnostic Probe',
          criteria: [
            {
              id: 'diag-1',
              text: 'Verify live Google Jules API session creation and source authorization',
              category: 'functional',
            },
          ],
          dryRun: false,
        }),
      });

      const data = await response.json();
      const sessionUrl = data.julesApiResponse?.url || (data.sessionId ? `https://jules.google.com/session/${data.sessionId.replace(/^sessions\//, '')}` : undefined);

      if (response.ok) {
        setProbeResult({
          success: data.apiStatus === 'DISPATCHED_TO_JULES',
          status: response.status,
          apiStatus: data.apiStatus,
          sessionId: data.sessionId,
          sessionUrl: sessionUrl,
          warningMessage: data.warningMessage,
          raw: data,
        });
      } else {
        setProbeResult({
          success: false,
          status: response.status,
          error: data.error || `HTTP ${response.status} returned by server`,
          raw: data,
        });
      }
    } catch (err) {
      setProbeResult({
        success: false,
        error: err instanceof Error ? err.message : 'Network error executing probe',
      });
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                <Wrench className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">
                  Google Jules Dispatch Troubleshooter
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-600">
                  Diagnose connection issues, verify repository authorization, and troubleshoot API dispatch errors.
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={runDiagnostic}
              disabled={isRunningDiagnostic}
              className="h-7 text-xs gap-1.5"
            >
              <RefreshCw className={`h-3 w-3 ${isRunningDiagnostic ? 'animate-spin' : ''}`} />
              Re-test
            </Button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 pt-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'overview'
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Live Diagnosis
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'sources'
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Connected Repos
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-slate-200 text-slate-800">
                {sources.length}
              </Badge>
            </button>
            <button
              onClick={() => setActiveTab('probe')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'probe'
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Dispatch Probe
            </button>
            <button
              onClick={() => setActiveTab('guide')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'guide'
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Troubleshooting FAQ
            </button>
          </div>
        </DialogHeader>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Diagnostic 1: Key Status */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-indigo-600" />
                    <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                      1. Google Jules Authentication Check
                    </span>
                  </div>
                  {keyStatus?.valid ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 gap-1 text-[11px]">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Key Authenticated
                    </Badge>
                  ) : keyStatus?.configured ? (
                    <Badge variant="destructive" className="gap-1 text-[11px]">
                      <XCircle className="h-3 w-3" />
                      Key Rejected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 gap-1 text-[11px]">
                      <AlertTriangle className="h-3 w-3 text-amber-600" />
                      No Key Found
                    </Badge>
                  )}
                </div>

                <div className="text-slate-600 space-y-1">
                  <p>
                    <strong>Key Source:</strong>{' '}
                    {julesKey ? (
                      <span className="font-mono text-indigo-600">Client Override Header (`x-jules-api-key`)</span>
                    ) : keyStatus?.hasServerKey ? (
                      <span className="font-mono text-emerald-700 font-semibold">Server Environment (`JULES_API_KEY`)</span>
                    ) : (
                      <span className="text-amber-700">Not configured</span>
                    )}
                  </p>
                  {keyStatus?.valid && (
                    <p className="text-emerald-700 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Successfully connected to Google Jules API (`jules.googleapis.com`). {sources.length} active repository sources available.
                    </p>
                  )}
                  {sourcesTruncated && (
                    <p className="text-amber-700 flex items-center gap-1 font-medium pt-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Source list hit the fetch cap — repos beyond these {sources.length} may still be connected. Search above, or connect fewer repos.
                    </p>
                  )}
                  {keyStatus?.error && (
                    <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-rose-800 mt-2 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-rose-900">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Authentication Failed:
                      </div>
                      <p className="font-mono text-[11px] break-all">{keyStatus.error}</p>
                      <p className="text-[11px] text-rose-700 pt-1">
                        Ensure you are using a dedicated key generated at <strong>jules.google.com/settings</strong>. Gemini API keys cannot be used to authenticate Jules agent sessions.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostic 2: Repository Source Authorization */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="h-4 w-4 text-indigo-600" />
                    <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                      2. Target Repository Jules Authorization
                    </span>
                  </div>
                  {matchedSource ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 gap-1 text-[11px]">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Authorized in Jules
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-300 gap-1 text-[11px]">
                      <AlertTriangle className="h-3 w-3 text-rose-600" />
                      Not Found in Jules
                    </Badge>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 font-medium text-[11px]">Current Target Repo:</span>
                      <p className="font-mono font-bold text-slate-800 text-xs">{cleanCurrentRepo || '(none specified)'}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 font-medium text-[11px]">Base Branch:</span>
                      <p className="font-mono font-bold text-slate-700 text-xs flex items-center gap-1 justify-end">
                        <GitBranch className="h-3 w-3" />
                        {baseBranch || 'main'}
                      </p>
                    </div>
                  </div>

                  {matchedSource ? (
                    <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3 space-y-1 text-emerald-900">
                      <p className="font-semibold flex items-center gap-1 text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Repository is connected to your Jules workspace!
                      </p>
                      <p className="text-[11px] text-emerald-700">
                        Google Jules Source ID: <code className="font-mono font-bold">{matchedSource.id}</code>.
                        Default branch in Jules: <strong>{matchedSource.githubRepo?.defaultBranch?.displayName || 'main'}</strong>.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-amber-50/80 border border-amber-200 p-3 space-y-2 text-amber-900">
                      <div className="font-semibold flex items-center gap-1.5 text-amber-800">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Root Cause: &ldquo;{cleanCurrentRepo}&rdquo; is not installed in Google Jules
                      </div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        Google Jules operates on an allowlist of installed repositories. If a repository has not been authorized in your Jules workspace, Jules rejects dispatches with <strong>HTTP 404: Requested entity was not found</strong>.
                      </p>
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <a
                          href="https://jules.google.com"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-700 text-white font-medium text-[11px] hover:bg-amber-800 transition-colors"
                        >
                          Connect Repo in Jules <ExternalLink className="h-3 w-3" />
                        </a>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveTab('sources')}
                          className="h-6 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-100"
                        >
                          Pick one of your {sources.length} connected repos →
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostic 3: Suggested Quick Actions */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-2">
                <span className="font-bold text-indigo-950 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  Recommended Quick Actions
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('sources')}
                    className="justify-start text-xs bg-white text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <FolderGit2 className="h-3.5 w-3.5 mr-1.5 text-indigo-600" />
                    Select from {sources.length} Connected Repos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('probe')}
                    className="justify-start text-xs bg-white text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5 text-indigo-600" />
                    Send Test Probe Dispatch
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sources' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Input
                    placeholder="Search connected repositories..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="text-xs pl-8 h-8"
                  />
                  <FolderGit2 className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                </div>
                <a
                  href="https://jules.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 shrink-0"
                >
                  Manage in Jules <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 max-h-[380px] overflow-y-auto bg-white">
                {filteredSources.length > 0 ? (
                  filteredSources.map((source) => {
                    const repoFullName = source.githubRepo
                      ? `${source.githubRepo.owner}/${source.githubRepo.repo}`
                      : source.id.replace(/^github\//, '');
                    const isSelected = cleanCurrentRepo.toLowerCase() === repoFullName.toLowerCase();
                    const defaultBranchName = source.githubRepo?.defaultBranch?.displayName || 'main';

                    return (
                      <div
                        key={source.name || source.id}
                        className={`p-3 flex items-center justify-between hover:bg-slate-50 transition-colors ${
                          isSelected ? 'bg-indigo-50/50' : ''
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-slate-800 text-xs">
                              {repoFullName}
                            </span>
                            {source.githubRepo?.isPrivate && (
                              <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 py-0">
                                Private
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge variant="indigo" className="text-[10px] py-0">
                                Currently Selected
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                            <GitBranch className="h-3 w-3 text-slate-400" />
                            Default branch: <strong>{defaultBranchName}</strong>
                          </p>
                        </div>

                        <Button
                          variant={isSelected ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => {
                            onSelectRepo(repoFullName, defaultBranchName);
                            onOpenChange(false);
                          }}
                          className={`h-7 text-xs ${
                            isSelected
                              ? 'border-indigo-300 text-indigo-700 bg-white'
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Use This Repo'}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-6 text-center text-slate-500">
                    <p>No matching repositories found.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'probe' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <span className="font-bold text-slate-800 text-xs">Test Live Dispatch Endpoint</span>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Sends a lightweight diagnostic request directly to Google Jules (`/api/jules/dispatch`) using the current repository (<strong>{cleanCurrentRepo || 'none'}</strong>) and branch (<strong>{baseBranch || 'main'}</strong>) to verify session creation.
                </p>
                <Button
                  onClick={handleTestProbe}
                  disabled={isProbing || !cleanCurrentRepo}
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5 mt-2"
                >
                  <Send className={`h-3.5 w-3.5 ${isProbing ? 'animate-pulse' : ''}`} />
                  {isProbing ? 'Sending Probe to Jules API...' : 'Run Probe Now'}
                </Button>
              </div>

              {probeResult && (
                <div
                  className={`rounded-xl border p-4 space-y-3 ${
                    probeResult.success
                      ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                      : 'border-rose-200 bg-rose-50/50 text-rose-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xs">
                      {probeResult.success ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-600" />
                      )}
                      {probeResult.success ? 'Google Jules Session Created Successfully!' : 'Probe Failed or Fallen Back'}
                    </div>
                    {probeResult.status && (
                      <Badge variant="outline" className="text-[10px]">
                        HTTP {probeResult.status}
                      </Badge>
                    )}
                  </div>

                  {probeResult.success && probeResult.sessionUrl && (
                    <div className="pt-1">
                      <p className="text-[11px] text-emerald-800 mb-2">
                        Session created with ID: <code className="font-mono font-bold">{probeResult.sessionId}</code>
                      </p>
                      <a
                        href={probeResult.sessionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold shadow-sm transition-colors"
                      >
                        Open Active Session in Jules Console <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}

                  {probeResult.warningMessage && (
                    <p className="text-[11px] text-amber-800 bg-amber-100/70 p-2.5 rounded border border-amber-200 leading-relaxed">
                      {probeResult.warningMessage}
                    </p>
                  )}

                  {probeResult.error && (
                    <p className="text-[11px] text-rose-800 bg-rose-100/70 p-2.5 rounded border border-rose-200 leading-relaxed font-mono">
                      {probeResult.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'guide' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                <h4 className="font-bold text-slate-900 text-xs">
                  Issue 1: HTTP 404 &ldquo;Requested entity was not found&rdquo;
                </h4>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  <strong>Why it happens:</strong> Google Jules requires that the repository is added as a Source in your Jules workspace at <a href="https://jules.google.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline">jules.google.com</a>. If you dispatch to a repository where the Jules GitHub App is not installed, the API returns 404.
                </p>
                <p className="text-slate-600 text-[11px]">
                  <strong>Solution:</strong> Authorize the repository in Jules, or select one of your already-connected repositories from the Connected Repos tab.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                <h4 className="font-bold text-slate-900 text-xs">
                  Issue 2: HTTP 401 &ldquo;API keys are not supported by this API&rdquo; or &ldquo;API key not valid&rdquo;
                </h4>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  <strong>Why it happens:</strong> Jules API keys are issued separately from Google AI Studio / Gemini keys. If a Gemini API key or expired token is passed, Jules rejects it.
                </p>
                <p className="text-slate-600 text-[11px]">
                  <strong>Solution:</strong> Obtain your key directly from <a href="https://jules.google.com/settings" target="_blank" rel="noreferrer" className="text-indigo-600 underline">jules.google.com/settings</a>, or leave the field blank to utilize the server&apos;s preconfigured key.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                <h4 className="font-bold text-slate-900 text-xs">
                  Issue 3: Stateless Vault Fallback (Zero-Loss Guarantee)
                </h4>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Whenever the Google Jules API cannot be reached directly, RepoPilot compiles and saves the complete anti-drift markdown contract to your local Vault. You can copy the generated prompt and paste it directly into the web interface at <a href="https://jules.google.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline">jules.google.com</a>.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="text-xs text-slate-600 hover:text-slate-900"
          >
            Manage API Credentials
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
