'use client';

import * as React from 'react';
import {
  Github,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Shield,
  Key,
  ChevronDown,
} from 'lucide-react';
import { GitHubPATValidationResult } from '@/lib/github';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

interface GitHubStatusIndicatorProps {
  githubPat: string;
  onOpenSettings: () => void;
  className?: string;
}

export function GitHubStatusIndicator({
  githubPat,
  onOpenSettings,
  className = '',
}: GitHubStatusIndicatorProps) {
  const [statusResult, setStatusResult] = React.useState<GitHubPATValidationResult | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [popoverOpen, setPopoverOpen] = React.useState<boolean>(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const checkStatus = React.useCallback(async (patOverride?: string) => {
    setLoading(true);
    try {
      const activePat = patOverride !== undefined ? patOverride : githubPat;
      const headers: Record<string, string> = {};
      if (activePat && activePat.trim()) {
        headers['x-github-pat'] = activePat.trim();
      }

      const res = await fetch('/api/github/status', {
        method: 'GET',
        headers,
      });

      if (res.ok) {
        const data = (await res.json()) as GitHubPATValidationResult;
        setStatusResult(data);
      } else {
        setStatusResult({
          status: 'error',
          isValid: false,
          error: `HTTP ${res.status} checking GitHub status`,
          checkedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setStatusResult({
        status: 'error',
        isValid: false,
        error: err instanceof Error ? err.message : 'Network error verifying PAT',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [githubPat]);

  // Re-check when githubPat changes or on initial mount
  React.useEffect(() => {
    const timer = setTimeout(() => {
      checkStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [checkStatus]);

  // Close popover when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    }
    if (popoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [popoverOpen]);

  const status = statusResult?.status ?? (githubPat ? 'valid' : 'none');
  const isValid = statusResult?.isValid ?? false;

  const getStatusBadge = () => {
    if (loading) {
      return (
        <span className="flex items-center gap-1.5 text-slate-600 font-medium">
          <RefreshCw className="h-3 w-3 animate-spin text-indigo-600" />
          <span className="hidden sm:inline">Verifying...</span>
        </span>
      );
    }

    if (status === 'valid' && isValid) {
      return (
        <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-mono text-xs">
            {statusResult?.login ? `@${statusResult.login}` : 'PAT Valid'}
          </span>
        </span>
      );
    }

    if (status === 'invalid') {
      return (
        <span className="flex items-center gap-1.5 text-rose-700 font-medium">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          <span>Invalid PAT</span>
        </span>
      );
    }

    if (status === 'rate_limited') {
      return (
        <span className="flex items-center gap-1.5 text-amber-700 font-medium">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span>Rate Limited</span>
        </span>
      );
    }

    // Default 'none' / unauthenticated
    return (
      <span className="flex items-center gap-1.5 text-slate-600">
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        <span className="hidden sm:inline text-[11px]">Public (No PAT)</span>
        <span className="sm:hidden text-[11px]">Public</span>
      </span>
    );
  };

  const getBorderColor = () => {
    if (loading) return 'border-indigo-200 bg-indigo-50/30';
    if (status === 'valid') return 'border-emerald-200/90 bg-emerald-50/40 hover:bg-emerald-50/70 text-emerald-950';
    if (status === 'invalid') return 'border-rose-300 bg-rose-50/50 hover:bg-rose-50 text-rose-950';
    if (status === 'rate_limited') return 'border-amber-300 bg-amber-50/50 hover:bg-amber-50 text-amber-950';
    return 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/70 text-slate-700';
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        id="github-status-trigger"
        onClick={() => setPopoverOpen(!popoverOpen)}
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all cursor-pointer shadow-2xs ${getBorderColor()}`}
        title="GitHub Connection Status: click for details"
        aria-expanded={popoverOpen}
      >
        <Github className="h-3.5 w-3.5 shrink-0 text-slate-800" />
        {getStatusBadge()}
        <ChevronDown className="h-3 w-3 text-slate-400 opacity-60" />
      </button>

      {/* Popover Card */}
      {popoverOpen && (
        <div
          id="github-status-popover"
          className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100 text-xs"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-slate-900" />
              <span className="font-semibold text-slate-900">GitHub Connection</span>
            </div>
            <button
              type="button"
              onClick={() => checkStatus()}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer disabled:opacity-50"
              title="Refresh connection status"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Recheck
            </button>
          </div>

          {/* Body based on status */}
          <div className="py-3 space-y-3">
            {/* Status overview card */}
            <div
              className={`rounded-lg p-2.5 border ${
                status === 'valid'
                  ? 'bg-emerald-50/60 border-emerald-200/80 text-emerald-950'
                  : status === 'invalid'
                  ? 'bg-rose-50/60 border-rose-200 text-rose-950'
                  : status === 'rate_limited'
                  ? 'bg-amber-50/60 border-amber-200 text-amber-950'
                  : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <div className="flex items-start gap-2">
                {status === 'valid' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : status === 'invalid' ? (
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                ) : status === 'rate_limited' ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <Shield className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                )}

                <div className="space-y-0.5 flex-1">
                  <p className="font-semibold text-xs">
                    {status === 'valid'
                      ? 'Authenticated & Ready'
                      : status === 'invalid'
                      ? 'Authentication Failed'
                      : status === 'rate_limited'
                      ? 'Rate Limit Reached'
                      : 'Unauthenticated Public Access'}
                  </p>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    {status === 'valid'
                      ? 'Valid Personal Access Token configured. Private repos, branch checks, and Jules dispatch contracts are fully enabled.'
                      : status === 'invalid'
                      ? statusResult?.error || 'Your PAT was rejected by GitHub (401 Bad credentials). Update your token in Settings.'
                      : status === 'rate_limited'
                      ? 'The unauthenticated rate limit (60 req/hr) is exhausted. Add a PAT to unlock 5,000 req/hr.'
                      : 'Public repositories only. For private repos and 5,000 req/hr rate limits, add a PAT in Settings.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Authenticated user profile information */}
            {status === 'valid' && statusResult?.user && (
              <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">User Account</span>
                  <a
                    href={statusResult.user.htmlUrl || `https://github.com/${statusResult.user.login}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-slate-900 font-semibold hover:text-indigo-600 flex items-center gap-1"
                  >
                    @{statusResult.user.login}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>

                {statusResult.scopes && statusResult.scopes.length > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Token Scopes</span>
                    <div className="flex flex-wrap gap-1 justify-end max-w-[180px]">
                      {statusResult.scopes.slice(0, 3).map((scope) => (
                        <span
                          key={scope}
                          className="bg-white border border-slate-200 px-1 py-0.2 rounded font-mono text-[10px] text-slate-700"
                        >
                          {scope}
                        </span>
                      ))}
                      {statusResult.scopes.length > 3 && (
                        <span className="text-[10px] text-slate-500">+{statusResult.scopes.length - 3}</span>
                      )}
                    </div>
                  </div>
                )}

                {statusResult.source && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Token Origin</span>
                    <span className="text-slate-700 font-medium">
                      {statusResult.source === 'server' ? 'Server Environment' : 'Browser Session'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Rate limit tracker */}
            {statusResult?.rateLimit && (
              <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">API Rate Limit</span>
                  <span className="font-mono font-medium text-slate-900">
                    {statusResult.rateLimit.remaining.toLocaleString()} /{' '}
                    {statusResult.rateLimit.limit.toLocaleString()} req/hr
                  </span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      statusResult.rateLimit.remaining / statusResult.rateLimit.limit > 0.3
                        ? 'bg-emerald-500'
                        : statusResult.rateLimit.remaining / statusResult.rateLimit.limit > 0.1
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(2, (statusResult.rateLimit.remaining / statusResult.rateLimit.limit) * 100)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setPopoverOpen(false);
                onOpenSettings();
              }}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
            >
              <Key className="h-3.5 w-3.5" />
              Configure PAT
            </button>

            <span className="text-[10px] text-slate-400">
              {statusResult?.checkedAt ? 'Checked just now' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
