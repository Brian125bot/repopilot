import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/jules/dispatch/route';
import { NextRequest } from 'next/server';

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

  it('enforces startingBranch resolution in remediation mode to target the audited branch', async () => {
    // Mock global fetch to handle both optional GitHub pre-check and Jules session dispatch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
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

    // Verify Jules dispatch payload
    const julesCall = fetchSpy.mock.calls.find(([callUrl]) =>
      String(callUrl).includes('jules.googleapis.com')
    );
    expect(julesCall).toBeDefined();
    const [, callOptions] = julesCall!;
    const dispatchedBody = JSON.parse(callOptions?.body as string);
    expect(dispatchedBody.sourceContext.githubRepoContext.startingBranch).toBe(
      'jules/pr-42-remediation-branch'
    );
    expect(dispatchedBody.title).toContain('[RepoPilot]');
    expect(dispatchedBody.requirePlanApproval).toBe(false);
    expect(dispatchedBody.automationMode).toBe('AUTO_CREATE_PR');
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
