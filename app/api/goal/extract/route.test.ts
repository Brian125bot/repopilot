import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import type { RepoProfile } from '@/lib/types/steering';

const mockGenerateContent = vi.fn();

vi.mock('@/lib/gemini', () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('POST /api/goal/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleProfile: RepoProfile = {
    id: 'owner/repo',
    repoRef: { owner: 'owner', repo: 'repo', defaultBranch: 'main' },
    stack: { packageManager: 'npm', testRunner: 'vitest', framework: 'Next.js', languages: ['TypeScript'] },
    conventions: [{ id: '1', title: 'Testing', body: 'Run vitest for unit tests' }],
    updatedAt: '2026-09-30T12:00:00.000Z',
    version: 1,
  };

  it('returns 401 UNAUTHORIZED if x-gemini-api-key header is missing and process.env is empty', async () => {
    const originalEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      body: JSON.stringify({ rawText: 'Add rate limiting' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.code).toBe('UNAUTHORIZED');

    process.env.GEMINI_API_KEY = originalEnv;
  });

  it('successfully extracts structured goal with valid Gemini response and profile context', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        title: 'Add rate limiting to login API',
        scope: 'app/api/login/route.ts',
        acceptanceCriteria: ['npm test app/api/login/route.test.ts passes'],
        assumptions: ['Max 5 requests per minute per IP'],
        ambiguityFlags: [],
      }),
    });

    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      headers: {
        'x-gemini-api-key': 'test-gemini-key',
      },
      body: JSON.stringify({
        rawText: 'Add rate limiting to login API',
        repoProfile: sampleProfile,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.extracted).toEqual({
      title: 'Add rate limiting to login API',
      scope: 'app/api/login/route.ts',
      acceptanceCriteria: ['npm test app/api/login/route.test.ts passes'],
      assumptions: ['Max 5 requests per minute per IP'],
      ambiguityFlags: [],
    });
  });

  it('handles vague task description returning UNCLEAR and ambiguityFlags', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        title: 'UNCLEAR',
        scope: '',
        acceptanceCriteria: [],
        assumptions: [],
        ambiguityFlags: ['Task instructions are too vague: "do something"'],
      }),
    });

    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      headers: {
        'x-gemini-api-key': 'test-gemini-key',
      },
      body: JSON.stringify({
        rawText: 'do something',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.extracted.title).toBe('UNCLEAR');
    expect(json.extracted.ambiguityFlags).toHaveLength(1);
  });
});
