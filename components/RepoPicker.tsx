'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, GitBranch, RefreshCw, AlertCircle } from 'lucide-react';

interface RepoPickerProps {
  onSelectRepo: (repoFullName: string) => void;
  selectedRepo?: string;
  githubPat?: string;
  disabled?: boolean;
}

export function RepoPicker({
  onSelectRepo,
  selectedRepo = '',
  githubPat = '',
  disabled = false,
}: RepoPickerProps) {
  const [inputVal, setInputVal] = React.useState(selectedRepo);
  const [userRepos, setUserRepos] = React.useState<Array<{ full_name: string; private: boolean }>>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchUserRepos = React.useCallback(async () => {
    if (!githubPat || !githubPat.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${githubPat.trim()}`,
      };

      const res = await fetch('https://api.github.com/user/repos?per_page=50&sort=updated', { headers });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('GitHub PAT invalid or expired.');
        }
        throw new Error(`Failed to list repos (${res.status})`);
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : data.items || [];
      const list = items
        .map((r: any) => ({
          full_name: r.full_name || '',
          private: !!r.private,
        }))
        .filter((r: any) => r.full_name);

      setUserRepos(list);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch repositories.');
    } finally {
      setLoading(false);
    }
  }, [githubPat]);

  React.useEffect(() => {
    if (!githubPat || !githubPat.trim()) return;
    let ignore = false;
    async function init() {
      try {
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github.v3+json',
          Authorization: `Bearer ${githubPat.trim()}`,
        };
        const res = await fetch('https://api.github.com/user/repos?per_page=50&sort=updated', { headers });
        if (!res.ok) {
          if (res.status === 401) throw new Error('GitHub PAT invalid or expired.');
          throw new Error(`Failed to list repos (${res.status})`);
        }
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.items || [];
        const list = items
          .map((r: any) => ({
            full_name: r.full_name || '',
            private: !!r.private,
          }))
          .filter((r: any) => r.full_name);
        if (!ignore) setUserRepos(list);
      } catch (err: any) {
        if (!ignore) setError(err.message || 'Failed to fetch repositories.');
      }
    }
    void init();
    return () => {
      ignore = true;
    };
  }, [githubPat]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (trimmed && trimmed.includes('/')) {
      onSelectRepo(trimmed);
    } else {
      setError('Please enter a valid "owner/repository" format (e.g. octocat/Hello-World).');
    }
  };

  return (
    <div className="w-full space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-indigo-600" />
          Select Repository to Scan
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Choose a connected repository from GitHub or enter an owner/repo manually.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder="owner/repo (e.g., Brian125bot/repopilot)"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            disabled={disabled}
            className="pl-9 text-xs"
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || !inputVal.trim()}
          size="sm"
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          Scan Repo
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {userRepos.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Recent Repositories</span>
            <button
              type="button"
              onClick={fetchUserRepos}
              disabled={loading || disabled}
              className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-slate-100 p-1 bg-slate-50/50">
            {userRepos.map((r) => (
              <button
                key={r.full_name}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setInputVal(r.full_name);
                  onSelectRepo(r.full_name);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between hover:bg-white hover:shadow-xs ${
                  selectedRepo === r.full_name ? 'bg-indigo-50 font-semibold text-indigo-900 border border-indigo-200' : 'text-slate-700'
                }`}
              >
                <span className="truncate">{r.full_name}</span>
                {r.private && (
                  <span className="text-[10px] px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded font-medium ml-2 shrink-0">
                    Private
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
