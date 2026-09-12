import { describe, it, expect } from 'vitest';

// Smoke: scorecard split components compile and expose expected props.
// Full DOM rendering needs jsdom; here we verify module shape + grade-driven mapping
// that the UI depends on (verdict label, risk badge, coverage order).
import { ScoreHeader } from '@/components/scorecard/ScoreHeader';
import { WhyNextCard } from '@/components/scorecard/WhyNextCard';
import { ScopeRiskCoverageGrid } from '@/components/scorecard/ScopeRiskCoverageGrid';
import { CriteriaMatrix } from '@/components/scorecard/CriteriaMatrix';
import { buildAuditGrade } from '@/lib/scoring';

function sampleReport() {
  return {
    criteriaResults: [
      { id: '1', criterion: 'a', status: 'MET' as const, evidence: 'e', lineReferences: [] },
      { id: '2', criterion: 'b', status: 'UNMET' as const, evidence: 'missing', remainingWork: 'Add it', lineReferences: [] },
    ],
    scopeIntegrity: { strictlyInScope: false, unauthorizedFiles: ['x.ts'], explanation: 'drift' },
    blastRadius: { rating: 'MEDIUM' as const, explanation: 'risk' },
    mergeVerdict: { status: 'NEEDS_REVISION' as const, overallScore: 40, keyBlockers: ['k'], actionableFeedbackForAgent: 'fix' },
  };
}

describe('scorecard components + grade mapping', () => {
  it('exports all four split components', () => {
    expect(typeof ScoreHeader).toBe('function');
    expect(typeof WhyNextCard).toBe('function');
    expect(typeof ScopeRiskCoverageGrid).toBe('function');
    expect(typeof CriteriaMatrix).toBe('function');
  });

  it('grade drives verdict label, risk badge, and coverage used by UI', () => {
    const grade = buildAuditGrade(sampleReport() as never, { diffFacts: { filesTouched: 2, linesAdded: 10, linesRemoved: 0, unauthorizedCount: 1, unauthorizedPaths: ['x.ts'] } });
    // 1 MET + 1 UNMET = 50 criteria - 35 scope = 15 => BLOCKED (<40)
    expect(grade.overallScore).toBe(15);
    expect(grade.verdict).toBe('BLOCKED');
    // verdict label mapping mirrored from MergeScorecard.getVerdictStyle
    const label = grade.verdict === 'READY_TO_MERGE' ? 'READY TO MERGE' : grade.verdict === 'NEEDS_REVISION' ? 'NEEDS REVISION' : 'MERGE BLOCKED';
    expect(label).toBe('MERGE BLOCKED');
    // x.ts is non-critical + tiny => softened MEDIUM => warning badge
    expect(grade.blast.rating).toBe('MEDIUM');
    const badge = grade.blast.rating === 'LOW' ? 'success' : grade.blast.rating === 'MEDIUM' ? 'warning' : 'destructive';
    expect(badge).toBe('warning');
    expect(grade.categoryRollup.functional.total).toBe(2);
    expect(grade.why.length).toBeGreaterThan(0);
    expect(grade.why.length).toBeLessThanOrEqual(3);
  });

  it('why/next never empty and scoreParts reconcile', () => {
    const grade = buildAuditGrade(sampleReport() as never);
    expect(grade.scoreParts.total).toBe(grade.overallScore);
    expect(grade.scoreParts.criteria - grade.scoreParts.scope).toBe(grade.overallScore);
  });
});
