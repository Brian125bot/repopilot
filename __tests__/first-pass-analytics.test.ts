import { describe, it, expect } from 'vitest';
import {
  buildFirstPassFeatures,
  summarizeFirstPassOutcomes,
  OutcomeRowWithFeatures,
} from '@/lib/first-pass-analytics';

const blueprint = {
  blueprintId: 'bp_fp_1',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/limiter',
  fileBoundaries: ['src/middleware/**'],
  objective: 'Implement limiter in src/middleware/rate-limiter.ts verified by unit tests returning HTTP 429',
  criteria: [
    { id: '1', text: 'Enforce 60 req/min in src/middleware/rate-limiter.ts verified by test', category: 'functional' as const },
    { id: '2', text: 'Unit tests cover burst in tests/x.test.ts', category: 'testing' as const },
    { id: '3', text: 'Zero modifications to package.json', category: 'constraint' as const },
  ],
  createdAt: new Date().toISOString(),
};

describe('buildFirstPassFeatures', () => {
  it('captures objective quality, balance, boundary match, and test command', () => {
    const f = buildFirstPassFeatures({
      blueprint: blueprint as never,
      repoInspection: {
        repo: 'acme-corp/api-gateway',
        name: 'api-gateway',
        owner: 'acme-corp',
        defaultBranch: 'main',
        primaryLanguage: 'TypeScript',
        treePreview: ['src/middleware/rate-limiter.ts'],
        treePaths: ['src/middleware/rate-limiter.ts', 'tests/x.test.ts'],
        keyFiles: { testCommand: 'npm test', framework: 'Next.js' },
        isReachable: true,
      } as never,
      boundaries: ['src/middleware/**'],
      warnings: [],
    });
    expect(f.objectiveHasVerb).toBe(true);
    expect(f.objectiveHasWhere).toBe(true);
    expect(f.criteriaTotal).toBe(3);
    expect(f.boundaryMatched).toBe(1);
    expect(f.boundaryUnmatched).toBe(0);
    expect(f.hasTestCommand).toBe(true);
    expect(f.framework).toBe('Next.js');
  });
});

describe('summarizeFirstPassOutcomes', () => {
  const rows: OutcomeRowWithFeatures[] = [
    {
      blueprintId: 'a', repo: 'r', turn: 'initial', verdict: 'READY_TO_MERGE',
      usedPriorSession: false, at: new Date().toISOString(),
      firstPass: {
        objectiveChars: 80, objectiveHasVerb: true, objectiveHasWhere: true, objectiveHasVerification: true,
        criteriaTotal: 4, criteriaFunctional: 2, criteriaTesting: 1, criteriaSecurity: 0, criteriaConstraint: 1,
        boundaryCount: 2, boundaryMatched: 2, boundaryUnmatched: 0, filesToReadCount: 3,
        hasTestCommand: true, framework: 'Next.js', language: 'TypeScript', treeSize: 50, warningCount: 0,
      },
    },
    {
      blueprintId: 'b', repo: 'r', turn: 'initial', verdict: 'NEEDS_REVISION',
      usedPriorSession: false, at: new Date().toISOString(),
      firstPass: {
        objectiveChars: 12, objectiveHasVerb: false, objectiveHasWhere: false, objectiveHasVerification: false,
        criteriaTotal: 1, criteriaFunctional: 1, criteriaTesting: 0, criteriaSecurity: 0, criteriaConstraint: 0,
        boundaryCount: 1, boundaryMatched: 0, boundaryUnmatched: 1, filesToReadCount: 0,
        hasTestCommand: false, framework: 'unknown', language: 'TypeScript', treeSize: 5, warningCount: 3,
      },
    },
  ];

  it('computes READY rates sliced by intake pattern, skipping rows without features', () => {
    const slices = summarizeFirstPassOutcomes([
      ...rows,
      { blueprintId: 'c', repo: 'r', turn: 'initial', usedPriorSession: false, at: new Date().toISOString() },
    ]);
    const byKey = Object.fromEntries(slices.map((s) => [s.key, s]));
    expect(byKey['testCommand:yes'].readyRate).toBe(1);
    expect(byKey['testCommand:no'].readyRate).toBe(0);
    expect(byKey['criteria:balanced'].total).toBe(1);
    expect(byKey['criteria:unbalanced'].total).toBe(1);
  });
});
