import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyMergeReadinessCap,
  fetchPullRequestChecks,
  fetchPullRequestMergeability,
} from '@/lib/github';
import { POST as fetchDiffPOST } from '@/app/api/audit/fetch-diff/route';
import { NextRequest } from 'next/server';

describe('fetchPullRequestChecks rollup', () => {
  const runs = (check_runs: unknown[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ check_runs }),
  });

  it('returns SUCCESS when all runs conclude successfully', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url: string }).url);
      if (url.includes('/check-runs')) {
        return runs([
          { name: 'ci', status: 'completed', conclusion: 'success', details_url: 'https://ci/1' },
        ]) as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ state: 'success', statuses: [] }) } as unknown as Response;
    });
    const out = await fetchPullRequestChecks('a', 'b', 'sha123', null, fetchMock as unknown as typeof fetch);
    expect(out.state).toBe('SUCCESS');
    expect(out.checkRuns).toHaveLength(1);
    expect(out.checkRuns[0].detailsUrl).toBe('https://ci/1');
  });

  it('returns FAILURE on any failed conclusion or combined failure state', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure', details_url: '' }],
      }),
    }) as unknown as Response);
    const out = await fetchPullRequestChecks('a', 'b', 'sha', null, fetchMock as unknown as typeof fetch);
    expect(out.state).toBe('FAILURE');
  });

  it('returns PENDING while runs are in progress', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url: string }).url);
      if (url.includes('/check-runs')) {
        return runs([{ name: 'ci', status: 'in_progress', conclusion: null }]) as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ state: 'pending', statuses: [] }) } as unknown as Response;
    });
    const out = await fetchPullRequestChecks('a', 'b', 'sha', null, fetchMock as unknown as typeof fetch);
    expect(out.state).toBe('PENDING');
  });

  it('degrades to PENDING with empty runs on transport failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const out = await fetchPullRequestChecks('a', 'b', 'sha', null, fetchMock as unknown as typeof fetch);
    expect(out).toEqual({ state: 'PENDING', checkRuns: [] });
  });
});

describe('fetchPullRequestMergeability', () => {
  it('extracts mergeable + mergeable_state, preserving null while GitHub computes', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mergeable: null, mergeable_state: 'unknown' }),
    }) as unknown as Response);
    expect(await fetchPullRequestMergeability('a', 'b', 7, null, fetchMock as unknown as typeof fetch)).toEqual({
      mergeable: null,
      mergeableState: 'unknown',
    });
  });

  it('returns unknown on API failure without throwing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response);
    expect(await fetchPullRequestMergeability('a', 'b', 7, null, fetchMock as unknown as typeof fetch)).toEqual({
      mergeable: null,
      mergeableState: 'unknown',
    });
  });
});

describe('applyMergeReadinessCap', () => {
  it('leaves non-READY verdicts untouched', () => {
    expect(
      applyMergeReadinessCap('BLOCKED', { mergeable: false, mergeableState: 'dirty', checksState: 'FAILURE', failedChecks: ['ci'] }, 3)
    ).toEqual({ verdict: 'BLOCKED', reasons: [] });
  });

  it('keeps READY when GitHub is clean', () => {
    expect(
      applyMergeReadinessCap('READY_TO_MERGE', { mergeable: true, mergeableState: 'clean', checksState: 'SUCCESS', failedChecks: [] }, 0)
    ).toEqual({ verdict: 'READY_TO_MERGE', reasons: [] });
  });

  it('demotes READY on conflicts, failing checks, and boundary breaches', () => {
    const out = applyMergeReadinessCap(
      'READY_TO_MERGE',
      { mergeable: false, mergeableState: 'dirty', checksState: 'FAILURE', failedChecks: ['ci', 'lint'] },
      2
    );
    expect(out.verdict).toBe('NEEDS_REVISION');
    expect(out.reasons.join(' ')).toMatch(/conflict/i);
    expect(out.reasons.join(' ')).toContain('ci');
    expect(out.reasons.join(' ')).toMatch(/out-of-scope/);
  });

  it('never blocks on unknown status', () => {
    expect(applyMergeReadinessCap('READY_TO_MERGE', null, 0).verdict).toBe('READY_TO_MERGE');
    expect(
      applyMergeReadinessCap(
        'READY_TO_MERGE',
        { mergeable: null, mergeableState: 'unknown', checksState: 'PENDING', failedChecks: [] },
        0
      ).verdict
    ).toBe('READY_TO_MERGE');
  });
});

describe('fetch-diff githubStatus payload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockGitHub() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      const accept = (init?.headers as Record<string, string> | undefined)?.Accept || '';
      if (url.includes('/check-runs')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure', details_url: 'https://ci/run/9' }],
          }),
        } as unknown as Response;
      }
      if (url.includes('/commits/') && url.endsWith('/status')) {
        return { ok: true, status: 200, json: async () => ({ state: 'failure', statuses: [] }) } as unknown as Response;
      }
      if (url.endsWith('/pulls/42')) {
        if (String(accept).includes('diff')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 42,
            title: 'Test PR',
            state: 'open',
            user: { login: 'octo' },
            html_url: 'https://github.com/acme/api/pull/42',
            base: { ref: 'main' },
            head: { ref: 'feat', sha: 'deadbeef' },
            body: '',
            mergeable: false,
            mergeable_state: 'dirty',
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });
  }

  it('attaches githubStatus with failing checks and dirty state', async () => {
    mockGitHub();
    const req = new NextRequest('http://localhost:3000/api/audit/fetch-diff', {
      method: 'POST',
      body: JSON.stringify({ prUrl: 'https://github.com/acme/api/pull/42', fileBoundaries: ['src/**'] }),
    });
    const res = await fetchDiffPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.githubStatus.checksState).toBe('FAILURE');
    expect(data.githubStatus.failedChecks).toEqual(['ci']);
    expect(data.githubStatus.checkRunUrls).toEqual([{ name: 'ci', detailsUrl: 'https://ci/run/9' }]);
    expect(data.githubStatus.mergeable).toBe(false);
    expect(data.githubStatus.mergeableState).toBe('dirty');
    expect(data.pr.githubStatus.checksState).toBe('FAILURE');
  });

  it('returns null githubStatus for manual diffs', async () => {
    const req = new NextRequest('http://localhost:3000/api/audit/fetch-diff', {
      method: 'POST',
      body: JSON.stringify({
        rawDiff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
        fileBoundaries: [],
      }),
    });
    const res = await fetchDiffPOST(req);
    const data = await res.json();
    expect(data.githubStatus).toBeNull();
  });
});