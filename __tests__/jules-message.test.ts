import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/jules/message/route';
import { sendJulesMessage } from '@/lib/jules';

describe('sendJulesMessage (lib/jules.ts, injected fetchFn)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs {prompt} to the official :sendMessage path', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    }) as typeof fetch;

    const result = await sendJulesMessage({
      apiKey: 'key',
      sessionId: 'sessions/session_9',
      prompt: 'Fix the TTL fallback',
      fetchFn: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://jules.googleapis.com/v1alpha/sessions/session_9:sendMessage');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ prompt: 'Fix the TTL fallback' });
    expect(result.sessionId).toBe('sessions/session_9');
    expect(result.sessionUrl).toContain('session_9');
  });

  it('strips the sessions/ prefix when already bare', async () => {
    const calls: string[] = [];
    const fetchMock = (async (input: unknown) => {
      calls.push(String(input));
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    }) as typeof fetch;

    await sendJulesMessage({ apiKey: 'key', sessionId: 'session_9', prompt: 'hi', fetchFn: fetchMock });

    expect(calls[0]).toBe('https://jules.googleapis.com/v1alpha/sessions/session_9:sendMessage');
  });

  it('fails closed with 401 and never calls fetch without a key', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const result = await sendJulesMessage({ apiKey: '  ', sessionId: 's', prompt: 'hi', fetchFn: fetchMock });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed with 400 without an id', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const result = await sendJulesMessage({ apiKey: 'key', sessionId: '  ', prompt: 'hi', fetchFn: fetchMock });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes Jules 404 through fail-closed', async () => {
    const fetchMock = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Session not found' } }),
    })) as unknown as typeof fetch;

    const result = await sendJulesMessage({
      apiKey: 'key',
      sessionId: 'sessions/missing',
      prompt: 'hi',
      fetchFn: fetchMock,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('Session not found');
  });
});

describe('POST /api/jules/message', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 without a key (fail-closed)', async () => {
    const original = process.env.JULES_API_KEY;
    delete process.env.JULES_API_KEY;
    try {
      const req = new NextRequest('http://localhost:3000/api/jules/message', {
        method: 'POST',
        body: JSON.stringify({ sessionId: 'sessions/s', prompt: 'hi' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      expect((await res.json()).success).toBe(false);
    } finally {
      if (original !== undefined) process.env.JULES_API_KEY = original;
    }
  });

  it('returns 400 without sessionId or prompt', async () => {
    for (const body of [{ prompt: 'hi' }, { sessionId: 'sessions/s' }, {}]) {
      const req = new NextRequest('http://localhost:3000/api/jules/message', {
        method: 'POST',
        headers: { 'x-jules-api-key': 'test-key' },
        body: JSON.stringify(body),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).success).toBe(false);
    }
  });

  it('returns success/sessionId on a mocked 200 send', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      expect(String(input)).toContain('/v1alpha/sessions/session_9:sendMessage');
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    });

    const req = new NextRequest('http://localhost:3000/api/jules/message', {
      method: 'POST',
      headers: { 'x-jules-api-key': 'test-key' },
      body: JSON.stringify({ sessionId: 'sessions/session_9', prompt: 'Fix it' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sessionId).toBe('sessions/session_9');
  });

  describe('COR-40 continuation SHA lock', () => {
    const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
    const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';

    function msgReq(body: unknown) {
      return new NextRequest('http://localhost:3000/api/jules/message', {
        method: 'POST',
        headers: { 'x-jules-api-key': 'test-key' },
        body: JSON.stringify(body),
      });
    }

    it('blocks remediation continuation when SHA is missing', async () => {
      const res = await POST(
        msgReq({
          sessionId: 'sessions/session_9',
          prompt: 'Fix it',
          isRemediation: true,
          auditedHeadSha: SHA,
        })
      );
      expect([400, 409]).toContain(res.status);
      expect(String((await res.json()).error || '')).toContain('Head moved since audit');
    });

    it('blocks remediation continuation when SHA mismatches', async () => {
      const res = await POST(
        msgReq({
          sessionId: 'sessions/session_9',
          prompt: 'Fix it',
          isRemediation: true,
          auditedHeadSha: SHA,
          currentHeadSha: OTHER,
        })
      );
      expect([400, 409]).toContain(res.status);
      expect(String((await res.json()).error || '')).toContain('Head moved since audit');
    });

    it('allows remediation continuation when SHA matches (case-insensitive)', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return { ok: true, status: 200, text: async () => '' } as unknown as Response;
      });
      const res = await POST(
        msgReq({
          sessionId: 'sessions/session_9',
          prompt: 'Fix it',
          isRemediation: true,
          auditedHeadSha: SHA,
          currentHeadSha: SHA.toUpperCase(),
        })
      );
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });
  });
});
