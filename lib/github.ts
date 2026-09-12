export type GitHubPATStatus = 'valid' | 'invalid' | 'none' | 'rate_limited' | 'error';

export interface GitHubUserMetadata {
  login: string;
  name?: string;
  avatarUrl?: string;
  htmlUrl?: string;
  type?: string;
}

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface GitHubPATValidationResult {
  status: GitHubPATStatus;
  isValid: boolean;
  login?: string;
  user?: GitHubUserMetadata;
  scopes?: string[];
  rateLimit?: GitHubRateLimitInfo;
  error?: string;
  checkedAt: string;
  source?: 'user' | 'server' | 'unauthenticated';
}

/**
 * Validates a GitHub Personal Access Token against the GitHub REST API.
 * Fail-closed: handles 401, 403, and network errors gracefully.
 */
export async function validateGitHubToken(
  token?: string | null,
  fetchFn: typeof fetch = fetch
): Promise<GitHubPATValidationResult> {
  const checkedAt = new Date().toISOString();
  const cleanToken = token?.trim()?.replace(/^(?:bearer|token)\s+/i, '') || '';

  // Case 1: No token provided -> inspect unauthenticated rate limit
  if (!cleanToken) {
    try {
      const res = await fetchFn('https://api.github.com/rate_limit', {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'RepoPilot/1.0',
        },
      });

      if (res.ok) {
        const data = await res.json();
        const core = data?.resources?.core;
        return {
          status: 'none',
          isValid: false,
          source: 'unauthenticated',
          rateLimit: core
            ? {
                limit: core.limit ?? 60,
                remaining: core.remaining ?? 60,
                reset: core.reset ?? 0,
              }
            : undefined,
          checkedAt,
        };
      }

      if (res.status === 403) {
        return {
          status: 'rate_limited',
          isValid: false,
          source: 'unauthenticated',
          error: 'Unauthenticated GitHub rate limit reached (60 req/hr). Add a PAT to unlock 5,000 req/hr.',
          checkedAt,
        };
      }
    } catch {
      // Ignore network error on unauthenticated probe
    }

    return {
      status: 'none',
      isValid: false,
      source: 'unauthenticated',
      checkedAt,
    };
  }

  // Case 2: Token provided -> validate against /user
  try {
    const res = await fetchFn('https://api.github.com/user', {
      headers: {
        Authorization: `token ${cleanToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'RepoPilot/1.0',
      },
    });

    const limitHeader = res.headers.get('x-ratelimit-limit');
    const remainingHeader = res.headers.get('x-ratelimit-remaining');
    const resetHeader = res.headers.get('x-ratelimit-reset');

    const rateLimit: GitHubRateLimitInfo | undefined =
      limitHeader && remainingHeader
        ? {
            limit: parseInt(limitHeader, 10),
            remaining: parseInt(remainingHeader, 10),
            reset: resetHeader ? parseInt(resetHeader, 10) : 0,
          }
        : undefined;

    if (res.ok) {
      const data = await res.json();
      const rawScopes = res.headers.get('x-oauth-scopes');
      const scopes = rawScopes
        ? rawScopes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      return {
        status: 'valid',
        isValid: true,
        login: data.login,
        user: {
          login: data.login,
          name: data.name || undefined,
          avatarUrl: data.avatar_url || undefined,
          htmlUrl: data.html_url || undefined,
          type: data.type || undefined,
        },
        scopes,
        rateLimit,
        checkedAt,
      };
    }

    // 401 Unauthorized -> Bad credentials
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      return {
        status: 'invalid',
        isValid: false,
        error: data.message || 'Invalid or expired Personal Access Token (401 Bad credentials)',
        checkedAt,
      };
    }

    // 403 Forbidden -> Rate limit or permission denied
    if (res.status === 403) {
      const isRateLimit = remainingHeader === '0';
      const data = await res.json().catch(() => ({}));
      return {
        status: isRateLimit ? 'rate_limited' : 'invalid',
        isValid: false,
        error: isRateLimit
          ? 'GitHub API rate limit exhausted'
          : data.message || 'Token lacks permissions or access was denied (403 Forbidden)',
        rateLimit,
        checkedAt,
      };
    }

    return {
      status: 'invalid',
      isValid: false,
      error: `GitHub API returned HTTP ${res.status}`,
      checkedAt,
    };
  } catch (err) {
    return {
      status: 'error',
      isValid: false,
      error: err instanceof Error ? err.message : 'Network error verifying GitHub token',
      checkedAt,
    };
  }
}

export function githubRequestHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'RepoPilot/1.0',
  };
  const clean = token?.trim()?.replace(/^(?:bearer|token)\s+/i, '') || '';
  if (clean) headers.Authorization = `Bearer ${clean}`;
  return headers;
}

export function parseGitHubPRUrl(
  input: string
): { owner: string; repo: string; pullNumber: number } | null {
  const trimmed = (input || '').trim();
  const urlMatch = trimmed.match(/(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/i, ''),
      pullNumber: parseInt(urlMatch[3], 10),
    };
  }

  const hashMatch = trimmed.match(/^([^/\s]+)\/([^#\s]+)#(\d+)\s*$/);
  if (hashMatch) {
    return {
      owner: hashMatch[1],
      repo: hashMatch[2].replace(/\.git$/i, ''),
      pullNumber: parseInt(hashMatch[3], 10),
    };
  }

  return null;
}

export function parseOwnerRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = (input || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const [owner, repo] = cleaned.split('/');
  if (!owner || !repo) return null;
  return { owner, repo: repo.replace(/\/.*$/, '') };
}

export type AuditIngestTarget =
  | { kind: 'pr'; owner: string; repo: string; pullNumber: number }
  | { kind: 'branch'; owner: string; repo: string; headBranch: string }
  | { kind: 'unknown' };

/** Parses a Stage 2 ingest field: PR URL, owner/repo#123, owner/repo#branch, or owner/repo (branch). */
export function parseAuditIngestTarget(input: string): AuditIngestTarget {
  const trimmed = (input || '').trim();
  if (!trimmed) return { kind: 'unknown' };

  const pr = parseGitHubPRUrl(trimmed);
  if (pr) return { kind: 'pr', ...pr };

  const paren = trimmed.match(/^([^/\s]+)\/([^/\s(]+)\s*\(([^)]+)\)\s*$/);
  if (paren?.[3]?.trim()) {
    return {
      kind: 'branch',
      owner: paren[1],
      repo: paren[2].replace(/\.git$/i, ''),
      headBranch: paren[3].trim(),
    };
  }

  const hash = trimmed.match(/^([^/\s]+)\/([^#\s]+)#(.+)$/);
  if (hash?.[3]?.trim() && !/^\d+$/.test(hash[3].trim())) {
    return {
      kind: 'branch',
      owner: hash[1],
      repo: hash[2].replace(/\.git$/i, ''),
      headBranch: hash[3].trim(),
    };
  }

  return { kind: 'unknown' };
}

export interface GitHubPullSummary {
  number: number;
  htmlUrl: string;
  title: string;
  state: string;
  headBranch: string;
  baseBranch: string;
}

function mapPullSummary(raw: {
  number?: number;
  html_url?: string;
  title?: string;
  state?: string;
  head?: { ref?: string };
  base?: { ref?: string };
}): GitHubPullSummary | null {
  if (!raw?.number) return null;
  return {
    number: raw.number,
    htmlUrl: raw.html_url || '',
    title: raw.title || `PR #${raw.number}`,
    state: raw.state || 'open',
    headBranch: raw.head?.ref || '',
    baseBranch: raw.base?.ref || '',
  };
}

/**
 * Finds a pull request whose head is `owner:headBranch`.
 * Tries open PRs first, then all states. Fail-closed 404 when none exist.
 */
export async function findPullRequestByHeadBranch(
  owner: string,
  repo: string,
  headBranch: string,
  token?: string | null,
  fetchFn: typeof fetch = fetch
): Promise<{ ok: true; pull: GitHubPullSummary } | { ok: false; status: number; error: string; prPending?: boolean }> {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim();
  const branch = headBranch.trim();
  if (!cleanOwner || !cleanRepo || !branch) {
    return { ok: false, status: 400, error: 'Repository owner, repo, and head branch are required.' };
  }

  const headers = githubRequestHeaders(token);
  const head = `${cleanOwner}:${branch}`;

  const list = async (state: 'open' | 'all') => {
    const url =
      `https://api.github.com/repos/${encodeURIComponent(cleanOwner)}/${encodeURIComponent(cleanRepo)}` +
      `/pulls?head=${encodeURIComponent(head)}&state=${state}&per_page=5`;
    const response = await fetchFn(url, { method: 'GET', headers, cache: 'no-store' });
    return response;
  };

  try {
    let response = await list('open');
    if (!response.ok && response.status !== 404) {
      const errBody = await response.text().catch(() => '');
      const isRateLimited = response.status === 403 && errBody.includes('API rate limit exceeded');
      return {
        ok: false,
        status: response.status,
        error: isRateLimited
          ? 'GitHub API rate limit reached. Please provide a GitHub Personal Access Token in API Settings.'
          : `Failed to look up pull requests from GitHub (${response.status})`,
      };
    }

    let rows = response.ok ? ((await response.json()) as unknown[]) : [];
    if (!Array.isArray(rows) || rows.length === 0) {
      response = await list('all');
      if (response.ok) {
        rows = (await response.json()) as unknown[];
      } else if (response.status !== 404) {
        return {
          ok: false,
          status: response.status,
          error: `Failed to look up pull requests from GitHub (${response.status})`,
        };
      } else {
        rows = [];
      }
    }

    const first = Array.isArray(rows) ? mapPullSummary(rows[0] as Parameters<typeof mapPullSummary>[0]) : null;
    if (!first) {
      return {
        ok: false,
        status: 404,
        prPending: true,
        error: `Jules has not opened a PR yet for branch "${branch}" on ${cleanOwner}/${cleanRepo}.`,
      };
    }
    return { ok: true, pull: first };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : 'Network error looking up GitHub pull request',
    };
  }
}
