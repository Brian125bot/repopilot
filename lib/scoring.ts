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
 * Overrides the model's scope verdict with the sanitizer's deterministic glob result.
 * The diff sanitizer mechanically matches every touched path against the declared
 * boundaries, so it outranks Gemini's opinion on whether the diff stayed in scope.
 *
 * Contract: callers pass an array every time (`[]` = clean). The Array.isArray
 * coercion below is defense against a bad caller, not the API.
 */
export function forceScopeIntegrity(
  scopeIntegrity: ScopeIntegrity,
  sanitizerUnauthorizedPaths: string[]
): ScopeIntegrity {
  const sanitizerPaths = Array.isArray(sanitizerUnauthorizedPaths)
    ? sanitizerUnauthorizedPaths
    : [];

  const declared = Array.isArray(scopeIntegrity?.unauthorizedFiles)
    ? scopeIntegrity.unauthorizedFiles
    : [];
  const unauthorizedFiles = Array.from(
    new Set([...sanitizerPaths, ...declared].filter(Boolean))
  );

  const strictlyInScope = unauthorizedFiles.length === 0;
  const explanation =
    strictlyInScope || !scopeIntegrity?.explanation
      ? scopeIntegrity?.explanation || ''
      : `${scopeIntegrity.explanation} (Scope violation confirmed by diff sanitizer: ${unauthorizedFiles.join(', ')}.)`;

  return {
    ...scopeIntegrity,
    strictlyInScope,
    unauthorizedFiles,
    explanation,
  };
}

/**
 * Reconciles Gemini model evaluation output with deterministic scoring calculations.
 * Protects against model score drift or over-optimistic verdicts.
 * Any sanitizer-flagged path forces strictlyInScope=false, the 35-pt penalty,
 * and caps the verdict at NEEDS_REVISION/BLOCKED — never READY_TO_MERGE.
 */
export function reconcileAuditReport(
  rawReport: {
    criteriaResults: CriterionResult[];
    scopeIntegrity: ScopeIntegrity;
    blastRadius: BlastRadius;
    mergeVerdict: MergeVerdict;
  },
  unauthorizedPaths: string[]
): {
  criteriaResults: CriterionResult[];
  scopeIntegrity: ScopeIntegrity;
  blastRadius: BlastRadius;
  mergeVerdict: MergeVerdict;
} {
  const paths = Array.isArray(unauthorizedPaths) ? unauthorizedPaths : [];
  const scopeIntegrity = forceScopeIntegrity(
    rawReport.scopeIntegrity,
    paths
  );
  const scoped = { ...rawReport, scopeIntegrity };

  const metrics = computeScorecardMetrics(scoped);

  const finalScore = metrics.calculatedScore;
  const finalVerdict = metrics.expectedVerdict;

  return {
    ...scoped,
    mergeVerdict: {
      ...rawReport.mergeVerdict,
      status: finalVerdict,
      overallScore: finalScore,
    },
  };
}
