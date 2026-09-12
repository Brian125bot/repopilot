import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/repo/inspect/route';

describe('POST /api/repo/inspect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with inspected repo context', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'repo', default_branch: 'main', private: false }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { name: 'package.json', type: 'file' },
          { name: 'src', type: 'dir' }
        ]),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: Buffer.from(JSON.stringify({ dependencies: { react: '1' } })).toString('base64'), encoding: 'base64' }),
      } as any);

    const req = new NextRequest('http://localhost:3000/api/repo/inspect', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isReachable).toBe(true);
    expect(data.keyFiles.hasPackageJson).toBe(true);
    expect(data.keyFiles.dependenciesSummary).toContain('react');
    expect(data.treePreview).toContain('src/');
  });

  it('returns 400 for invalid repo format', async () => {
    const req = new NextRequest('http://localhost:3000/api/repo/inspect', {
      method: 'POST',
      body: JSON.stringify({ repo: 'invalid' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('handles 403 rate limit by returning fallback with error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
      json: async () => ({ message: 'API rate limit exceeded' }),
    } as any);

    const req = new NextRequest('http://localhost:3000/api/repo/inspect', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200); // Route returns a 200 with fallback data
    const data = await res.json();
    expect(data.isReachable).toBe(false);
    expect(data.error).toContain('rate limit exceeded');
  });

  it('returns 500 when fetch throws a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'));

    const req = new NextRequest('http://localhost:3000/api/repo/inspect', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Network failure');
  });
});
