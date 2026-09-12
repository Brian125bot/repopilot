import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/criteria/generate/route';
import { NextRequest } from 'next/server';

describe('criteria generate route validation', () => {
  it('rejects bad repo format with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      body: JSON.stringify({ repo: 'bad', objective: 'long enough objective here' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects short objective with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      body: JSON.stringify({ repo: 'a/b', objective: 'short' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('generateAcceptanceCriteria balancing safety net', () => {
  beforeEach(() => vi.restoreAllMocks());

  async function loadGeminiWithMockedResponse(mockCriteria: unknown[]) {
    vi.resetModules();
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        criteria: mockCriteria,
        recommendedFileBoundaries: ['src/middleware/**'],
        suggestedBranchName: 'jules/test',
        summaryRationale: 'r',
        detectedArchitecture: 'a',
      }),
    });
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        models = { generateContent };
      },
      Type: { OBJECT: 'object', ARRAY: 'array', STRING: 'string' },
    }));
    const mod = await import('@/lib/gemini');
    return { mod, generateContent };
  }

  it('appends missing testing + constraint criteria up to cap 7', async () => {
    const { mod } = await loadGeminiWithMockedResponse([
      { id: '1', text: 'Enforce limit in src/m.ts verified by test', category: 'functional', rationale: 'r' },
    ]);
    const out = await mod.generateAcceptanceCriteria({
      repo: 'a/b',
      objective: 'Implement limiter in src/m.ts verified by tests',
      repoContext: { keyFiles: { testCommand: 'npm test' } } as never,
      customApiKey: 'test-key',
    });
    const cats = out.criteria.map((c) => c.category);
    expect(cats).toContain('testing');
    expect(cats).toContain('constraint');
    expect(out.criteria.length).toBeLessThanOrEqual(7);
    expect(out.criteria.find((c) => c.category === 'testing')?.text).toContain('npm test');
  });

  it('does not exceed 7 when model already returns 7', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1), text: `Functional ${i} in src/a.ts verified by test`, category: 'functional', rationale: 'r',
    }));
    const { mod } = await loadGeminiWithMockedResponse(seven);
    const out = await mod.generateAcceptanceCriteria({ repo: 'a/b', objective: 'Implement x in src/a.ts verified by tests', customApiKey: 'test-key' });
    expect(out.criteria).toHaveLength(7);
  });

  it('propagates empty Gemini response as error', async () => {
    vi.resetModules();
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        models = { generateContent: vi.fn().mockResolvedValue({ text: '' }) };
      },
      Type: { OBJECT: 'object', ARRAY: 'array', STRING: 'string' },
    }));
    const mod = await import('@/lib/gemini');
    await expect(mod.generateAcceptanceCriteria({ repo: 'a/b', objective: 'long enough objective for test', customApiKey: 'test-key' })).rejects.toThrow(/empty/i);
  });
});
