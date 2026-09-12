import { describe, it, expect } from 'vitest';
import { AcceptanceCriterion, GeminiAuditReport } from '@/types';
import {
  BLAST_LOW_MAX_LINES,
  BLAST_MEDIUM_MAX_LINES,
  attachAuditGrade,
  attachCriterionCategories,
  buildAuditGrade,
  extractPathFromReference,
  formatScorecardSummary,
  groundBlastRating,
  isCriticalUnauthorizedPath,
  isDocOnlyPath,
  nextDecisionSentence,
  normalizeCriterionId,
  partitionLineReferences,
  sortCriteriaForDecision,
  unionUnauthorizedPaths,
  withVerifiedLineReferences,
} from '@/lib/scoring';

const blueprintCriteria: AcceptanceCriterion[] = [
  { id: '1', text: 'Middleware extracts client IP', category: 'functional' },
  { id: '2', text: 'Sliding window enforces 60 req/min', category: 'functional' },
  { id: '3', text: 'Unit tests cover burst traffic', category: 'testing' },
  { id: '4', text: 'Zero out-of-scope files', category: 'constraint' },
];

const buildReport = (overrides?: Partial<GeminiAuditReport>): GeminiAuditReport => ({
  criteriaResults: [
    {
      id: '1',
      criterion: 'Middleware extracts client IP',
      status: 'MET',
      evidence: 'IP extracted via x-forwarded-for',
      lineReferences: ['src/middleware/rate-limiter.ts:18-24'],
    },
    {
      id: '2',
      criterion: 'Sliding window enforces 60 req/min',
      status: 'UNMET',
      evidence: 'No TTL fallback in window calculation',
      remainingWork: 'Add 60-second TTL fallback',
      lineReferences: ['src/middleware/rate-limiter.ts:45-52'],
    },
    {
      id: '3',
      criterion: 'Unit tests cover burst traffic',
      status: 'PARTIALLY_MET',
      evidence: 'Happy-path test exists; burst case is skipped',
      satisfiedAspects: 'Happy-path unit test present',
      remainingWork: 'Add burst and window-expiry cases',
      lineReferences: ['tests/middleware/rate-limiter.test.ts:80-94'],
    },
    {
      id: '4',
      criterion: 'Zero out-of-scope files',
      status: 'UNMET',
      evidence: 'package.json was modified',
      remainingWork: 'Revert package.json',
      lineReferences: ['package.json:14'],
    },
  ],
  scopeIntegrity: {
    strictlyInScope: false,
    unauthorizedFiles: ['package.json'],
    explanation: 'Dependency freeze violated.',
  },
  blastRadius: { rating: 'LOW', explanation: 'Model called this surgical.' },
  mergeVerdict: {
    status: 'NEEDS_REVISION',
    overallScore: 62,
    keyBlockers: ['TTL fallback missing', 'Unauthorized package.json change'],
    actionableFeedbackForAgent: 'Revert package.json and add TTL fallback.',
  },
  ...overrides,
});

describe('normalizeCriterionId', () => {
  it('joins CRIT-1, crit_1, 01, and 1 to the same key', () => {
    expect(normalizeCriterionId('CRIT-1')).toBe('1');
    expect(normalizeCriterionId('crit_1')).toBe('1');
    expect(normalizeCriterionId('01')).toBe('1');
    expect(normalizeCriterionId(' 1 ')).toBe('1');
    expect(normalizeCriterionId('Criterion-2')).toBe('2');
  });

  it('returns empty for nullish ids', () => {
    expect(normalizeCriterionId(null)).toBe('');
    expect(normalizeCriterionId(undefined)).toBe('');
  });
});

describe('unionUnauthorizedPaths', () => {
  it('is add-only, dedupes, trims, and ignores non-arrays', () => {
    expect(
      unionUnauthorizedPaths(['a.ts', ' b.ts '], ['b.ts', 'c.ts'], undefined, null, [] as string[])
    ).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('returns empty for all-empty inputs (clean)', () => {
    expect(unionUnauthorizedPaths([], undefined)).toEqual([]);
  });
});

describe('attachCriterionCategories', () => {
  it('joins Stage 1 categories by id and defaults to functional', () => {
    const stamped = attachCriterionCategories(buildReport().criteriaResults, blueprintCriteria);
    expect(stamped.map((c) => c.category)).toEqual(['functional', 'functional', 'testing', 'constraint']);
  });

  it('normalizes CRIT- / zero-padded ids before joining', () => {
    const rows = [
      { id: 'CRIT-1', criterion: 'a', status: 'MET' as const, evidence: 'e', lineReferences: [] },
      { id: '03', criterion: 'b', status: 'MET' as const, evidence: 'e', lineReferences: [] },
    ];
    const stamped = attachCriterionCategories(rows, blueprintCriteria);
    expect(stamped[0].category).toBe('functional');
    expect(stamped[1].category).toBe('testing');
  });

  it('falls back to row category then functional for unknown ids', () => {
    const rows = [
      {
        id: '999',
        criterion: 'x',
        status: 'MET' as const,
        evidence: 'e',
        lineReferences: [],
        category: 'security' as const,
      },
      { id: '1000', criterion: 'y', status: 'MET' as const, evidence: 'e', lineReferences: [] },
    ];
    const stamped = attachCriterionCategories(rows, blueprintCriteria);
    expect(stamped[0].category).toBe('security');
    expect(stamped[1].category).toBe('functional');
  });
});

describe('severity helpers', () => {
  it('flags critical unauthorized paths', () => {
    expect(isCriticalUnauthorizedPath('package.json')).toBe(true);
    expect(isCriticalUnauthorizedPath('package-lock.json')).toBe(true);
    expect(isCriticalUnauthorizedPath('Dockerfile')).toBe(true);
    expect(isCriticalUnauthorizedPath('.env.local')).toBe(true);
    expect(isCriticalUnauthorizedPath('next.config.ts')).toBe(true);
    expect(isCriticalUnauthorizedPath('src/middleware/auth.ts')).toBe(true);
    expect(isCriticalUnauthorizedPath('src/lib/security.ts')).toBe(true);
    expect(isCriticalUnauthorizedPath('prisma/schema.prisma')).toBe(true);
  });

  it('does not flag ordinary source or docs as critical', () => {
    expect(isCriticalUnauthorizedPath('src/middleware/rate-limiter.ts')).toBe(false);
    expect(isCriticalUnauthorizedPath('README.md')).toBe(false);
    expect(isCriticalUnauthorizedPath('docs/guide.md')).toBe(false);
  });

  it('detects doc-only paths', () => {
    expect(isDocOnlyPath('README.md')).toBe(true);
    expect(isDocOnlyPath('docs/guide.txt')).toBe(true);
    expect(isDocOnlyPath('src/a.ts')).toBe(false);
  });
});

describe('groundBlastRating', () => {
  it('uses the prompt line-volume bands', () => {
    expect(BLAST_LOW_MAX_LINES).toBe(149);
    expect(BLAST_MEDIUM_MAX_LINES).toBe(500);
    expect(
      groundBlastRating({ filesTouched: 2, linesAdded: 80, linesRemoved: 20, unauthorizedCount: 0 })
    ).toBe('LOW');
    expect(
      groundBlastRating({ filesTouched: 6, linesAdded: 200, linesRemoved: 50, unauthorizedCount: 0 })
    ).toBe('MEDIUM');
    expect(
      groundBlastRating({ filesTouched: 14, linesAdded: 400, linesRemoved: 212, unauthorizedCount: 0 })
    ).toBe('HIGH');
  });

  it('honours exact band boundaries 149 / 150 / 500 / 501', () => {
    const base = { filesTouched: 1, linesRemoved: 0, unauthorizedCount: 0 };
    expect(groundBlastRating({ ...base, linesAdded: 149 })).toBe('LOW');
    expect(groundBlastRating({ ...base, linesAdded: 150 })).toBe('MEDIUM');
    expect(groundBlastRating({ ...base, linesAdded: 500 })).toBe('MEDIUM');
    expect(groundBlastRating({ ...base, linesAdded: 501 })).toBe('HIGH');
  });

  it('softens non-critical scope violations to MEDIUM on tiny diffs', () => {
    expect(
      groundBlastRating(
        { filesTouched: 1, linesAdded: 4, linesRemoved: 0, unauthorizedCount: 1 },
        { unauthorizedPaths: ['README.md'] }
      )
    ).toBe('MEDIUM');
    // Legacy pathless shape (no unauthorizedPaths) also softens — severity needs paths to escalate.
    expect(
      groundBlastRating({ filesTouched: 1, linesAdded: 4, linesRemoved: 0, unauthorizedCount: 1 })
    ).toBe('MEDIUM');
  });

  it('keeps HIGH for critical unauthorized files even on tiny diffs', () => {
    expect(
      groundBlastRating(
        { filesTouched: 1, linesAdded: 4, linesRemoved: 0, unauthorizedCount: 1 },
        { unauthorizedPaths: ['package.json'] }
      )
    ).toBe('HIGH');
  });

  it('escalates non-critical violations to HIGH past 500 lines', () => {
    expect(
      groundBlastRating(
        { filesTouched: 14, linesAdded: 600, linesRemoved: 10, unauthorizedCount: 1 },
        { unauthorizedPaths: ['docs/guide.md'] }
      )
    ).toBe('HIGH');
  });
});

describe('line-reference validation', () => {
  it('extracts path tokens from path:lines refs', () => {
    expect(extractPathFromReference('src/a.ts:12-20')).toBe('src/a.ts');
    expect(extractPathFromReference('package.json:14')).toBe('package.json');
    expect(extractPathFromReference('no-extension')).toBe(null);
  });

  it('partitions verified vs unverified against touchedPaths', () => {
    const touched = ['src/a.ts', 'package.json'];
    expect(
      partitionLineReferences(['src/a.ts:1-5', 'src/missing.ts:9'], touched)
    ).toEqual({ verified: ['src/a.ts:1-5'], unverified: ['src/missing.ts:9'] });
  });

  it('passes everything through when touchedPaths is empty (old reports)', () => {
    expect(partitionLineReferences(['anything.ts:1'], [])).toEqual({
      verified: ['anything.ts:1'],
      unverified: [],
    });
  });

  it('stamps unverifiedReferences without failing the row', () => {
    const rows = [
      {
        id: '1',
        criterion: 'a',
        status: 'MET' as const,
        evidence: 'e',
        lineReferences: ['src/a.ts:1', 'src/ghost.ts:9'],
      },
    ];
    const stamped = withVerifiedLineReferences(rows, ['src/a.ts']);
    expect(stamped[0].unverifiedReferences).toEqual(['src/ghost.ts:9']);
    expect(stamped[0].lineReferences).toEqual(['src/a.ts:1', 'src/ghost.ts:9']);
  });
});

describe('buildAuditGrade', () => {
  it('keeps headline math: all MET in-scope is 100 READY', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Works',
          status: 'MET',
          evidence: 'Yes',
          lineReferences: [],
        },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
    });
    const grade = buildAuditGrade(report, { criteria: blueprintCriteria });

    expect(grade.overallScore).toBe(100);
    expect(grade.criteriaScore).toBe(100);
    expect(grade.scopePenalty).toBe(0);
    expect(grade.verdict).toBe('READY_TO_MERGE');
    expect(grade.nextDecision).toBe('merge');
    expect(grade.why[0]).toMatch(/All criteria MET/i);
  });

  it('prints 100 − 35 = 65 and never READY when package.json is unauthorized', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Works',
          status: 'MET',
          evidence: 'Yes',
          lineReferences: [],
        },
      ],
    });
    const grade = buildAuditGrade(report);

    expect(grade.criteriaScore).toBe(100);
    expect(grade.scopePenalty).toBe(35);
    expect(grade.overallScore).toBe(65);
    expect(grade.scoreParts).toEqual({ criteria: 100, scope: 35, total: 65 });
    expect(grade.verdict).not.toBe('READY_TO_MERGE');
    expect(grade.nextDecision).toBe('revert_scope');
    expect(grade.why.some((line) => line.includes('−35') && line.includes('package.json'))).toBe(true);
  });

  it('grounds blast HIGH from large line volume even if the model said LOW', () => {
    const grade = buildAuditGrade(buildReport(), {
      criteria: blueprintCriteria,
      diffFacts: { filesTouched: 14, linesAdded: 612, linesRemoved: 40, unauthorizedCount: 1 },
    });

    expect(grade.blast.rating).toBe('HIGH');
    expect(grade.blast.grounded).toBe(true);
    expect(grade.blast.explanation).toContain('surgical');
    expect(grade.diffFacts?.filesTouched).toBe(14);
  });

  it('softens non-critical unauthorized blast to MEDIUM', () => {
    const report = buildReport({
      scopeIntegrity: { strictlyInScope: false, unauthorizedFiles: ['README.md'], explanation: 'Docs drift.' },
    });
    const grade = buildAuditGrade(report, {
      diffFacts: {
        filesTouched: 1,
        linesAdded: 4,
        linesRemoved: 0,
        unauthorizedCount: 1,
        unauthorizedPaths: ['README.md'],
      },
    });
    expect(grade.blast.rating).toBe('MEDIUM');
    expect(grade.blast.grounded).toBe(true);
    expect(grade.verdict).not.toBe('READY_TO_MERGE');
  });

  it('keeps the model blast rating and marks grounded false when stats are missing', () => {
    const grade = buildAuditGrade(buildReport());
    expect(grade.blast.rating).toBe('LOW');
    expect(grade.blast.grounded).toBe(false);
  });

  it('rolls up categories from the blueprint join', () => {
    const grade = buildAuditGrade(buildReport(), { criteria: blueprintCriteria });

    expect(grade.categoryRollup.functional).toEqual({ met: 1, partial: 0, unmet: 1, total: 2 });
    expect(grade.categoryRollup.testing).toEqual({ met: 0, partial: 1, unmet: 0, total: 1 });
    expect(grade.categoryRollup.constraint).toEqual({ met: 0, partial: 0, unmet: 1, total: 1 });
    expect(grade.categoryRollup.security.total).toBe(0);
    expect(grade.met).toBe(1);
    expect(grade.partial).toBe(1);
    expect(grade.unmet).toBe(2);
  });

  it('falls back unknown categories to functional', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '9',
          criterion: 'Mystery',
          status: 'MET',
          evidence: 'e',
          lineReferences: [],
          category: 'nope' as unknown as 'functional',
        },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
    });
    const grade = buildAuditGrade(report, { criteria: [] });
    expect(grade.categoryRollup.functional.total).toBe(1);
  });

  it('handles empty criteria without crashing', () => {
    const report = buildReport({
      criteriaResults: [],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
    });
    const grade = buildAuditGrade(report, { criteria: [] });
    expect(grade.total).toBe(0);
    expect(grade.overallScore).toBe(0);
    expect(grade.categoryRollup.functional.total).toBe(0);
  });

  it('unions unauthorized paths across scope, extras, and diffFacts', () => {
    const report = buildReport({
      scopeIntegrity: { strictlyInScope: false, unauthorizedFiles: ['a.ts'], explanation: 'x' },
      diffFacts: {
        filesTouched: 2,
        linesAdded: 10,
        linesRemoved: 0,
        unauthorizedCount: 1,
        unauthorizedPaths: ['b.ts'],
      },
    });
    const grade = buildAuditGrade(report, { unauthorizedPaths: ['c.ts'] });
    expect(grade.diffFacts?.unauthorizedPaths).toEqual(
      expect.arrayContaining(['a.ts', 'b.ts', 'c.ts'])
    );
    expect(grade.diffFacts?.unauthorizedCount).toBe(3);
  });

  it('chooses remediate when in-scope work remains', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Middleware extracts client IP',
          status: 'MET',
          evidence: 'Done',
          lineReferences: [],
        },
        {
          id: '2',
          criterion: 'Sliding window enforces 60 req/min',
          status: 'UNMET',
          evidence: 'No TTL fallback',
          remainingWork: 'Add TTL fallback',
          lineReferences: [],
        },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
    });
    const grade = buildAuditGrade(report, { criteria: blueprintCriteria });
    expect(grade.verdict).toBe('NEEDS_REVISION');
    expect(grade.nextDecision).toBe('remediate');
    expect(nextDecisionSentence(grade.nextDecision, 'jules/rate-limiter-redis')).toContain(
      '`jules/rate-limiter-redis`'
    );
  });
});

describe('attachAuditGrade (server single truth)', () => {
  it('syncs mergeVerdict from grade and stamps categories', () => {
    const graded = attachAuditGrade(buildReport(), { criteria: blueprintCriteria });
    expect(graded.grade).toBeDefined();
    expect(graded.mergeVerdict.status).toBe(graded.grade.verdict);
    expect(graded.mergeVerdict.overallScore).toBe(graded.grade.overallScore);
    expect(graded.criteriaResults.map((c) => c.category)).toEqual([
      'functional',
      'functional',
      'testing',
      'constraint',
    ]);
  });

  it('validates line refs against touchedPaths', () => {
    const graded = attachAuditGrade(buildReport(), {
      criteria: blueprintCriteria,
      touchedPaths: ['src/middleware/rate-limiter.ts'],
    });
    const ghost = graded.criteriaResults.find((c) => c.id === '4');
    expect(ghost?.unverifiedReferences).toEqual(['package.json:14']);
  });
});

describe('formatScorecardSummary', () => {
  it('includes composition, counts, grounded risk, next decision, and open ids', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Middleware extracts client IP',
          status: 'MET',
          evidence: 'Done',
          lineReferences: [],
        },
        {
          id: '2',
          criterion: 'Sliding window enforces 60 req/min',
          status: 'UNMET',
          evidence: 'No TTL fallback in window calculation',
          remainingWork: 'Add 60-second TTL fallback',
          lineReferences: [],
        },
        {
          id: '3',
          criterion: 'Unit tests cover burst traffic',
          status: 'MET',
          evidence: 'Covered',
          lineReferences: [],
        },
        {
          id: '4',
          criterion: 'Zero out-of-scope files',
          status: 'MET',
          evidence: 'Otherwise clean besides the listed path',
          lineReferences: [],
        },
      ],
    });
    const grade = buildAuditGrade(report, {
      criteria: blueprintCriteria,
      diffFacts: { filesTouched: 14, linesAdded: 612, linesRemoved: 40, unauthorizedCount: 1 },
    });
    const summary = formatScorecardSummary(grade, report);

    expect(summary).toContain('NEEDS_REVISION');
    expect(summary).toMatch(/=\s+\d+ criteria − 35 scope/);
    expect(summary).toContain('MET 3 · PARTIAL 0 · UNMET 1 of 4');
    expect(summary).toContain('Scope: violated (package.json)');
    expect(summary).toContain('Change risk: HIGH · 14 files · +612/−40');
    expect(summary).toContain('Next: revert_scope');
    expect(summary).toContain('[UNMET] 2');
    expect(summary).toContain('remaining: Add 60-second TTL fallback');
  });

  it('marks truncated diffs in the risk line', () => {
    const report = buildReport({
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
      criteriaResults: [
        { id: '1', criterion: 'Works', status: 'MET', evidence: 'Yes', lineReferences: [] },
      ],
    });
    const grade = buildAuditGrade(report, {
      diffFacts: {
        filesTouched: 3,
        linesAdded: 120,
        linesRemoved: 10,
        unauthorizedCount: 0,
        truncated: true,
        shownChars: 80000,
      },
    });
    expect(formatScorecardSummary(grade, report)).toContain('truncated');
  });
});

describe('sortCriteriaForDecision', () => {
  it('orders UNMET then PARTIAL then MET', () => {
    const ordered = sortCriteriaForDecision(buildReport().criteriaResults);
    expect(ordered.map((c) => c.status)).toEqual(['UNMET', 'UNMET', 'PARTIALLY_MET', 'MET']);
  });
});
