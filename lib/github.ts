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
          'User-Agent': 'RepoPilot-PAT-Validator',
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
        'User-Agent': 'RepoPilot-PAT-Validator',
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
