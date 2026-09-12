import { describe, it, expect } from 'vitest';
import {
  computeScorecardMetrics,
  forceScopeIntegrity,
  reconcileAuditReport,
  pickNextDecision,
  nextDecisionSentence,
  isDocOnlyPath,
  formatScorecardSummary,
  buildAuditGrade,
} from '@/lib/scoring';

const base = {
  criteriaResults: [
    { id: '1', criterion: 'a', status: 'MET' as const, evidence: 'e', lineReferences: [] },
  ],
  scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [] as string[], explanation: 'clean' },
  blastRadius: { rating: 'LOW' as const, explanation: 'surgical' },
  mergeVerdict: { status: 'READY_TO_MERGE' as const, overallScore: 100, keyBlockers: [], actionableFeedbackForAgent: 'none' },
};

describe('computeScorecardMetrics edges', () => {
  it('empty criteria yields 0 and BLOCKED (no free READY)', () => {
    const m = computeScorecardMetrics({ ...base, criteriaResults: [] });
    expect(m.totalCriteria).toBe(0);
    expect(m.calculatedScore).toBe(0);
    expect(m.expectedVerdict).toBe('BLOCKED');
  });

  it('partial counts half and clamps 0..100', () => {
    const m = computeScorecardMetrics({
      ...base,
      criteriaResults: [
        { id: '1', criterion: 'a', status: 'PARTIALLY_MET', evidence: 'e', lineReferences: [] },
      ],
    });
    expect(m.calculatedScore).toBe(50);
    expect(m.expectedVerdict).toBe('NEEDS_REVISION');
  });

  it('scope penalty never drops below 0', () => {
    const m = computeScorecardMetrics({
      criteriaResults: [],
      scopeIntegrity: { strictlyInScope: false, unauthorizedFiles: ['x'], explanation: 'v' },
      blastRadius: base.blastRadius,
    });
    expect(m.calculatedScore).toBe(0);
    expect(m.scopePenalty).toBe(35);
  });
});

describe('forceScopeIntegrity / reconcile', () => {
  it('union is add-only and appends sanitizer confirmation', () => {
    const s = forceScopeIntegrity(
      { strictlyInScope: true, unauthorizedFiles: ['a.ts'], explanation: 'model says drift' },
      ['b.ts']
    );
    expect(s.strictlyInScope).toBe(false);
    expect(s.unauthorizedFiles).toEqual(expect.arrayContaining(['a.ts', 'b.ts']));
    expect(s.explanation).toMatch(/sanitizer/i);
  });

  it('reconcile caps model READY to NEEDS_REVISION/BLOCKED on scope violation', () => {
    const r = reconcileAuditReport(base, ['evil.ts']);
    expect(r.scopeIntegrity.strictlyInScope).toBe(false);
    expect(r.mergeVerdict.status).not.toBe('READY_TO_MERGE');
  });
});

describe('pickNextDecision / sentences cover all branches', () => {
  it('maps verdict+scope to four decisions', () => {
    expect(pickNextDecision({ verdict: 'READY_TO_MERGE', unauthorizedCount: 5 })).toBe('merge');
    expect(pickNextDecision({ verdict: 'NEEDS_REVISION', unauthorizedCount: 2 })).toBe('revert_scope');
    expect(pickNextDecision({ verdict: 'BLOCKED', unauthorizedCount: 0 })).toBe('blocked');
    expect(pickNextDecision({ verdict: 'NEEDS_REVISION', unauthorizedCount: 0 })).toBe('remediate');
  });

  it('sentences mention branch when supplied', () => {
    expect(nextDecisionSentence('merge')).toMatch(/consistent/i);
    expect(nextDecisionSentence('revert_scope', 'feat/x')).toContain('feat/x');
    expect(nextDecisionSentence('blocked')).toMatch(/do not merge/i);
    expect(nextDecisionSentence('remediate')).toMatch(/remediate/i);
  });

  it('isDocOnlyPath distinguishes docs', () => {
    expect(isDocOnlyPath('README.md')).toBe(true);
    expect(isDocOnlyPath('src/a.ts')).toBe(false);
  });

  it('formatScorecardSummary handles in-scope model-only risk', () => {
    const grade = buildAuditGrade({
      ...base,
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'clean' },
    });
    const summary = formatScorecardSummary(grade, { ...base, scopeIntegrity: grade.diffFacts ? base.scopeIntegrity : base.scopeIntegrity } as never);
    expect(summary).toContain('in scope');
    expect(summary).toContain('Next:');
  });
});
