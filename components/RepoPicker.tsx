'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Loader2, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { validateAndParseRef } from '@/lib/repo-profile/ref';
import { parseOwnerRepo } from '@/lib/github';

interface RepoPickerProps {
  githubPat: string | null;
  onSelect: (repo: { owner: string; repo: string }) => void;
  disabled?: boolean;
}

interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
}

function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const links: Record<string, string> = {};
  const parts = header.split(',');
  for (const part of parts) {
    const section = part.split(';');
    if (section.length !== 2) continue;
    const url = section[0].replace(/<|>/g, '').trim();
    const name = section[1].replace(/rel="(.*)"/, '$1').trim();
    links[name] = url;
  }
  return links;
}

export function RepoPicker({ githubPat, onSelect, disabled }: RepoPickerProps) {
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoFetchError, setRepoFetchError] = useState<string | null>(null);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    if (!githubPat) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRepos([]);
      setRepoFetchError(null);
      setLoadingRepos(false);
      setHasMorePages(false);
      return;
    }

    const controller = new AbortController();
    setLoadingRepos(true);
    setRepoFetchError(null);

    const timer = setTimeout(() => {
      async function fetchPages() {
        let currentUrl: string | null = 'https://api.github.com/user/repos?per_page=100&sort=updated';
        let pagesCount = 0;
        const allRepos: GithubRepo[] = [];
        let hitCapWithNext = false;

        try {
          while (currentUrl && pagesCount < 3 && !controller.signal.aborted) {
            pagesCount++;
            const res = await fetch(currentUrl, {
              headers: {
                Authorization: `Bearer ${githubPat}`,
                Accept: 'application/vnd.github.v3+json',
              },
              signal: controller.signal,
            });

            if (!res.ok) {
              if (res.status === 401) {
                throw new Error('GitHub rejected this token.');
              }
              if (res.status === 403) {
                throw new Error('Access forbidden or rate limit exceeded.');
              }
              throw new Error(`Failed to load repositories (HTTP ${res.status}).`);
            }

            const data = (await res.json()) as GithubRepo[];
            if (Array.isArray(data)) {
              allRepos.push(...data);
            }

            const linkHeader = res.headers.get('link');
            const links = parseLinkHeader(linkHeader);
            if (links.next && pagesCount < 3) {
              currentUrl = links.next;
            } else {
              if (links.next && pagesCount >= 3) {
                hitCapWithNext = true;
              }
              currentUrl = null;
            }
          }

          if (!controller.signal.aborted) {
            setRepos(allRepos);
            setHasMorePages(hitCapWithNext);
            setRepoFetchError(null);
          }
        } catch (err: unknown) {
          if (controller.signal.aborted) return;
          if (err instanceof Error) {
            setRepoFetchError(err.message);
          } else {
            setRepoFetchError('Failed to fetch repository list.');
          }
        } finally {
          if (!controller.signal.aborted) {
            setLoadingRepos(false);
          }
        }
      }

      void fetchPages();
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [githubPat, fetchTrigger]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);

    const input = manualInput.trim();
    if (!input) {
      setManualError('Please enter an owner/repo path.');
      return;
    }

    const segments = input.split('/');
    if (segments.length !== 2) {
      setManualError('Must be in owner/repo format (exactly one slash).');
      return;
    }

    const parsed = parseOwnerRepo(input);
    if (!parsed) {
      setManualError('Invalid owner/repo string.');
      return;
    }

    try {
      const validated = validateAndParseRef(parsed);
      onSelect({ owner: validated.owner, repo: validated.repo });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setManualError(err.message);
      } else {
        setManualError('Invalid repository owner or name format.');
      }
    }
  };

  const visibleRepos = React.useMemo(() => {
    if (!searchQuery.trim()) return repos;
    const q = searchQuery.toLowerCase().trim();
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, searchQuery]);

  return (
    <div className="space-y-4">
      <form onSubmit={handleManualSubmit} className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="owner/repo (e.g. facebook/react)"
            value={manualInput}
            onChange={(e) => {
              setManualInput(e.target.value);
              setManualError(null);
            }}
            disabled={disabled}
            className="flex-1"
          />
          <Button type="submit" disabled={disabled || !manualInput.includes('/')} variant="outline">
            <Search className="w-4 h-4 mr-2" />
            Scan Manual
          </Button>
        </div>
        {manualError && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {manualError}
          </p>
        )}
      </form>

      {githubPat && (
        <div className="space-y-2">
          <Input
            placeholder="Filter repositories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={disabled || loadingRepos}
            className="text-xs"
          />

          <div className="border rounded-md p-2 max-h-64 overflow-y-auto space-y-1">
            {loadingRepos ? (
              <div className="flex items-center justify-center p-4 text-slate-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mr-2 text-indigo-600" />
                Loading your repositories...
              </div>
            ) : repoFetchError ? (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded border border-red-200 flex items-center justify-between">
                <span>{repoFetchError}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFetchTrigger((prev) => prev + 1)}
                  className="text-red-700 hover:bg-red-100"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Retry
                </Button>
              </div>
            ) : visibleRepos.length === 0 ? (
              <div className="p-2 text-sm text-slate-500">
                {searchQuery ? 'No matching repositories.' : 'No repositories found.'}
              </div>
            ) : (
              visibleRepos.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect({ owner: repo.owner.login, repo: repo.name })}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {repo.full_name}
                </button>
              ))
            )}
          </div>

          {hasMorePages && !loadingRepos && !repoFetchError && (
            <p className="text-[11px] text-slate-500 italic">
              Showing first ~300 repositories, use owner/repo for others
            </p>
          )}
        </div>
      )}
    </div>
  );
}
