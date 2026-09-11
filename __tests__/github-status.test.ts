import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateGitHubToken } from '@/lib/github';
import { GET, POST } from '@/app/api/github/status/route';
import { NextRequest } from 'next/server';

describe('GitHub PAT Validation Engine (lib/github.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles unauthenticated probe when no token is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        resources: {
          core: {
            limit: 60,
            remaining: 45,
            reset: 1700000000,
          },
        },
      }),
    });

    const result = await validateGitHubToken('', mockFetch as unknown as typeof fetch);
    expect(result.status).toBe('none');
    expect(result.isValid).toBe(false);
    expect(result.rateLimit?.limit).toBe(60);
    expect(result.rateLimit?.remaining).toBe(45);
  });

  it('validates a correct GitHub Personal Access Token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'x-oauth-scopes': 'repo, read:org, workflow',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4982',
        'x-ratelimit-reset': '1700003600',
      }),
      json: async () => ({
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/583231',
        html_url: 'https://github.com/octocat',
        type: 'User',
      }),
    });

    const result = await validateGitHubToken('ghp_validToken12345', mockFetch as unknown as typeof fetch);

    expect(result.status).toBe('valid');
    expect(result.isValid).toBe(true);
    expect(result.login).toBe('octocat');
    expect(result.user?.name).toBe('The Octocat');
    expect(result.scopes).toEqual(['repo', 'read:org', 'workflow']);
    expect(result.rateLimit?.limit).toBe(5000);
    expect(result.rateLimit?.remaining).toBe(4982);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token ghp_validToken12345',
        }),
      })
    );
  });

  it('detects and flags invalid or expired PAT with status 401', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({
        message: 'Bad credentials',
        documentation_url: 'https://docs.github.com/rest',
      }),
    });

    const result = await validateGitHubToken('ghp_expiredOrBadToken', mockFetch as unknown as typeof fetch);

    expect(result.status).toBe('invalid');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Bad credentials');
  });

  it('detects rate limiting (403 with 0 remaining)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '60',
      }),
      json: async () => ({
        message: 'API rate limit exceeded',
      }),
    });

    const result = await validateGitHubToken('ghp_rateLimitedToken', mockFetch as unknown as typeof fetch);

    expect(result.status).toBe('rate_limited');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('rate limit');
  });

  it('handles network exceptions gracefully and fails closed', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT connecting to api.github.com'));

    const result = await validateGitHubToken('ghp_someToken', mockFetch as unknown as typeof fetch);

    expect(result.status).toBe('error');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('ETIMEDOUT');
  });
});

describe('/api/github/status Route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET returns status using x-github-pat header', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/user')) {
        return new Response(
          JSON.stringify({
            login: 'dev-user',
            avatar_url: 'https://github.com/images/dev.png',
          }),
          {
            status: 200,
            headers: {
              'x-oauth-scopes': 'repo',
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '4990',
            },
          }
        );
      }
      return new Response('{}', { status: 404 });
    });

    const req = new NextRequest('http://localhost:3000/api/github/status', {
      method: 'GET',
      headers: {
        'x-github-pat': 'ghp_customClientPat',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isValid).toBe(true);
    expect(data.login).toBe('dev-user');
    expect(data.source).toBe('user');
  });

  it('POST returns status from JSON body token', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          login: 'post-user',
        }),
        {
          status: 200,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '5000',
          },
        }
      );
    });

    const req = new NextRequest('http://localhost:3000/api/github/status', {
      method: 'POST',
      body: JSON.stringify({ pat: 'ghp_bodyToken' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isValid).toBe(true);
    expect(data.login).toBe('post-user');
  });
});
