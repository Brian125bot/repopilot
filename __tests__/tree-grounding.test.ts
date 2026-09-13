import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fallbackBoundariesFromTree,
  validateAndFilterBoundaries,
} from '@/lib/prompt-compiler';
import { POST } from '@/app/api/criteria/generate/route';
import { NextRequest } from 'next/server';
import { generateAcceptanceCriteria } from '@/lib/gemini';

vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return { ...actual, generateAcceptanceCriteria: vi.fn() };
});

const mockedGenerate = vi.mocked(generateAcceptanceCriteria);

const TREE = [
  'src/middleware/rate-limiter.ts',
  'src/middleware/auth.ts',
  'src/config/redis.ts',
  'tests/middleware/rate-limiter.test.ts',
  'package.json',
  'README.md',
];

describe('validateAndFilterBoundaries', () => {
  it('keeps globs matching real paths and rejects invented ones', () => {
    const { validGlobs, rejectedGlobs } = validateAndFilterBoundaries(
      ['src/middleware/**', 'src/nonexistent/**', 'tests/**/*.test.ts'],
      TREE
    );
    expect(validGlobs).toEqual(['src/middleware/**', 'tests/**/*.test.ts']);
    expect(rejectedGlobs).toEqual(['src/nonexistent/**']);
  });

  it('dedupes and drops blank globs', () => {
    const { validGlobs, rejectedGlobs } = validateAndFilterBoundaries(
      ['src/middleware/**', 'src/middleware/**', '  ', 'nope/**'],
      TREE
    );
    expect(validGlobs).toEqual(['src/middleware/**']);
    expect(rejectedGlobs).toEqual(['nope/**']);
  });

  it('passes everything through when no tree is available', () => {
    const { validGlobs, rejectedGlobs } = validateAndFilterBoundaries(['anything/**'], []);
    expect(validGlobs).toEqual(['anything/**']);
    expect(rejectedGlobs).toEqual([]);
  });

  it('matches exact files, not just directories', () => {
    const { validGlobs, rejectedGlobs } = validateAndFilterBoundaries(
      ['src/config/redis.ts', 'src/config/missing.ts'],
      TREE
    );
    expect(validGlobs).toEqual(['src/config/redis.ts']);
    expect(rejectedGlobs).toEqual(['src/config/missing.ts']);
  });
});

describe('fallbackBoundariesFromTree', () => {
  it('falls back to real top-level dirs ordered by file count', () => {
    const out = fallbackBoundariesFromTree(TREE);
    expect(out[0]).toBe('src/**');
    expect(out).toContain('tests/**');
    expect(out.every((g) => g.endsWith('/**'))).toBe(true);
    // Root files (no directory) never become globs.
    expect(out).not.toContain('package.json/**');
    expect(out).not.toContain('README.md/**');
  });

  it('returns [] on an empty tree so callers keep the original list', () => {
    expect(fallbackBoundariesFromTree([])).toEqual([]);
  });
});

describe('generate route tree grounding', () => {
  beforeEach(() => {
    mockedGenerate.mockReset();
    vi.restoreAllMocks();
  });

  const treeEntries = [
    { path: 'src/middleware/rate-limiter.ts', type: 'blob' },
    { path: 'src/config/redis.ts', type: 'blob' },
    { path: 'tests/rate-limiter.test.ts', type: 'blob' },
  ];

  function mockTreeFetch(entries: unknown[] | null) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (String(url).includes('/git/trees/')) {
        if (entries === null) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({ tree: entries }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
  }

  function genReq() {
    return new NextRequest('http://localhost:3000/api/criteria/generate', {
      method: 'POST',
      headers: { 'x-gemini-api-key': 'test-key' },
      body: JSON.stringify({ repo: 'acme/api', objective: 'Implement limiter in src verified by tests' }),
    });
  }

  it('strips hallucinated boundaries and reports rejectedGlobs', async () => {
    mockTreeFetch(treeEntries);
    mockedGenerate.mockResolvedValue({
      criteria: [],
      recommendedFileBoundaries: ['src/middleware/**', 'src/invented/**'],
      suggestedBranchName: 'jules/x',
      summaryRationale: 'r',
      detectedArchitecture: 'a',
    });
    const res = await POST(genReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recommendedFileBoundaries).toEqual(['src/middleware/**']);
    expect(data.rejectedGlobs).toEqual(['src/invented/**']);
  });

  it('falls back to real top-level dirs when every boundary is invented', async () => {
    mockTreeFetch(treeEntries);
    mockedGenerate.mockResolvedValue({
      criteria: [],
      recommendedFileBoundaries: ['nope/**', 'missing/x.ts'],
      suggestedBranchName: 'jules/x',
      summaryRationale: 'r',
      detectedArchitecture: 'a',
    });
    const res = await POST(genReq());
    const data = await res.json();
    expect(data.recommendedFileBoundaries).toEqual(['src/**', 'tests/**']);
    expect(data.rejectedGlobs).toEqual(['nope/**', 'missing/x.ts']);
  });

  it('keeps model output untouched when the tree is unreachable', async () => {
    mockTreeFetch(null);
    mockedGenerate.mockResolvedValue({
      criteria: [],
      recommendedFileBoundaries: ['src/middleware/**'],
      suggestedBranchName: 'jules/x',
      summaryRationale: 'r',
      detectedArchitecture: 'a',
    });
    const res = await POST(genReq());
    const data = await res.json();
    expect(data.recommendedFileBoundaries).toEqual(['src/middleware/**']);
    expect(data.rejectedGlobs).toEqual([]);
  });
});
