import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/jules/session/route';
import {
  getJulesSession,
  harvestPullRequest,
} from '@/lib/jules';

describe('Jules session harvest (lib + GET /api/jules/session)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('harvestPullRequest extracts PR url/title from session outputs', () => {
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

  it('harvestPullRequest returns empty when no PR output exists', () => {
    expect(harvestPullRequest({ name: 'sessions/1', state: 'IN_PROGRESS' })).toEqual({});
  });

  it('getJulesSession reads state and harvests PR url via production function', async () => {
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

    const snapshot = await getJulesSession(
      'key',
      'sessions/session_77',
      fetchMock as unknown as typeof fetch
    );

    expect(snapshot.ok).toBe(true);
    expect(snapshot.state).toBe('COMPLETED');
    expect(snapshot.sessionUrl).toBe('https://jules.google.com/session/session_77');
    expect(snapshot.prUrl).toBe('https://github.com/acme-corp/api-gateway/pull/42');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jules.googleapis.com/v1alpha/sessions/session_77',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('GET returns 401 without an API key (fail-closed)', async () => {
    const original = process.env.JULES_API_KEY;
    delete process.env.JULES_API_KEY;
    try {
      const req = new NextRequest('http://localhost:3000/api/jules/session?id=sessions/abc');
      const res = await GET(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
    } finally {
      if (original !== undefined) process.env.JULES_API_KEY = original;
    }
  });

  it('GET returns 400 without an id', async () => {
    const req = new NextRequest('http://localhost:3000/api/jules/session', {
      headers: { 'x-jules-api-key': 'test-key' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Session ID');
  });

  it('GET harvests prUrl/sessionUrl/state from the Jules API', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
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
      } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/session?id=sessions/session_77', {
      headers: { 'x-jules-api-key': 'test-key' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sessionId).toBe('sessions/session_77');
    expect(data.state).toBe('COMPLETED');
    expect(data.sessionUrl).toBe('https://jules.google.com/session/session_77');
    expect(data.prUrl).toBe('https://github.com/acme-corp/api-gateway/pull/42');
    expect(data.prTitle).toBe('Add limiter');
  });

  it('GET passes through Jules 404 fail-closed (success:false)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'Session not found' } }),
      } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/session?id=sessions/missing', {
      headers: { 'x-jules-api-key': 'test-key' },
    });
    const res = await GET(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Session not found');
  });
});
