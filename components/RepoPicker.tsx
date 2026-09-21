'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Loader2, Search } from 'lucide-react';

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

export function RepoPicker({ githubPat, onSelect, disabled }: RepoPickerProps) {
  const [manualInput, setManualInput] = useState('');
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    if (!githubPat) {
      setTimeout(() => setRepos([]), 0);
      return;
    }

    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingRepos(true);

    fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `Bearer ${githubPat}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch repos');
        return res.json();
      })
      .then((data: GithubRepo[]) => {
        if (isMounted) setRepos(data);
      })
      .catch((err) => {
        console.warn('Could not load github repos for picker', err);
      })
      .finally(() => {
        if (isMounted) setLoadingRepos(false);
      });

    return () => {
      isMounted = false;
    };
  }, [githubPat]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim() || !manualInput.includes('/')) return;
    const [owner, repo] = manualInput.split('/');
    if (owner && repo) {
      onSelect({ owner: owner.trim(), repo: repo.trim() });
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <Input
          placeholder="owner/repo (e.g. facebook/react)"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          disabled={disabled}
          className="flex-1"
        />
        <Button type="submit" disabled={disabled || !manualInput.includes('/')} variant="outline">
          <Search className="w-4 h-4 mr-2" />
          Scan Manual
        </Button>
      </form>

      {githubPat && (
        <div className="border rounded-md p-2 max-h-64 overflow-y-auto space-y-1">
          {loadingRepos ? (
            <div className="flex items-center justify-center p-4 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading your repositories...
            </div>
          ) : repos.length === 0 ? (
            <div className="p-2 text-sm text-slate-500">No repositories found.</div>
          ) : (
            repos.map((repo) => (
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
      )}
    </div>
  );
}
