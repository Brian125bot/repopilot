import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/criteria/generate/route';
import { generateAcceptanceCriteria } from '@/lib/gemini';

vi.mock('@/lib/gemini', () => ({
  generateAcceptanceCriteria: vi.fn(),
}));

describe('POST /api/criteria/generate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 and calls generateAcceptanceCriteria with valid payload', async () => {
    const mockResult = { criteria: [{ id: '1', text: 'test', category: 'functional', rationale: 'why' }] };
    vi.mocked(generateAcceptanceCriteria).mockResolvedValue(mockResult as any);

    const req = new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'owner/repo',
        objective: 'Implement a new feature with long enough description',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockResult);
    expect(generateAcceptanceCriteria).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'owner/repo', objective: 'Implement a new feature with long enough description' })
    );
  });

  it('returns 400 for invalid repo format', async () => {
    const req = new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'invalid-repo',
        objective: 'Implement a new feature with long enough description',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Valid repository');
  });

  it('returns 400 for short objective', async () => {
    const req = new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'owner/repo',
        objective: 'short',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Please provide a descriptive task objective');
  });

  it('returns 500 when generateAcceptanceCriteria throws', async () => {
    vi.mocked(generateAcceptanceCriteria).mockRejectedValue(new Error('Gemini failed'));

    const req = new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      body: JSON.stringify({
        repo: 'owner/repo',
        objective: 'Implement a new feature with long enough description',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Gemini failed');
  });
});
