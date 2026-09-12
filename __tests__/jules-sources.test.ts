import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/jules/sources/route';
import { listJulesSources, sanitizeJulesCredential } from '@/lib/jules';

vi.mock('@/lib/jules', () => ({
  listJulesSources: vi.fn(),
  sanitizeJulesCredential: vi.fn(),
}));

describe('GET /api/jules/sources', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.JULES_API_KEY = 'server-key';
  });

  it('returns 200 with sources when a valid key is provided', async () => {
    vi.mocked(sanitizeJulesCredential).mockReturnValue('valid-key');
    vi.mocked(listJulesSources).mockResolvedValue({
      ok: true,
      sources: [{ name: 'workspaces/1', displayName: 'Workspace 1' } as any],
      truncated: false,
    });

    const req = new NextRequest('http://localhost:3000/api/jules/sources', {
      headers: { 'x-jules-api-key': 'header-key' }
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.configured).toBe(true);
    expect(data.valid).toBe(true);
    expect(data.sources).toHaveLength(1);
    expect(listJulesSources).toHaveBeenCalledWith('valid-key');
  });

  it('returns configured: false when no key is provided', async () => {
    vi.mocked(sanitizeJulesCredential).mockReturnValue('');

    const req = new NextRequest('http://localhost:3000/api/jules/sources');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.configured).toBe(false);
    expect(data.valid).toBe(false);
    expect(data.message).toContain('No Google Jules API key');
    expect(listJulesSources).not.toHaveBeenCalled();
  });

  it('returns valid: false when listJulesSources fails gracefully (e.g., 401)', async () => {
    vi.mocked(sanitizeJulesCredential).mockReturnValue('bad-key');
    vi.mocked(listJulesSources).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });

    const req = new NextRequest('http://localhost:3000/api/jules/sources');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.configured).toBe(true);
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 500 when listJulesSources throws a network error', async () => {
    vi.mocked(sanitizeJulesCredential).mockReturnValue('key');
    vi.mocked(listJulesSources).mockRejectedValue(new Error('Network disconnected'));

    const req = new NextRequest('http://localhost:3000/api/jules/sources');
    const res = await GET(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Network disconnected');
    expect(data.valid).toBe(false);
  });
});
