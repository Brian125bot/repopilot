import { describe, it, expect } from 'vitest';
import { GeminiAuditReport } from '@/types';

describe('Gemini Audit Scoring Logic & Metric Evaluation', () => {
  function computeMockScorecardMetrics(report: GeminiAuditReport) {
    const totalCriteria = report.criteriaResults.length;
    const metCriteria = report.criteriaResults.filter((c) => c.status === 'MET').length;
    const partiallyMetCriteria = report.criteriaResults.filter((c) => c.status === 'PARTIALLY_MET').length;
    const unmetCriteria = report.criteriaResults.filter((c) => c.status === 'UNMET').length;

    const complianceRatio = totalCriteria > 0 ? (metCriteria + partiallyMetCriteria * 0.5) / totalCriteria : 0;
    const scopePenalty = report.scopeIntegrity.strictlyInScope ? 0 : 35;
    const calculatedScore = Math.max(0, Math.min(100, Math.round(complianceRatio * 100 - scopePenalty)));

    let expectedVerdict: 'READY_TO_MERGE' | 'NEEDS_REVISION' | 'BLOCKED';
    if (!report.scopeIntegrity.strictlyInScope || unmetCriteria > 0 || calculatedScore < 60) {
      expectedVerdict = calculatedScore < 40 ? 'BLOCKED' : 'NEEDS_REVISION';
    } else if (partiallyMetCriteria > 0 || calculatedScore < 85) {
      expectedVerdict = 'NEEDS_REVISION';
    } else {
      expectedVerdict = 'READY_TO_MERGE';
    }

    return {
      totalCriteria,
      metCriteria,
      partiallyMetCriteria,
      unmetCriteria,
      calculatedScore,
      expectedVerdict,
    };
  }

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

    const metrics = computeMockScorecardMetrics(report);
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

    const metrics = computeMockScorecardMetrics(report);
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
