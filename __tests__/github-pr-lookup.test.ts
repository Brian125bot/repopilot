import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findPullRequestByHeadBranch,
  parseAuditIngestTarget,
  parseGitHubPRUrl,
  parseOwnerRepo,
} from '@/lib/github';

describe('GitHub PR ingest parsers', () => {
  it('parses canonical PR URLs and owner/repo#n', () => {
    expect(parseGitHubPRUrl('https://github.com/acme-corp/api-gateway/pull/42')).toEqual({
      owner: 'acme-corp',
      repo: 'api-gateway',
      pullNumber: 42,
    });
    expect(parseGitHubPRUrl('acme-corp/api-gateway#7')).toEqual({
      owner: 'acme-corp',
      repo: 'api-gateway',
      pullNumber: 7,
    });
  });

  it('treats owner/repo (branch) and owner/repo#branch as branch targets', () => {
    expect(parseAuditIngestTarget('acme-corp/api-gateway (jules/rate-limiter)')).toEqual({
      kind: 'branch',
      owner: 'acme-corp',
      repo: 'api-gateway',
      headBranch: 'jules/rate-limiter',
    });
    expect(parseAuditIngestTarget('acme-corp/api-gateway#jules/rate-limiter')).toEqual({
      kind: 'branch',
      owner: 'acme-corp',
      repo: 'api-gateway',
      headBranch: 'jules/rate-limiter',
    });
    expect(parseAuditIngestTarget('https://github.com/acme-corp/api-gateway/pull/42').kind).toBe(
      'pr'
    );
  });

  it('parses owner/repo slugs', () => {
    expect(parseOwnerRepo('https://github.com/Acme-Corp/api-gateway.git')).toEqual({
      owner: 'Acme-Corp',
      repo: 'api-gateway',
    });
  });
});

describe('findPullRequestByHeadBranch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the open PR whose head matches owner:branch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          number: 42,
          html_url: 'https://github.com/acme-corp/api-gateway/pull/42',
          title: 'Add limiter',
          state: 'open',
          head: { ref: 'jules/rate-limiter' },
          base: { ref: 'main' },
        },
      ],
    });

    const result = await findPullRequestByHeadBranch(
      'acme-corp',
      'api-gateway',
      'jules/rate-limiter',
      'ghp_test',
      fetchMock as unknown as typeof fetch
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pull.number).toBe(42);
      expect(result.pull.headBranch).toBe('jules/rate-limiter');
    }
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/repos/acme-corp/api-gateway/pulls');
    expect(calledUrl).toContain(encodeURIComponent('acme-corp:jules/rate-limiter'));
    expect(calledUrl).toContain('state=open');
  });

  it('falls back to state=all then reports prPending when no PR exists', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => {
          if (url.includes('state=all')) return [];
          return [];
        },
      };
    });

    const result = await findPullRequestByHeadBranch(
      'acme-corp',
      'api-gateway',
      'jules/missing',
      null,
      fetchMock as unknown as typeof fetch
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.prPending).toBe(true);
      expect(result.error).toMatch(/has not opened a PR yet/i);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
