import {
  CriterionResult,
  ScopeIntegrity,
  BlastRadius,
  GeminiAuditReport,
  MergeVerdict,
} from '@/types';

export interface ScorecardMetrics {
  totalCriteria: number;
  metCriteria: number;
  partiallyMetCriteria: number;
  unmetCriteria: number;
  complianceRatio: number;
  scopePenalty: number;
  calculatedScore: number;
  expectedVerdict: 'READY_TO_MERGE' | 'NEEDS_REVISION' | 'BLOCKED';
}

/**
 * Computes deterministic scorecard metrics and verdict from an audit report.
 * Ensures scoring is grounded in verifiable criteria verification and anti-drift boundaries,
 * rather than relying solely on arbitrary model hallucinations.
 */
export function computeScorecardMetrics(
  report: Pick<GeminiAuditReport, 'criteriaResults' | 'scopeIntegrity' | 'blastRadius'>
): ScorecardMetrics {
  const criteria = report.criteriaResults || [];
  const totalCriteria = criteria.length;
  const metCriteria = criteria.filter((c) => c.status === 'MET').length;
  const partiallyMetCriteria = criteria.filter((c) => c.status === 'PARTIALLY_MET').length;
  const unmetCriteria = criteria.filter((c) => c.status === 'UNMET').length;

  const complianceRatio =
    totalCriteria > 0 ? (metCriteria + partiallyMetCriteria * 0.5) / totalCriteria : 0;

  // Scope violation penalty: 35 point deduction if out-of-scope files were touched
  const isStrictlyInScope = report.scopeIntegrity?.strictlyInScope ?? true;
  const scopePenalty = isStrictlyInScope ? 0 : 35;

  let calculatedScore = Math.round(complianceRatio * 100 - scopePenalty);
  calculatedScore = Math.max(0, Math.min(100, calculatedScore));

  let expectedVerdict: 'READY_TO_MERGE' | 'NEEDS_REVISION' | 'BLOCKED';
  if (!isStrictlyInScope || unmetCriteria > 0 || calculatedScore < 60) {
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
    complianceRatio,
    scopePenalty,
    calculatedScore,
    expectedVerdict,
  };
}

/**
 * Reconciles Gemini model evaluation output with deterministic scoring calculations.
 * Protects against model score drift or over-optimistic verdicts.
 */
export function reconcileAuditReport(
  rawReport: {
    criteriaResults: CriterionResult[];
    scopeIntegrity: ScopeIntegrity;
    blastRadius: BlastRadius;
    mergeVerdict: MergeVerdict;
  }
): {
  criteriaResults: CriterionResult[];
  scopeIntegrity: ScopeIntegrity;
  blastRadius: BlastRadius;
  mergeVerdict: MergeVerdict;
} {
  const metrics = computeScorecardMetrics(rawReport);

  const finalScore = metrics.calculatedScore;
  const finalVerdict = metrics.expectedVerdict;

  return {
    ...rawReport,
    mergeVerdict: {
      ...rawReport.mergeVerdict,
      status: finalVerdict,
      overallScore: finalScore,
    },
  };
}
