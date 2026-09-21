// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanRepository } from './scan';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('scanRepository', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('performs 4-stage scan successfully', async () => {
    // Stage 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: 'main', description: 'Test desc' })
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ TypeScript: 1000 })
    });

    // Stage 2
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
         content: Buffer.from(JSON.stringify({ name: 'test-app', dependencies: { react: '18' }, scripts: { build: 'tsc' } })).toString('base64')
      })
    });

    // Stage 3
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { commit: { message: 'feat(ui): add button' } },
        { commit: { message: 'fix: bug' } }
      ])
    });

    // Stage 4
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tree: [
          { path: '.eslintrc.json' },
          { path: 'biome.json' }
        ]
      })
    });

    const profile = await scanRepository({ owner: 'foo', repo: 'bar' }, { githubPat: 'fake' });

    expect(profile.incomplete).toBeUndefined();
    expect(profile.repoRef.owner).toBe('foo');
    expect(profile.repoRef.defaultBranch).toBe('main');
    expect(profile.notes).toBe('Test desc');
    expect(profile.stack.languages).toEqual(['TypeScript']);
    expect(profile.stack.framework).toBe('react');

    expect(profile.conventions).toContainEqual(expect.objectContaining({ id: 'manifest' }));
    expect(profile.conventions).toContainEqual(expect.objectContaining({ id: 'commits' }));
    expect(profile.conventions).toContainEqual(expect.objectContaining({ id: 'lint-format' }));
  });

  it('handles partial failures cleanly (fail-soft)', async () => {
    // Stage 1
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Stage 2
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Stage 3
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Stage 4
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const profile = await scanRepository({ owner: 'foo', repo: 'bar' }, { githubPat: 'fake' });

    expect(profile.incomplete).toBeUndefined(); // we didn't abort, just failed endpoints
    expect(profile.repoRef.owner).toBe('foo');
    expect(profile.conventions).toHaveLength(0);
  });

  it('aborts mid-scan and returns incomplete profile', async () => {
    // Stage 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: 'main', description: 'Test desc' })
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ TypeScript: 1000 })
    });

    // Stage 2 mock that triggers the abort signal
    mockFetch.mockImplementationOnce(() => {
        throw new Error('AbortError');
    });

    const ac = new AbortController();

    const promise = scanRepository({ owner: 'foo', repo: 'bar' }, { githubPat: 'fake', signal: ac.signal });
    ac.abort();

    const profile = await promise;
    expect(profile.incomplete).toBe(true);
    expect(profile.repoRef.defaultBranch).toBe('main'); // Captured before abort
  });

  it('handles rate-limit (403) with exponential backoff', async () => {
    mockFetch.mockResolvedValueOnce({
       ok: false,
       status: 403,
       headers: new Headers({ 'x-ratelimit-reset': ((Date.now() + 500) / 1000).toString() })
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: 'main', description: 'Test desc' })
    });
    // Let rest fail 404 to avoid setting up every mock
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const profile = await scanRepository({ owner: 'foo', repo: 'bar' }, { githubPat: 'fake' });

    expect(mockFetch).toHaveBeenCalledTimes(6); // 1 for retry, 1 for success, +4 for rest of endpoints
    expect(profile.repoRef.defaultBranch).toBe('main');
  });
});
