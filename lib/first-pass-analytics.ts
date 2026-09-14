import { AcceptanceCriterion, Blueprint, RepoInspectionResult } from '@/types';
import { lintCriteria, lintObjective } from '@/lib/contract-lint';
import { OutcomeLogRow } from '@/lib/outcome-memory';

/**
 * P2 learning loop: compact first-pass features captured at dispatch,
 * completed with the audit verdict in Stage 2. Used to answer
 * “which intake patterns correlate with READY_TO_MERGE first try?”
 * without ever storing prompts, diffs, or keys.
 */
export interface FirstPassFeatures {
  objectiveChars: number;
  objectiveHasVerb: boolean;
  objectiveHasWhere: boolean;
  objectiveHasVerification: boolean;
  criteriaTotal: number;
  criteriaFunctional: number;
  criteriaTesting: number;
  criteriaSecurity: number;
  criteriaConstraint: number;
  boundaryCount: number;
  boundaryMatched: number;
  boundaryUnmatched: number;
  filesToReadCount: number;
  hasTestCommand: boolean;
  framework: string;
  language: string;
  treeSize: number;
  warningCount: number;
}

export function buildFirstPassFeatures(input: {
  blueprint: Blueprint;
  repoInspection?: RepoInspectionResult | null;
  boundaries?: string[];
  warnings?: string[];
  filesToReadCount?: number;
}): FirstPassFeatures {
  const { blueprint, repoInspection, boundaries, warnings } = input;
  const criteria: AcceptanceCriterion[] = Array.isArray(blueprint.criteria)
    ? blueprint.criteria
    : [];
  const obj = lintObjective(blueprint.objective || '');
  const crit = lintCriteria(criteria);
  const treePaths =
    (repoInspection as { treePaths?: string[] } | null)?.treePaths ||
    repoInspection?.treePreview ||
    [];
  const treeSize = Array.isArray(treePaths) ? treePaths.length : 0;
  const boundaryList = Array.isArray(boundaries)
    ? boundaries
    : Array.isArray(blueprint.fileBoundaries)
      ? blueprint.fileBoundaries
      : [];
  // Matched = boundary prefix hits at least one tree path (same heuristic as lint).
  let matched = 0;
  const lowerTree = treePaths.map((p) => (p || '').toLowerCase());
  for (const b of boundaryList) {
    const clean = (b || '').trim().replace(/^\.\//, '').toLowerCase();
    const cut = clean.search(/[*?[\]{}]/);
    const prefix = (cut === -1 ? clean : clean.slice(0, cut)).replace(/\/+$/, '');
    if (!prefix) {
      matched += 1;
      continue;
    }
    if (lowerTree.some((p) => p.startsWith(prefix) || p === prefix)) matched += 1;
  }
  const keyFiles = repoInspection?.keyFiles as
    | { testCommand?: string; framework?: string }
    | undefined;

  return {
    objectiveChars: (blueprint.objective || '').trim().length,
    objectiveHasVerb: obj.hasVerb,
    objectiveHasWhere: obj.hasWhere,
    objectiveHasVerification: obj.hasVerification,
    criteriaTotal: criteria.length,
    criteriaFunctional: crit.counts.functional || 0,
    criteriaTesting: crit.counts.testing || 0,
    criteriaSecurity: crit.counts.security || 0,
    criteriaConstraint: crit.counts.constraint || 0,
    boundaryCount: boundaryList.length,
    boundaryMatched: matched,
    boundaryUnmatched: Math.max(0, boundaryList.length - matched),
    filesToReadCount:
      typeof input.filesToReadCount === 'number'
        ? input.filesToReadCount
        : Math.min(6, Math.max(0, matched)),
    hasTestCommand: Boolean((keyFiles?.testCommand || '').trim()),
    framework: (keyFiles?.framework || 'unknown').slice(0, 32),
    language: (repoInspection?.primaryLanguage || 'unknown').slice(0, 32),
    treeSize,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
  };
}

export type OutcomeRowWithFeatures = OutcomeLogRow & {
  firstPass?: FirstPassFeatures;
};

/** Appends a row carrying first-pass features (P2). Falls back to plain append when storage is unavailable. */
export function recordOutcomeRowWithFeatures(
  row: OutcomeLogRow,
  features: FirstPassFeatures
): OutcomeRowWithFeatures[] {
  try {
    const raw =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem('repopilot_outcome_log')
        : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const list: OutcomeRowWithFeatures[] = Array.isArray(parsed)
      ? (parsed as OutcomeRowWithFeatures[])
      : [];
    const next = [...list, { ...row, firstPass: features }];
    const capped = next.length > 50 ? next.slice(next.length - 50) : next;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem('repopilot_outcome_log', JSON.stringify(capped));
      } catch {
        // Storage full — in-memory flow continues.
      }
    }
    return capped;
  } catch {
    return [{ ...row, firstPass: features }];
  }
}

/**
 * Counts completed first-pass runs from the outcome log.
 *
 * This intentionally relies only on the stable outcome-row fields so historical
 * rows created before first-pass feature capture remain part of the denominator.
 */
export function countFirstPassReady(rows: OutcomeLogRow[]): { ready: number; total: number } {
  let ready = 0;
  let total = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.turn !== 'initial') continue;
    total += 1;
    if (row.verdict === 'READY_TO_MERGE') ready += 1;
  }

  return { ready, total };
}

export interface FirstPassSlice {
  key: string;
  total: number;
  ready: number;
  readyRate: number;
}

/**
 * Monthly-review helper: READY rate sliced by intake pattern.
 * Pure + tiny — call from a console script or a future admin view, never in the hot path.
 */
export function summarizeFirstPassOutcomes(rows: OutcomeRowWithFeatures[]): FirstPassSlice[] {
  const groups = new Map<string, { total: number; ready: number }>();
  const bump = (key: string, verdict?: OutcomeRowWithFeatures['verdict']) => {
    const g = groups.get(key) || { total: 0, ready: 0 };
    g.total += 1;
    if (verdict === 'READY_TO_MERGE') g.ready += 1;
    groups.set(key, g);
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.turn !== 'initial' || !row.firstPass) continue;
    const f = row.firstPass;
    bump(`testCommand:${f.hasTestCommand ? 'yes' : 'no'}`, row.verdict);
    bump(
      `boundaries:${f.boundaryUnmatched > 0 ? 'has-unmatched' : 'all-matched'}`,
      row.verdict
    );
    const balanced =
      f.criteriaFunctional > 0 && f.criteriaTesting > 0 && f.criteriaConstraint > 0
        ? 'balanced'
        : 'unbalanced';
    bump(`criteria:${balanced}`, row.verdict);
    bump(`objective:${f.objectiveHasVerification ? 'verified' : 'vague'}`, row.verdict);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      total: g.total,
      ready: g.ready,
      readyRate: g.total > 0 ? Math.round((g.ready / g.total) * 100) / 100 : 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
