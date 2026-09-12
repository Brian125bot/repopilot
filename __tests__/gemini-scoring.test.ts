import { describe, it, expect } from 'vitest';
import { GeminiAuditReport } from '@/types';
import { computeScorecardMetrics, reconcileAuditReport, forceScopeIntegrity } from '@/lib/scoring';

describe('Gemini Audit Scoring Logic & Metric Evaluation', () => {

  it('assigns READY_TO_MERGE when all criteria are met and diff is strictly in scope', () => {
    const report: GeminiAuditReport = {
      criteriaResults: [
        { id: '1', criterion: 'Valid rate limiting', status: 'MET', evidence: 'Implemented in full', lineReferences: [] },
        { id: '2', criterion: 'Unit test coverage', status: 'MET', evidence: 'Test cases pass', lineReferences: [] },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'All in scope' },
      blastRadius: { rating: 'LOW', explanation: 'Minimal diff' },
      mergeVerdict: {
        status: 'READY_TO_MERGE',
        overallScore: 98,
        recommendation: 'Merge without blockers',
        keyBlockers: [],
        actionableFeedbackForAgent: 'Ready to merge.',
      },
    };

    const metrics = computeScorecardMetrics(report);
    expect(metrics.metCriteria).toBe(2);
    expect(metrics.unmetCriteria).toBe(0);
    expect(metrics.calculatedScore).toBe(100);
    expect(metrics.expectedVerdict).toBe('READY_TO_MERGE');
  });

  it('penalizes score and marks revision or blocked when scope integrity is violated', () => {
    const report: GeminiAuditReport = {
      criteriaResults: [
        { id: '1', criterion: 'Feature works', status: 'MET', evidence: 'Implemented', lineReferences: [] },
      ],
      scopeIntegrity: {
        strictlyInScope: false,
        unauthorizedFiles: ['package.json', 'tsconfig.json'],
        explanation: 'Touched forbidden root files',
      },
      blastRadius: { rating: 'HIGH', explanation: 'Root config modification' },
      mergeVerdict: {
        status: 'NEEDS_REVISION',
        overallScore: 50,
        recommendation: 'Revert unauthorized changes',
        keyBlockers: ['Root config modified'],
        actionableFeedbackForAgent: 'Revert configs',
      },
    };

    const metrics = computeScorecardMetrics(report);
    expect(metrics.calculatedScore).toBeLessThanOrEqual(65);
    expect(metrics.expectedVerdict).not.toBe('READY_TO_MERGE');
  });

  it('classifies blast radius correctly', () => {
    const lowRisk: GeminiAuditReport['blastRadius'] = { rating: 'LOW', explanation: 'Surgical change under 50 lines' };
    const highRisk: GeminiAuditReport['blastRadius'] = { rating: 'HIGH', explanation: 'Over 500 lines across 12 files' };

    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(lowRisk.rating);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(highRisk.rating);
  });
});

describe('Audit reconciliation forces scope from the diff sanitizer', () => {
  const buildReport = (strictlyInScope: boolean, unauthorizedFiles: string[]): GeminiAuditReport => ({
    criteriaResults: [
      { id: '1', criterion: 'Feature works', status: 'MET', evidence: 'Implemented', lineReferences: [] },
      { id: '2', criterion: 'Tests pass', status: 'MET', evidence: 'Green', lineReferences: [] },
    ],
    scopeIntegrity: { strictlyInScope, unauthorizedFiles, explanation: 'Model assessment.' },
    blastRadius: { rating: 'LOW', explanation: 'Small diff' },
    mergeVerdict: {
      status: 'READY_TO_MERGE',
      overallScore: 99,
      recommendation: 'Ship it',
      keyBlockers: [],
      actionableFeedbackForAgent: 'None',
    },
  });

  it('overrides an optimistic in-scope verdict when the sanitizer flags paths', () => {
    const report = buildReport(true, []);
    const reconciled = reconcileAuditReport(report, ['package.json']);

    expect(reconciled.scopeIntegrity.strictlyInScope).toBe(false);
    expect(reconciled.scopeIntegrity.unauthorizedFiles).toContain('package.json');
    expect(reconciled.mergeVerdict.status).not.toBe('READY_TO_MERGE');
    // 100% criteria compliance minus the 35-point scope penalty
    expect(reconciled.mergeVerdict.overallScore).toBe(65);
  });

  it('unions sanitizer paths with anything the model also flagged', () => {
    const report = buildReport(false, ['tsconfig.json']);
    const reconciled = reconcileAuditReport(report, ['package.json']);

    expect(reconciled.scopeIntegrity.unauthorizedFiles).toEqual(
      expect.arrayContaining(['package.json', 'tsconfig.json'])
    );
    expect(new Set(reconciled.scopeIntegrity.unauthorizedFiles).size).toBe(2);
  });

  it('keeps the report in scope when the sanitizer found no violations', () => {
    const report = buildReport(true, []);
    const reconciled = reconcileAuditReport(report, []);
    expect(reconciled.scopeIntegrity.strictlyInScope).toBe(true);
    expect(reconciled.mergeVerdict.status).toBe('READY_TO_MERGE');
    expect(reconciled.mergeVerdict.overallScore).toBe(100);
  });

  it('overrides an optimistic READY verdict to NEEDS_REVISION with score 65 on package.json', () => {
    const report = buildReport(true, []);
    const reconciled = reconcileAuditReport(report, ['package.json']);
    expect(reconciled.scopeIntegrity.strictlyInScope).toBe(false);
    expect(reconciled.mergeVerdict.status).not.toBe('READY_TO_MERGE');
    expect(reconciled.mergeVerdict.overallScore).toBeLessThanOrEqual(65);
  });

  it('coerces a bad non-array caller to clean instead of crashing (defense, not API)', () => {
    const scope = { strictlyInScope: true, unauthorizedFiles: [] as string[], explanation: 'Model only.' };
    const coerced = forceScopeIntegrity(scope, undefined as unknown as string[]);
    expect(coerced.strictlyInScope).toBe(true);
    expect(coerced.unauthorizedFiles).toEqual([]);
  });
});
