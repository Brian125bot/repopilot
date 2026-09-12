import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/jules/dispatch/route';
import { NextRequest } from 'next/server';
import {
  findJulesSource,
  getJulesSession,
  harvestPullRequest,
  resolveAutomationMode,
  createJulesSession,
} from '@/lib/jules';

describe('/api/jules/dispatch Route & Jules API Contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid repository format with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'invalid-repo-format',
        objective: 'Test objective',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid repository');
  });

  it('rejects missing objective with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'acme-corp/api-gateway',
        objective: '',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Objective and task description is required');
  });

  it('creates blueprint and simulates session in dryRun mode without calling external API', async () => {
    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'https://github.com/acme-corp/api-gateway.git',
        baseBranch: 'main',
        branchName: 'jules/test-branch',
        fileBoundaries: ['src/index.ts'],
        objective: 'Implement dry run test',
        criteria: [{ id: '1', text: 'Working dry run', category: 'functional' }],
        dryRun: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.dryRun).toBe(true);
    expect(data.blueprint).toBeDefined();
    expect(data.blueprint.repo).toBe('acme-corp/api-gateway');
    expect(data.blueprint.branchName).toBe('jules/test-branch');
    expect(data.sessionId).toBeDefined();
    expect(data.sessionId).toContain('sess_');
  });

  it('enforces startingBranch resolution and non-PR automation in remediation mode', async () => {
    // Mock global fetch to handle both optional GitHub pre-check and Jules session dispatch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('/v1alpha/sources')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                name: 'sources/github/acme-corp-api-gateway',
                id: 'github/acme-corp/api-gateway',
                githubRepo: { owner: 'acme-corp', repo: 'api-gateway', defaultBranch: { displayName: 'main' } },
              },
            ],
          }),
        } as unknown as Response;
      }
      if (url.includes('jules.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: 'sessions/session_rem_12345', state: 'ACTIVE' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ full_name: 'acme-corp/api-gateway' }),
      } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      headers: {
        'x-jules-api-key': 'test-jules-key-12345',
      },
      body: JSON.stringify({
        repo: 'acme-corp/api-gateway',
        baseBranch: 'main',
        branchName: 'jules/pr-42-remediation-branch',
        startingBranch: 'jules/pr-42-remediation-branch',
        isRemediation: true,
        prNumber: 42,
        prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
        objective: 'Fix rate limiter test',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.targetBranch).toBe('jules/pr-42-remediation-branch');

    // Verify Jules dispatch payload (sessions call, not the sources binding call)
    const julesCall = fetchSpy.mock.calls.find(([callUrl]) =>
      String(callUrl).includes('/v1alpha/sessions')
    );
    expect(julesCall).toBeDefined();
    const [, callOptions] = julesCall!;
    const dispatchedBody = JSON.parse(callOptions?.body as string);
    expect(dispatchedBody.sourceContext.githubRepoContext.startingBranch).toBe(
      'jules/pr-42-remediation-branch'
    );
    expect(dispatchedBody.title).toContain('[RepoPilot]');
    expect(dispatchedBody.requirePlanApproval).toBe(false);
    // Remediation omits automationMode; it must not request AUTO_CREATE_PR.
    expect('automationMode' in dispatchedBody).toBe(false);
    // sourceContext.source must be the real sources[].name, never a synthesized path.
    expect(dispatchedBody.sourceContext.source).toBe('sources/github/acme-corp-api-gateway');
    expect(data.blueprint.sourceName).toBe('sources/github/acme-corp-api-gateway');
    expect(data.blueprint.isRemediation).toBe(true);
  });

  it('requests AUTO_CREATE_PR only for first-pass (non-remediation) dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('/v1alpha/sources')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                name: 'sources/src_9988',
                id: 'src_9988',
                githubRepo: { owner: 'acme-corp', repo: 'api-gateway', defaultBranch: { displayName: 'main' } },
              },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: 'sessions/session_new_1', state: 'QUEUED' }),
      } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      headers: { 'x-jules-api-key': 'test-jules-key-12345' },
      body: JSON.stringify({
        repo: 'acme-corp/api-gateway',
        baseBranch: 'main',
        branchName: 'jules/rate-limiter',
        objective: 'Implement rate limiter',
        criteria: [{ id: '1', text: 'Works', category: 'functional' }],
        dryRun: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.blueprint.isRemediation).toBe(false);
    expect(data.blueprint.sessionUrl).toContain('session_new_1');
    expect(data.blueprint.sessionState).toBe('QUEUED');

    const sessionCall = fetchSpy.mock.calls.find(([callUrl]) =>
      String(callUrl).includes('/v1alpha/sessions')
    );
    expect(sessionCall).toBeDefined();
    const [, sessionOptions] = sessionCall!;
    const sessionBody = JSON.parse(sessionOptions?.body as string);
    expect(sessionBody.automationMode).toBe('AUTO_CREATE_PR');
    expect(sessionBody.title).toContain('[RepoPilot]');
    expect(sessionBody.requirePlanApproval).toBe(false);
    expect(sessionBody.sourceContext.source).toBe('sources/src_9988');
  });

  it('carries sourceName/sessionUrl/sessionState on the dispatch blueprint (honest empty PR)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('/v1alpha/sources')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                name: 'sources/src_9988',
                githubRepo: { owner: 'acme-corp', repo: 'api-gateway' },
              },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: 'sessions/session_new_9', state: 'QUEUED' }),
      } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      headers: { 'x-jules-api-key': 'test-key' },
      body: JSON.stringify({
        repo: 'acme-corp/api-gateway',
        branchName: 'jules/harvest-check',
        objective: 'Check blueprint session fields',
        criteria: [{ id: '1', text: 'Works', category: 'functional' }],
        dryRun: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sessionUrl).toContain('session_new_9');
    expect(data.blueprint.sourceName).toBe('sources/src_9988');
    expect(data.blueprint.sessionUrl).toContain('session_new_9');
    expect(data.blueprint.sessionState).toBe('QUEUED');
    // No PR harvested at dispatch time — harvest happens via GET /api/jules/session.
    expect(data.blueprint.prUrl ?? undefined).toBeUndefined();
  });

  it('fails closed when the repository is absent from GET /v1alpha/sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('/v1alpha/sources')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sources: [{ name: 'sources/src_other', githubRepo: { owner: 'other', repo: 'svc' } }] }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      headers: { 'x-jules-api-key': 'valid-key' },
      body: JSON.stringify({
        repo: 'acme-corp/api-gateway',
        objective: 'Dispatch to an unconnected repo',
        criteria: [{ id: '1', text: 'Test criterion' }],
        dryRun: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Source not connected in Jules');
  });

  it('fails closed when dispatching live without an API key (returns 401, success: false)', async () => {
    const originalEnv = process.env.JULES_API_KEY;
    delete process.env.JULES_API_KEY;

    try {
      const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'acme-corp/api-gateway',
          objective: 'Live dispatch without key',
          criteria: [{ id: '1', text: 'Test criterion' }],
          dryRun: false,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('No Google Jules API key');
    } finally {
      if (originalEnv !== undefined) {
        process.env.JULES_API_KEY = originalEnv;
      }
    }
  });

  it('fails closed on Jules 401 Unauthorized (returns 401, success: false)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('jules.googleapis.com')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: { message: 'Invalid API Key provided' } }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      headers: {
        'x-jules-api-key': 'bad-key',
      },
      body: JSON.stringify({
        repo: 'acme-corp/api-gateway',
        objective: 'Test 401 rejection',
        criteria: [{ id: '1', text: 'Test criterion' }],
        dryRun: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid API Key provided');
  });

  it('fails closed on Jules 404 Source Not Found (returns 404, success: false)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('jules.googleapis.com')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Source repository not found in Jules organization' } }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
      method: 'POST',
      headers: {
        'x-jules-api-key': 'valid-key',
      },
      body: JSON.stringify({
        repo: 'acme-corp/unknown-service',
        objective: 'Test 404 rejection',
        criteria: [{ id: '1', text: 'Test criterion' }],
        dryRun: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Source repository not found');
  });
});

describe('Jules client library (lib/jules.ts)', () => {
  describe('resolveAutomationMode', () => {
    it('omits automationMode during remediation', () => {
      expect(resolveAutomationMode(true)).toBeUndefined();
    });

    it('auto-creates a PR on the first pass', () => {
      expect(resolveAutomationMode(false)).toBe('AUTO_CREATE_PR');
    });

    it('pairs automationMode with source binding across remediation and first-pass', async () => {
      const bodies: Array<{ url: string; body: unknown }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as { url: string }).url;
        if (url.includes('/v1alpha/sources')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sources: [{ name: 'sources/src_pair', githubRepo: { owner: 'acme-corp', repo: 'api-gateway' } }],
            }),
          } as unknown as Response;
        }
        if (url.includes('/v1alpha/sessions')) {
          bodies.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
          return {
            ok: true,
            status: 200,
            json: async () => ({ name: 'sessions/s_pair', state: 'QUEUED' }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      });

      const firstPass = new NextRequest('http://localhost:3000/api/jules/dispatch', {
        method: 'POST',
        headers: { 'x-jules-api-key': 'k' },
        body: JSON.stringify({
          repo: 'acme-corp/api-gateway',
          branchName: 'jules/pair-first',
          objective: 'First pass',
          criteria: [{ id: '1', text: 'Works', category: 'functional' }],
        }),
      });
      const remediation = new NextRequest('http://localhost:3000/api/jules/dispatch', {
        method: 'POST',
        headers: { 'x-jules-api-key': 'k' },
        body: JSON.stringify({
          repo: 'acme-corp/api-gateway',
          branchName: 'jules/pair-fix',
          startingBranch: 'jules/pair-fix',
          isRemediation: true,
          objective: 'Fix',
          criteria: [{ id: '1', text: 'Fix', category: 'functional' }],
        }),
      });

      await POST(firstPass);
      await POST(remediation);

      expect(bodies).toHaveLength(2);
      expect((bodies[0].body as { automationMode?: string }).automationMode).toBe('AUTO_CREATE_PR');
      expect('automationMode' in (bodies[1].body as Record<string, unknown>)).toBe(false);
      for (const b of bodies) {
        expect((b.body as { sourceContext: { source: string } }).sourceContext.source).toBe('sources/src_pair');
      }
    });
  });

  describe('findJulesSource', () => {
    const sources = [
      {
        name: 'sources/src_abc',
        id: 'src_abc',
        githubRepo: { owner: 'acme-corp', repo: 'api-gateway' },
      },
      {
        name: 'sources/github/other-org/tooling',
        id: 'github/other-org/tooling',
      },
      {
        name: 'sources/id-only-match',
        id: 'acme-corp/id-repo',
      },
    ];

    it('matches on githubRepo.owner/repo regardless of case or URL form', () => {
      expect(findJulesSource(sources, 'acme-corp/api-gateway')?.name).toBe('sources/src_abc');
      expect(findJulesSource(sources, 'https://github.com/Acme-Corp/API-Gateway.git')?.name).toBe(
        'sources/src_abc'
      );
    });

    it('falls back to the sources/github/owner-repo name suffix', () => {
      expect(findJulesSource(sources, 'other-org/tooling')?.name).toBe(
        'sources/github/other-org/tooling'
      );
    });

    it('returns null for unconnected repositories', () => {
      expect(findJulesSource(sources, 'acme-corp/nope')).toBeNull();
      expect(findJulesSource([], 'acme-corp/api-gateway')).toBeNull();
    });

    it('matches on id when githubRepo is absent', () => {
      expect(findJulesSource(sources, 'acme-corp/id-repo')?.name).toBe('sources/id-only-match');
    });
  });

  describe('createJulesSession', () => {
    it('returns exact 404 without a bound source', async () => {
      const result = await createJulesSession({
        apiKey: 'key',
        sourceName: '',
        startingBranch: 'main',
        prompt: 'do work',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toBe('Source not connected in Jules');
    });

    it('binds repo via injected fetchFn on one mock surface', async () => {
      const calls: string[] = [];
      const fetchMock = (async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as { url: string }).url;
        calls.push(url);
        if (url.includes('/v1alpha/sources')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sources: [{ name: 'sources/injected-1', githubRepo: { owner: 'acme-corp', repo: 'api-gateway' } }],
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: 'sessions/s_injected', state: 'QUEUED' }),
        } as unknown as Response;
      }) as typeof fetch;

      const result = await createJulesSession({
        apiKey: 'key',
        repo: 'acme-corp/api-gateway',
        startingBranch: 'main',
        prompt: 'do work',
        title: '[RepoPilot] test',
        requirePlanApproval: false,
        automationMode: 'AUTO_CREATE_PR',
        fetchFn: fetchMock,
      });

      expect(result.ok).toBe(true);
      expect(calls.some((u) => u.includes('/v1alpha/sources'))).toBe(true);
      expect(calls.some((u) => u.includes('/v1alpha/sessions'))).toBe(true);
    });

    it('skips the sources call when sourceName is already given', async () => {
      let sourcesCalls = 0;
      const fetchMock = (async (input: unknown) => {
        const url = typeof input === 'string' ? input : (input as { url: string }).url;
        if (url.includes('/v1alpha/sources')) sourcesCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: 'sessions/s_direct', state: 'QUEUED' }),
        } as unknown as Response;
      }) as typeof fetch;

      const result = await createJulesSession({
        apiKey: 'key',
        sourceName: 'sources/direct',
        startingBranch: 'main',
        prompt: 'do work',
        fetchFn: fetchMock,
      });

      expect(result.ok).toBe(true);
      expect(sourcesCalls).toBe(0);
    });

    it('returns exact 404 for an unlisted repo via fetchFn', async () => {
      const fetchMock = (async (input: unknown) => {
        const url = typeof input === 'string' ? input : (input as { url: string }).url;
        if (url.includes('/v1alpha/sources')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sources: [] }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }) as typeof fetch;

      const result = await createJulesSession({
        apiKey: 'key',
        repo: 'acme-corp/nope',
        startingBranch: 'main',
        prompt: 'do work',
        fetchFn: fetchMock,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toBe('Source not connected in Jules');
    });
  });

  describe('harvestPullRequest', () => {
    it('extracts the pull request output from a session', () => {
      const session = {
        name: 'sessions/123',
        state: 'COMPLETED',
        outputs: [
          { pullRequest: { url: 'https://github.com/acme-corp/api-gateway/pull/42', title: 'Add limiter' } },
        ],
      };

      expect(harvestPullRequest(session)).toEqual({
        url: 'https://github.com/acme-corp/api-gateway/pull/42',
        title: 'Add limiter',
      });
    });

    it('returns empty when no pull request output exists yet', () => {
      expect(harvestPullRequest({ name: 'sessions/1', state: 'IN_PROGRESS' })).toEqual({});
      expect(harvestPullRequest({ outputs: [{}] } as Record<string, unknown>)).toEqual({});
    });
  });

  describe('getJulesSession', () => {
    it('reads session state and harvests the PR url', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'sessions/session_77',
          state: 'COMPLETED',
          url: 'https://jules.google.com/session/session_77',
          outputs: [
            { pullRequest: { url: 'https://github.com/acme-corp/api-gateway/pull/42', title: 'Add limiter' } },
          ],
        }),
      });

      const snapshot = await getJulesSession('key', 'sessions/session_77', fetchMock as unknown as typeof fetch);

      expect(snapshot.ok).toBe(true);
      expect(snapshot.state).toBe('COMPLETED');
      expect(snapshot.sessionUrl).toBe('https://jules.google.com/session/session_77');
      expect(snapshot.prUrl).toBe('https://github.com/acme-corp/api-gateway/pull/42');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://jules.googleapis.com/v1alpha/sessions/session_77',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('fails closed with 401 on an invalid key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API Key provided' } }),
      });

      const snapshot = await getJulesSession('bad', 'session_77', fetchMock as unknown as typeof fetch);

      expect(snapshot.ok).toBe(false);
      expect(snapshot.status).toBe(401);
      expect(snapshot.error).toContain('Invalid API Key provided');
    });
  });
});
