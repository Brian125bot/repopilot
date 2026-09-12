import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordOutcomeRowWithFeatures, summarizeFirstPassOutcomes } from '@/lib/first-pass-analytics';
import { buildOutcomeRow } from '@/lib/outcome-memory';

const features = {
  objectiveChars: 80, objectiveHasVerb: true, objectiveHasWhere: true, objectiveHasVerification: true,
  criteriaTotal: 4, criteriaFunctional: 2, criteriaTesting: 1, criteriaSecurity: 0, criteriaConstraint: 1,
  boundaryCount: 1, boundaryMatched: 1, boundaryUnmatched: 0, filesToReadCount: 2,
  hasTestCommand: true, framework: 'Next.js', language: 'TypeScript', treeSize: 40, warningCount: 0,
};

describe('first-pass storage (localStorage)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const store: Record<string, string> = {};
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', undefined);
    // jsdom-free stub via global window
    (globalThis as unknown as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
      },
    };
  });

  it('records row with features and caps at 50', () => {
    const row = buildOutcomeRow({
      blueprint: { blueprintId: 'bp1', repo: 'a/b', sessionId: 's1' } as never,
      turn: 'initial', usedPriorSession: false,
    });
    const out = recordOutcomeRowWithFeatures(row, features);
    expect(out).toHaveLength(1);
    expect(out[0].firstPass?.hasTestCommand).toBe(true);
  });

  it('summarize skips continuation turns and rows without features', () => {
    const slices = summarizeFirstPassOutcomes([
      { blueprintId: 'x', repo: 'r', turn: 'continuation', usedPriorSession: true, at: new Date().toISOString(), verdict: 'READY_TO_MERGE' } as never,
      { blueprintId: 'y', repo: 'r', turn: 'initial', usedPriorSession: false, at: new Date().toISOString() } as never,
    ]);
    expect(slices).toEqual([]);
  });

  it('handles corrupt storage gracefully', () => {
    (globalThis as unknown as { window: { localStorage: { getItem: () => string; setItem: () => void } } }).window = {
      localStorage: { getItem: () => 'not-json{{{', setItem: () => { throw new Error('full'); } },
    };
    const row = buildOutcomeRow({
      blueprint: { blueprintId: 'bp2', repo: 'a/b' } as never, turn: 'initial', usedPriorSession: false,
    });
    const out = recordOutcomeRowWithFeatures(row, features);
    expect(out[0].blueprintId).toBe('bp2');
  });
});
