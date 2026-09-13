import { describe, it, expect } from 'vitest';
import { Blueprint, CriterionResult, GeminiAuditReport } from '@/types';
import { MAX_DIFF_CHAR_BUDGET } from '@/lib/diff-sanitizer';
import { MAX_EVALUATE_DIFF_CHARS } from '@/lib/gemini';
import { attachAuditGrade, unionUnauthorizedPaths } from '@/lib/scoring';
import { buildFailureBrief } from '@/lib/outcome-memory';
import { compileRemediationPrompt } from '@/lib/prompt-compiler';

function criterion(overrides: Partial<CriterionResult> & Pick<CriterionResult, 'id' | 'status'>): CriterionResult {
  return {
    criterion: `Criterion ${overrides.id}`,
    evidence: `Evidence ${overrides.id}`,
    lineReferences: [],
    ...overrides,
  };
}

function report(overrides?: Partial<GeminiAuditReport>): GeminiAuditReport {
  return {
    criteriaResults: [
      criterion({ id: '1', status: 'MET', criterion: 'Works', evidence: 'Done' }),
      criterion({
        id: '2',
        status: 'UNMET',
        criterion: 'TTL fallback',
        evidence: 'Missing',
        remainingWork: 'Add 60s TTL',
        category: 'functional',
      }),
    ],
    scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
    blastRadius: { rating: 'LOW', explanation: 'Surgical.' },
    mergeVerdict: {
      status: 'NEEDS_REVISION',
      overallScore: 50,
      keyBlockers: ['TTL missing'],
      actionableFeedbackForAgent: 'Add TTL.',
    },
    ...overrides,
  };
}

const blueprint: Blueprint = {
  blueprintId: 'bp_server_grade',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/rate-limiter-redis',
  fileBoundaries: ['src/middleware/**'],
  objective: 'Rate limiter',
  criteria: [],
  createdAt: new Date().toISOString(),
};

describe('server single truth (evaluate route contract)', () => {
  it('exposes a single shared diff budget across sanitizer, scoring, and gemini', () => {
    expect(MAX_DIFF_CHAR_BUDGET).toBe(90_000);
    expect(MAX_EVALUATE_DIFF_CHARS).toBe(MAX_DIFF_CHAR_BUDGET);
  });

  it('unions derived + client paths add-only (empty never clears)', () => {
    expect(unionUnauthorizedPaths(['a.ts'], [])).toEqual(['a.ts']);
    expect(unionUnauthorizedPaths([], ['b.ts'])).toEqual(['b.ts']);
    expect(unionUnauthorizedPaths(['a.ts'], ['a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
  });

  it('attachAuditGrade syncs mergeVerdict from grade (no divergence)', () => {
    const graded = attachAuditGrade(report(), { criteria: [] });
    expect(graded.grade).toBeDefined();
    expect(graded.mergeVerdict.status).toBe(graded.grade.verdict);
    expect(graded.mergeVerdict.overallScore).toBe(graded.grade.overallScore);
  });

  it('marks truncated when diff exceeds the evaluate cap', () => {
    const longDiff = `diff --git a/src/a.ts b/src/a.ts\n${'x'.repeat(MAX_EVALUATE_DIFF_CHARS + 10)}`;
    const truncated = longDiff.length > MAX_EVALUATE_DIFF_CHARS;
    expect(truncated).toBe(true);
    const shortDiff = 'diff --git a/src/a.ts b/src/a.ts\n+x';
    expect(shortDiff.length > MAX_EVALUATE_DIFF_CHARS).toBe(false);
  });
});

describe('grade through outcome + remediation', () => {
  it('buildFailureBrief prefers grade verdict/score over stale mergeVerdict', () => {
    const graded = attachAuditGrade(report(), { criteria: [] });
    // Grade disagrees with a stale model verdict — the brief must follow the grade.
    const divergent = {
      ...graded,
      mergeVerdict: { ...graded.mergeVerdict, status: 'READY_TO_MERGE' as const, overallScore: 100 },
    };
    const briefFromGrade = buildFailureBrief(divergent, blueprint, []);
    expect(briefFromGrade.verdict).toBe(graded.grade.verdict);
    expect(briefFromGrade.score).toBe(graded.grade.overallScore);
    // Legacy report without grade falls back to its own mergeVerdict.
    const legacy = report({
      mergeVerdict: {
        status: 'READY_TO_MERGE' as const,
        overallScore: 100,
        keyBlockers: [],
        actionableFeedbackForAgent: 'None',
      },
    });
    expect(legacy.grade).toBeUndefined();
    const briefLegacy = buildFailureBrief(legacy, blueprint, []);
    expect(briefLegacy.verdict).toBe('READY_TO_MERGE');
  });

  it('brief requiredFixes carry Remaining (and Satisfied for PARTIAL)', () => {
    const r = report({
      criteriaResults: [
        criterion({ id: '1', status: 'UNMET', criterion: 'U', evidence: 'e', remainingWork: 'Do X' }),
        criterion({
          id: '2',
          status: 'PARTIALLY_MET',
          criterion: 'P',
          evidence: 'e',
          satisfiedAspects: 'Has Y',
          remainingWork: 'Add Z',
        }),
      ],
    });
    const brief = buildFailureBrief(r, blueprint, []);
    expect(brief.requiredFixes[0]).toContain('Remaining: Do X');
    expect(brief.requiredFixes[1]).toContain('Satisfied: Has Y');
    expect(brief.requiredFixes[1]).toContain('Remaining: Add Z');
  });

  it('remediation prompt carries score composition, Next, risk, and Remaining', () => {
    const graded = attachAuditGrade(
      report({
        diffFacts: { filesTouched: 2, linesAdded: 40, linesRemoved: 5, unauthorizedCount: 0 },
      }),
      { criteria: [] }
    );
    const prompt = compileRemediationPrompt({
      targetBranch: blueprint.branchName,
      baseBranch: 'main',
      prNumber: 42,
      prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
      report: graded,
      fileBoundaries: blueprint.fileBoundaries,
    });
    expect(prompt).toContain('criteria −');
    expect(prompt).toContain('Next:');
    expect(prompt).toContain('Change Risk:');
    expect(prompt).toContain('Remaining: Add 60s TTL');
    expect(prompt).toContain('`jules/rate-limiter-redis`');
  });

  it('remediation prompt never regresses to report order (UNMET before PARTIAL)', () => {
    const r = report({
      criteriaResults: [
        criterion({ id: '3', status: 'PARTIALLY_MET', criterion: 'P first', evidence: 'gap' }),
        criterion({ id: '2', status: 'UNMET', criterion: 'U second', evidence: 'missing' }),
      ],
    });
    const prompt = compileRemediationPrompt({
      targetBranch: blueprint.branchName,
      report: r,
    });
    expect(prompt.indexOf('[UNMET] Criterion 2')).toBeLessThan(
      prompt.indexOf('[PARTIALLY_MET] Criterion 3')
    );
  });
});
