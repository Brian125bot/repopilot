import {
  AcceptanceCriterion,
  AuditDiffFacts,
  AuditGrade,
  BlastRadius,
  CategoryCounts,
  CriterionCategory,
  CriterionResult,
  GeminiAuditReport,
  MergeVerdict,
  NextAuditDecision,
  ScopeIntegrity,
} from '@/types';

/** Line-volume bands claimed by the evaluation prompt (lib/gemini.ts). */
export const BLAST_LOW_MAX_LINES = 149;
export const BLAST_MEDIUM_MAX_LINES = 500;

/** Shared diff context budget (chars). Single source: lib/diff-sanitizer.ts. */
export { MAX_DIFF_CHAR_BUDGET as MAX_EVALUATE_DIFF_CHARS } from '@/lib/diff-sanitizer';

/**
 * Paths whose unauthorized touch is always HIGH risk, regardless of volume.
 * Covers dependency manifests, containers/secrets, build configs, data-plane
 * migrations, and auth/security hotspots.
 */
export const CRITICAL_UNAUTHORIZED_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i,
  /(^|\/)Dockerfile(\..*)?$/i,
  /(^|\/)docker-compose.*\.ya?ml$/i,
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)(tsconfig.*\.json|next\.config\..*|vite\.config\..*|webpack\.config\..*|eslint.*|prettier.*)$/i,
  /(^|\/)(prisma\/schema\.prisma|migrations?\/.*)$/i,
  /auth/i,
  /security/i,
];

/** Doc/test-only paths — unauthorized but never HIGH on their own when small. */
export const DOC_ONLY_PATH_PATTERN =
  /\.(md|markdown|txt|rst)$/i;

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
 * Single source of headline math: compliance = (MET + 0.5*PARTIAL)/total,
 * minus flat 35 scope penalty, clamped 0–100. buildAuditGrade() derives from
 * this — never duplicate the formula.
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
 * Normalizes criterion ids so `CRIT-1`, `crit_1`, `01`, `1` all join to `1`.
 * Blueprint list wins over model-authored ids.
 */
export function normalizeCriterionId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim().toLowerCase();
  // Longest prefix first so `criterion-2` does not lose `crit` then miss.
  s = s.replace(/^criterion[-_:\s]*/, '');
  s = s.replace(/^crit[-_:\s]*/, '');
  s = s.replace(/^0+(?=\d)/, '');
  return s.trim();
}

/**
 * Add-only union of unauthorized path lists. Empty array = clean, omitted /
 * non-array inputs are ignored (never clear re-derived hits).
 */
export function unionUnauthorizedPaths(
  ...lists: (string[] | undefined | null)[]
): string[] {
  const seen = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed && !seen.has(trimmed)) seen.add(trimmed);
    }
  }
  return [...seen];
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
  const unauthorizedFiles = unionUnauthorizedPaths(sanitizerPaths, declared);

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

const CATEGORIES: CriterionCategory[] = ['functional', 'security', 'testing', 'constraint'];

function emptyCounts(): CategoryCounts {
  return { met: 0, partial: 0, unmet: 0, total: 0 };
}

function snippet(value: string, maxChars: number): string {
  const flat = (value || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

/**
 * Stamps Stage 1 categories onto audit rows by normalized criterion id.
 * Model-authored category is ignored — the blueprint list wins.
 * Unknown ids fall back to the row's own category, then functional.
 * No positional (index+1) guessing: a mismatched id is a miss, not a silent
 * remap to an unrelated blueprint row.
 */
export function attachCriterionCategories(
  results: CriterionResult[],
  criteria: AcceptanceCriterion[] | undefined
): CriterionResult[] {
  const byId = new Map<string, CriterionCategory>();
  for (const item of criteria || []) {
    const key = normalizeCriterionId(item?.id);
    if (key) byId.set(key, item.category || 'functional');
  }
  return (results || []).map((row) => {
    const direct = byId.get(normalizeCriterionId(row.id));
    return {
      ...row,
      category: direct || row.category || 'functional',
    };
  });
}

/** True when an unauthorized path touches dependency, config, secret, migration, or auth/security surface. */
export function isCriticalUnauthorizedPath(path: string): boolean {
  const value = (path || '').trim();
  if (!value) return false;
  return CRITICAL_UNAUTHORIZED_PATTERNS.some((re) => re.test(value));
}

/** True for doc-only paths (markdown/text) — unauthorized but low severity on their own. */
export function isDocOnlyPath(path: string): boolean {
  return DOC_ONLY_PATH_PATTERN.test((path || '').trim());
}

export interface GroundBlastOptions {
  /** Unauthorized paths for severity weighting. Falls back to facts.unauthorizedPaths. */
  unauthorizedPaths?: string[];
}

/**
 * Grounds blast rating in sanitizer line/file facts with severity weighting.
 * - Critical unauthorized (package.json, lockfiles, Dockerfile, .env, configs,
 *   migrations, auth/security) → always HIGH.
 * - Non-critical unauthorized → at least MEDIUM (softened from legacy force-HIGH),
 *   HIGH only when volume > 500.
 * - In-scope volume uses the same 150 / 500 bands as the evaluation prompt.
 */
export function groundBlastRating(
  facts: AuditDiffFacts,
  opts?: GroundBlastOptions
): BlastRadius['rating'] {
  const unauthorizedCount = facts.unauthorizedCount || 0;
  const volume = (facts.linesAdded || 0) + (facts.linesRemoved || 0);
  const paths =
    (opts?.unauthorizedPaths && opts.unauthorizedPaths.length > 0
      ? opts.unauthorizedPaths
      : facts.unauthorizedPaths) || [];

  if (unauthorizedCount > 0 || paths.length > 0) {
    if (paths.some(isCriticalUnauthorizedPath)) return 'HIGH';
    if (volume > BLAST_MEDIUM_MAX_LINES) return 'HIGH';
    return 'MEDIUM';
  }
  if (volume <= BLAST_LOW_MAX_LINES) return 'LOW';
  if (volume <= BLAST_MEDIUM_MAX_LINES) return 'MEDIUM';
  return 'HIGH';
}

export function pickNextDecision(input: {
  verdict: MergeVerdict['status'];
  unauthorizedCount: number;
}): NextAuditDecision {
  if (input.verdict === 'READY_TO_MERGE') return 'merge';
  if (input.unauthorizedCount > 0) return 'revert_scope';
  if (input.verdict === 'BLOCKED') return 'blocked';
  return 'remediate';
}

export function nextDecisionSentence(decision: NextAuditDecision, branch?: string): string {
  const branchRef = branch ? `\`${branch}\`` : 'the audited branch';
  switch (decision) {
    case 'merge':
      return 'Merge is consistent with this contract.';
    case 'revert_scope':
      return `Revert out-of-scope files, then remediate open criteria on ${branchRef}.`;
    case 'blocked':
      return 'Do not merge. Address blockers before another dispatch.';
    default:
      return `Remediate open criteria on ${branchRef}.`;
  }
}

export function sortCriteriaForDecision(results: CriterionResult[]): CriterionResult[] {
  const rank: Record<CriterionResult['status'], number> = {
    UNMET: 0,
    PARTIALLY_MET: 1,
    MET: 2,
  };
  return [...(results || [])].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
}

/** Extracts the `path` token from `path:lines` refs (e.g. "src/a.ts:12-20"). Null when unparseable. */
export function extractPathFromReference(ref: string): string | null {
  const match =
    /^\s*([A-Za-z0-9_@.\-][A-Za-z0-9_@.\-/]*\.[A-Za-z0-9]{1,5})(?::|$)/.exec(
      ref || ''
    );
  return match ? match[1] : null;
}

/**
 * Partitions model-cited refs into verified (path in sanitizer touchedPaths)
 * vs unverified (path absent). Empty touchedPaths disables validation — all
 * refs pass through as verified so old reports without diffFacts never regress.
 */
export function partitionLineReferences(
  references: string[] | undefined,
  touchedPaths: string[] | undefined
): { verified: string[]; unverified: string[] } {
  const refs = Array.isArray(references) ? references : [];
  const touched = Array.isArray(touchedPaths) ? touchedPaths : [];
  if (touched.length === 0) return { verified: [...refs], unverified: [] };
  const touchedSet = new Set(touched.map((p) => (p || '').trim()).filter(Boolean));
  // Case-insensitive fallback for Windows-style or sanitizer prefix drift.
  const lowered = new Set([...touchedSet].map((p) => p.toLowerCase()));
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const ref of refs) {
    const path = extractPathFromReference(ref);
    if (!path) {
      unverified.push(ref);
      continue;
    }
    const clean = path.replace(/^[ab]\//, '').trim();
    if (touchedSet.has(path) || touchedSet.has(clean) || lowered.has(clean.toLowerCase())) {
      verified.push(ref);
    } else {
      unverified.push(ref);
    }
  }
  return { verified, unverified };
}

/**
 * Stamps `unverifiedReferences` on rows whose citations miss the sanitizer
 * touched list. Never fails the audit — UI renders “cited, not in diff”.
 */
export function withVerifiedLineReferences(
  results: CriterionResult[],
  touchedPaths: string[] | undefined
): CriterionResult[] {
  const touched = Array.isArray(touchedPaths) ? touchedPaths : [];
  if (touched.length === 0) return results || [];
  return (results || []).map((row) => {
    const { unverified } = partitionLineReferences(row.lineReferences, touched);
    if (unverified.length === 0) {
      const { unverifiedReferences: _dropped, ...rest } = row;
      return rest;
    }
    return { ...row, unverifiedReferences: unverified };
  });
}

function buildWhy(input: {
  verdict: MergeVerdict['status'];
  overallScore: number;
  scopePenalty: number;
  unauthorized: string[];
  open: CriterionResult[];
}): string[] {
  const why: string[] = [];
  if (input.verdict === 'READY_TO_MERGE') {
    why.push('All criteria MET and the diff stayed inside declared boundaries.');
    return why;
  }
  if (input.scopePenalty > 0) {
    const listed = input.unauthorized.slice(0, 4).join(', ');
    const extra = input.unauthorized.length > 4 ? ', …' : '';
    why.push(
      `Scope penalty −${input.scopePenalty}${listed ? ` (${listed}${extra})` : ''}. Unauthorized files never READY.`
    );
  }
  if (input.open.length > 0) {
    const first = input.open[0];
    const remaining = snippet(first.remainingWork || first.evidence || first.criterion, 140);
    why.push(`Criterion ${first.id} ${first.status}${remaining ? `: ${remaining}` : '.'}`);
  }
  if (why.length === 0) {
    why.push(`Score ${input.overallScore}/100 · ${input.verdict}.`);
  }
  return why.slice(0, 3);
}

export interface BuildAuditGradeExtras {
  criteria?: AcceptanceCriterion[];
  diffFacts?: AuditDiffFacts;
  /** Authoritative touched list for severity + line-ref validation. Falls back to diffFacts/report. */
  touchedPaths?: string[];
  /** Unauthorized list for severity weighting. Falls back to scopeIntegrity + diffFacts. */
  unauthorizedPaths?: string[];
}

/**
 * Operator-facing grade: derives headline math from computeScorecardMetrics
 * (single source), plus breakdown, category rollup, severity-grounded blast,
 * and next decision. Does not write mergeVerdict — use attachAuditGrade()
 * server-side to sync verdict+score+grade in one step.
 */
export function buildAuditGrade(
  report: Pick<GeminiAuditReport, 'criteriaResults' | 'scopeIntegrity' | 'blastRadius' | 'mergeVerdict' | 'diffFacts'>,
  extras?: BuildAuditGradeExtras
): AuditGrade {
  const stamped = attachCriterionCategories(report.criteriaResults || [], extras?.criteria);
  const metrics = computeScorecardMetrics({
    criteriaResults: stamped,
    scopeIntegrity: report.scopeIntegrity,
    blastRadius: report.blastRadius,
  });

  const criteriaScore = Math.round(metrics.complianceRatio * 100);
  const overallScore = metrics.calculatedScore;
  const verdict = metrics.expectedVerdict;
  const unauthorized = unionUnauthorizedPaths(
    report.scopeIntegrity?.unauthorizedFiles,
    extras?.unauthorizedPaths,
    extras?.diffFacts?.unauthorizedPaths,
    report.diffFacts?.unauthorizedPaths
  );

  const categoryRollup = Object.fromEntries(CATEGORIES.map((key) => [key, emptyCounts()])) as Record<
    CriterionCategory,
    CategoryCounts
  >;
  for (const row of stamped) {
    const key: CriterionCategory = CATEGORIES.includes(row.category as CriterionCategory)
      ? (row.category as CriterionCategory)
      : 'functional';
    const bucket = categoryRollup[key];
    bucket.total += 1;
    if (row.status === 'MET') bucket.met += 1;
    else if (row.status === 'PARTIALLY_MET') bucket.partial += 1;
    else bucket.unmet += 1;
  }

  const diffFacts = extras?.diffFacts || report.diffFacts;
  let blast: AuditGrade['blast'];
  if (diffFacts) {
    const rating = groundBlastRating(diffFacts, { unauthorizedPaths: unauthorized });
    const volume = (diffFacts.linesAdded || 0) + (diffFacts.linesRemoved || 0);
    blast = {
      rating,
      explanation:
        report.blastRadius?.explanation ||
        `${diffFacts.filesTouched} files, +${diffFacts.linesAdded}/−${diffFacts.linesRemoved} (${volume} lines).`,
      grounded: true,
    };
  } else {
    blast = {
      rating: report.blastRadius?.rating || 'MEDIUM',
      explanation: report.blastRadius?.explanation || '',
      grounded: false,
    };
  }

  const open = sortCriteriaForDecision(stamped.filter((c) => c.status !== 'MET'));
  const nextDecision = pickNextDecision({
    verdict,
    unauthorizedCount: unauthorized.length || diffFacts?.unauthorizedCount || 0,
  });

  return {
    met: metrics.metCriteria,
    partial: metrics.partiallyMetCriteria,
    unmet: metrics.unmetCriteria,
    total: metrics.totalCriteria,
    criteriaScore,
    scopePenalty: metrics.scopePenalty,
    overallScore,
    verdict,
    scoreParts: {
      criteria: criteriaScore,
      scope: metrics.scopePenalty,
      total: overallScore,
    },
    categoryRollup,
    diffFacts: diffFacts
      ? {
          ...diffFacts,
          unauthorizedCount:
            unauthorized.length > 0
              ? unauthorized.length
              : diffFacts.unauthorizedCount,
          unauthorizedPaths:
            unauthorized.length > 0 ? unauthorized : diffFacts.unauthorizedPaths,
        }
      : undefined,
    blast,
    nextDecision,
    why: buildWhy({
      verdict,
      overallScore,
      scopePenalty: metrics.scopePenalty,
      unauthorized,
      open,
    }),
  };
}

export interface AttachAuditGradeExtras extends BuildAuditGradeExtras {}

export type GradedAuditReport = GeminiAuditReport & { grade: AuditGrade };

/**
 * Server single-truth helper: stamps categories, validates line refs against
 * the sanitizer touched list, builds the grade, and syncs
 * mergeVerdict.status/overallScore from grade.verdict/overallScore.
 * UI renders report.grade and must not recompute when present.
 */
export function attachAuditGrade(
  report: Pick<
    GeminiAuditReport,
    'criteriaResults' | 'scopeIntegrity' | 'blastRadius' | 'mergeVerdict' | 'diffFacts'
  > &
    Partial<GeminiAuditReport>,
  extras?: AttachAuditGradeExtras
): GradedAuditReport {
  const stamped = attachCriterionCategories(report.criteriaResults || [], extras?.criteria);
  const touched =
    (extras?.touchedPaths && extras.touchedPaths.length > 0
      ? extras.touchedPaths
      : undefined) ||
    extras?.diffFacts?.touchedPaths ||
    report.diffFacts?.touchedPaths ||
    [];
  const verified =
    touched.length > 0 ? withVerifiedLineReferences(stamped, touched) : stamped;
  const base = { ...report, criteriaResults: verified };
  const grade = buildAuditGrade(base, extras);
  return {
    ...(base as GeminiAuditReport),
    diffFacts: grade.diffFacts ?? base.diffFacts,
    mergeVerdict: {
      ...(base.mergeVerdict as MergeVerdict),
      status: grade.verdict,
      overallScore: grade.overallScore,
    },
    grade,
  };
}

export function formatScorecardSummary(grade: AuditGrade, report: GeminiAuditReport): string {
  const unauthorized = unionUnauthorizedPaths(
    report.scopeIntegrity?.unauthorizedFiles,
    grade.diffFacts?.unauthorizedPaths
  );
  const open = sortCriteriaForDecision((report.criteriaResults || []).filter((c) => c.status !== 'MET'));
  const lines = [
    `RepoPilot Scorecard: ${grade.verdict} (${grade.overallScore}/100)`,
    `${grade.overallScore} = ${grade.scoreParts.criteria} criteria − ${grade.scoreParts.scope} scope`,
    `MET ${grade.met} · PARTIAL ${grade.partial} · UNMET ${grade.unmet} of ${grade.total}`,
  ];
  if (grade.scopePenalty > 0) {
    lines.push(`Scope: violated (${unauthorized.join(', ') || `${grade.diffFacts?.unauthorizedCount ?? 0} files`})`);
  } else {
    lines.push('Scope: in scope');
  }
  if (grade.diffFacts) {
    const truncatedSuffix = grade.diffFacts.truncated ? ' · truncated' : '';
    lines.push(
      `Change risk: ${grade.blast.rating} · ${grade.diffFacts.filesTouched} files · +${grade.diffFacts.linesAdded}/−${grade.diffFacts.linesRemoved}${truncatedSuffix}`
    );
  } else {
    lines.push(`Change risk: ${grade.blast.rating}${grade.blast.grounded ? '' : ' (model)'}`);
  }
  lines.push(`Next: ${grade.nextDecision}`);
  for (const row of open.slice(0, 3)) {
    const remaining = snippet(row.remainingWork || row.evidence || '', 160);
    lines.push(`Open: [${row.status}] ${row.id} ${row.criterion}${remaining ? ` — remaining: ${remaining}` : ''}`);
  }
  return lines.join('\n');
}
