import { Blueprint, FailureBrief, GeminiAuditReport, OutcomeTurn } from '@/types';
import { sortCriteriaForDecision, unionUnauthorizedPaths } from '@/lib/scoring';

export const MAX_REQUIRED_FIXES = 7;
export const MAX_CONTINUATION_CHARS = 4000;
export const OUTCOME_LOG_KEY = 'repopilot_outcome_log';
export const MAX_OUTCOME_ROWS = 50;
const TERMINAL_JULES_SESSION_STATES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'CANCELLED',
  'EXPIRED',
]);

export interface OutcomeLogRow {
  blueprintId: string;
  repo: string;
  sessionId?: string;
  turn: OutcomeTurn;
  verdict?: 'READY_TO_MERGE' | 'NEEDS_REVISION' | 'BLOCKED';
  score?: number;
  unauthorizedCount?: number;
  unmetIds?: string[];
  usedPriorSession: boolean;
  at: string;
  /** COR-40: PR head SHA locked at Evaluate time. Null blocks remediation. */
  auditedHeadSha?: string | null;
}
const EVIDENCE_SNIPPET_CHARS = 240;
const FIX_LINE_CHARS = 350;

function oneLine(value: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function snippet(value: string, maxChars: number): string {
  const flat = oneLine(value);
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

/**
 * Extracts `path` tokens from `path:lines`-style references (e.g. "src/a.ts:12-20").
 * Only tokens already present in the input are returned — paths are never invented.
 */
export function extractPathsFromReferences(references: string[]): string[] {
  const paths: string[] = [];
  for (const ref of references || []) {
    const match = /^\s*([A-Za-z0-9_@.\-][A-Za-z0-9_@.\-/]*\.[A-Za-z0-9]{1,5})(?::|$)/.exec(ref);
    if (match && !paths.includes(match[1])) paths.push(match[1]);
  }
  return paths;
}

/**
 * Builds a compact FailureBrief from a reconciled + graded audit report, the
 * dispatched blueprint, and the sanitizer's unauthorized paths (required array).
 * The unauthorized union is add-only via unionUnauthorizedPaths:
 * client paths ∪ model-flagged files ∪ grade diffFacts paths.
 * doNotTouch is that union plus paths cited only by MET criteria evidence
 * (parsed from lineReferences already on the report); without such paths it
 * is exactly the unauthorized union. No path is ever invented.
 * requiredFixes prefers remainingWork (the concrete gap) ordered UNMET →
 * PARTIAL via sortCriteriaForDecision; evidenceById prefers satisfiedAspects
 * (what already holds) so continuation prompts seal progress instead of
 * re-describing failures.
 */
export function buildFailureBrief(
  report: GeminiAuditReport,
  blueprint: Blueprint,
  unauthorizedPaths: string[],
  turn?: OutcomeTurn
): FailureBrief {
  const unionPaths = unionUnauthorizedPaths(
    unauthorizedPaths,
    report.scopeIntegrity?.unauthorizedFiles,
    report.grade?.diffFacts?.unauthorizedPaths,
    report.diffFacts?.unauthorizedPaths
  );

  const criteria = report.criteriaResults || [];
  const unmetIds = criteria.filter((c) => c.status === 'UNMET').map((c) => c.id);
  const partialIds = criteria.filter((c) => c.status === 'PARTIALLY_MET').map((c) => c.id);
  const metIds = criteria.filter((c) => c.status === 'MET').map((c) => c.id);

  const metPaths: string[] = [];
  for (const criterion of criteria) {
    if (criterion.status !== 'MET') continue;
    for (const path of extractPathsFromReferences(criterion.lineReferences || [])) {
      if (!metPaths.includes(path)) metPaths.push(path);
    }
  }
  const doNotTouch = unionUnauthorizedPaths(unionPaths, metPaths);

  // Decision-first: UNMET, then PARTIAL — same order the scorecard renders.
  const open = sortCriteriaForDecision(criteria.filter((c) => c.status !== 'MET'));
  const requiredFixes = open.slice(0, MAX_REQUIRED_FIXES).map((c) => {
    const head = `[${c.status}] Criterion ${c.id}: ${oneLine(c.criterion)}`;
    if (c.status === 'PARTIALLY_MET') {
      const satisfied = snippet(
        c.satisfiedAspects || c.evidence || '',
        EVIDENCE_SNIPPET_CHARS
      );
      const remaining = snippet(
        c.remainingWork || c.evidence || '',
        EVIDENCE_SNIPPET_CHARS
      );
      const satisfiedPart = satisfied ? ` — Satisfied: ${satisfied}` : '';
      const remainingPart = remaining ? ` → Remaining: ${remaining}` : '';
      return `${head}${satisfiedPart}${remainingPart}`;
    }
    const remaining = snippet(c.remainingWork || c.evidence || '', EVIDENCE_SNIPPET_CHARS);
    return remaining ? `${head} — Remaining: ${remaining}` : head;
  });

  const evidenceById: Record<string, string> = {};
  for (const criterion of criteria) {
    // Prefer what-holds for MET/PARTIAL so follow-ups don't reopen progress.
    const holds =
      criterion.status === 'UNMET'
        ? criterion.remainingWork || criterion.evidence
        : criterion.satisfiedAspects || criterion.evidence;
    evidenceById[criterion.id] = snippet(holds || '', EVIDENCE_SNIPPET_CHARS);
  }

  // Prefer server grade truth when present; fall back to legacy mergeVerdict.
  const verdict = report.grade?.verdict ?? report.mergeVerdict.status;
  const score = report.grade?.overallScore ?? report.mergeVerdict.overallScore;

  const auditedHeadSha =
    (blueprint.auditedHeadSha || '').trim() || (report.auditedHeadSha || '').trim() || null;

  return {
    sessionId: blueprint.sessionId,
    sessionState: blueprint.sessionState,
    prUrl: blueprint.prUrl,
    auditedHeadSha,
    verdict,
    score,
    unmetIds,
    partialIds,
    metIds,
    unauthorizedPaths: unionPaths,
    doNotTouch,
    requiredFixes,
    evidenceById,
    ...(turn ? { turn } : {}),
  };
}

/**
 * Compiles a compact continuation prompt from a blueprint + brief.
 * Restates the objective, repeats the same boundaries, seals MET criteria,
 * lists unauthorized paths as revert-only, numbers the required fixes, and
 * locks the audited branch / existing PR. Never embeds a diff, full model
 * JSON, or lockfile hunks; never mentions AUTO_CREATE_PR (remediation omits
 * that key). Body is capped at ~4000 chars excluding the contract id line.
 */
export function compileContinuationPrompt(input: {
  blueprint: Blueprint;
  brief: FailureBrief;
}): string {
  const { blueprint, brief } = input;
  // COR-40: fail-closed — never emit a prompt Jules can run from main without a locked SHA.
  if (!blueprint.auditedHeadSha?.trim()) {
    throw new Error('Cannot compile continuation prompt without an audited head SHA. Re-evaluate to lock audited head SHA.');
  }
  const prRef = brief.prUrl || blueprint.prUrl;
  const header = `<!-- CONTINUATION_CONTRACT: ${blueprint.blueprintId} -->`;

  const boundaryLines =
    blueprint.fileBoundaries && blueprint.fileBoundaries.length > 0
      ? blueprint.fileBoundaries.map((b) => `- \`${b.trim()}\``).join('\n')
      : '- (no explicit boundaries recorded; stay within the files touched by the audited branch)';

  const metSection =
    brief.metIds.length > 0
      ? brief.metIds.map((id) => `- \`${id}\`: verified MET — do not reopen, modify, or re-verify.`).join('\n')
      : '- None verified MET yet — every criterion below is still open.';

  const revertSection =
    brief.unauthorizedPaths.length > 0
      ? brief.unauthorizedPaths.map((p) => `- \`${p}\`: revert to base. No feature work here.`).join('\n')
      : '- None — every touched file is in scope.';

  const fixesSection =
    brief.requiredFixes.length > 0
      ? brief.requiredFixes
          .slice(0, MAX_REQUIRED_FIXES)
          .map((fix, i) => `${i + 1}. ${snippet(fix, FIX_LINE_CHARS)}`)
          .join('\n')
      : `No open fixes. Verdict: ${brief.verdict} (${brief.score}/100). Do not start new work and do not reopen the MET criteria above.`;

  const main = [
    '# Continuation Contract (follow-up — no new scope)',
    '',
    '## 1. Objective (restated, unchanged)',
    blueprint.objective,
    '',
    '## 2. Authorized files (unchanged)',
    boundaryLines,
    '',
    '## 3. MET criteria — do not reopen',
    metSection,
    '',
    '## 4. Revert only — do not build on these',
    revertSection,
    '',
    '## 5. Required fixes',
    fixesSection,
    '',
  ].join('\n');

  const auditedSha = blueprint.auditedHeadSha.trim();
  const lock = [
    '## 6. Branch lock',
    `Work ONLY on branch \`${blueprint.branchName}\`${prRef ? ` (PR: ${prRef})` : ''}.`,
    `LOCKED HEAD BRANCH: ${blueprint.branchName} LOCKED AUDITED SHA: ${auditedSha} If HEAD is not exactly this SHA, stop. Do not create a new branch from main. Operator must re-evaluate.`,
    'Commit and push there so the existing pull request updates.',
    'Do not create a new branch and do not open a new pull request.',
  ].join('\n');

  const budget = MAX_CONTINUATION_CHARS - lock.length - 1;
  const cappedMain = main.length > budget ? `${main.slice(0, budget - 1)}…` : main;

  return `${header}\n\n${cappedMain}\n${lock}\n`;
}

/**
 * Primary blocked-audit gate: offer "Continue Jules session" only when the
 * audit is actionable (NEEDS_REVISION or BLOCKED) AND an existing session
 * exists to continue. READY_TO_MERGE never offers continue (must not call Jules).
 */
export function shouldOfferContinueSession(
  verdict: FailureBrief['verdict'] | GeminiAuditReport['mergeVerdict']['status'] | string | null | undefined,
  blueprint?: Pick<Blueprint, 'sessionId' | 'sessionState'> | null,
  recentSessionId?: string | null
): boolean {
  const actionable = verdict === 'NEEDS_REVISION' || verdict === 'BLOCKED';
  const sessionId =
    (recentSessionId || '').trim() || (blueprint?.sessionId || '').trim();
  const sessionState = (recentSessionId ? '' : blueprint?.sessionState || '').trim().toUpperCase();
  const isLiveJulesSession = sessionId.startsWith('sessions/');
  const isTerminal = TERMINAL_JULES_SESSION_STATES.has(sessionState);
  return actionable && isLiveJulesSession && !isTerminal;
}

/**
 * Resolve the session to continue: the just-dispatched session when present,
 * else the audited blueprint session (never a fresh id).
 */
export function resolveContinueSessionId(
  blueprint?: Pick<Blueprint, 'sessionId'> | null,
  recentSessionId?: string | null
): string | null {
  const id =
    (recentSessionId || '').trim() || (blueprint?.sessionId || '').trim();
  return id ? id : null;
}

/**
 * Rebind a remediation blueprint to the session that Jules just created.
 * This intentionally replaces (rather than falls back to) every session
 * field, so a closed source session cannot remain attached after handoff.
 */
export function applyNewRemediationSession(
  blueprint: Blueprint,
  session: { sessionId: string; sessionUrl?: string | null; sessionState?: string | null }
): Blueprint {
  return {
    ...blueprint,
    sessionId: session.sessionId,
    sessionUrl: session.sessionUrl || undefined,
    sessionState: session.sessionState || undefined,
    isRemediation: true,
  };
}

/**
 * Builds one outcome-log row. Verdict fields stay empty until an audit
 * completes them via updateOutcomeRow — nothing is invented up front.
 */
export function buildOutcomeRow(input: {
  blueprint: Pick<Blueprint, 'blueprintId' | 'repo' | 'sessionId' | 'auditedHeadSha'>;
  turn: OutcomeTurn;
  usedPriorSession: boolean;
  verdict?: OutcomeLogRow['verdict'];
  score?: number;
  unauthorizedCount?: number;
  unmetIds?: string[];
  auditedHeadSha?: string | null;
  at?: string;
}): OutcomeLogRow {
  const fromInput = (input.auditedHeadSha || '').trim();
  const fromBlueprint = ((input.blueprint as { auditedHeadSha?: string | null }).auditedHeadSha || '').trim();
  const auditedHeadSha = fromInput || fromBlueprint || null;
  return {
    blueprintId: input.blueprint.blueprintId,
    repo: input.blueprint.repo,
    sessionId: input.blueprint.sessionId,
    turn: input.turn,
    verdict: input.verdict,
    score: input.score,
    unauthorizedCount: input.unauthorizedCount,
    unmetIds: input.unmetIds,
    usedPriorSession: input.usedPriorSession,
    at: input.at || new Date().toISOString(),
    auditedHeadSha,
  };
}

/**
 * Appends a row, dropping oldest rows past MAX_OUTCOME_ROWS (50).
 */
export function appendOutcomeRow(rows: OutcomeLogRow[], row: OutcomeLogRow): OutcomeLogRow[] {
  const next = [...(Array.isArray(rows) ? rows : []), row];
  return next.length > MAX_OUTCOME_ROWS ? next.slice(next.length - MAX_OUTCOME_ROWS) : next;
}

/**
 * Fills outcome fields on the most recent row matching blueprintId
 * (and sessionId when given). Non-matching rows pass through untouched.
 */
export function updateOutcomeRow(
  rows: OutcomeLogRow[],
  match: { blueprintId: string; sessionId?: string },
  patch: Partial<Pick<OutcomeLogRow, 'verdict' | 'score' | 'unauthorizedCount' | 'unmetIds' | 'auditedHeadSha'>>
): OutcomeLogRow[] {
  const list = Array.isArray(rows) ? [...rows] : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (row.blueprintId !== match.blueprintId) continue;
    if (match.sessionId && row.sessionId !== match.sessionId) continue;
    list[i] = { ...row, ...patch };
    break;
  }
  return list;
}

function readOutcomeStorage(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(OUTCOME_LOG_KEY);
  } catch {
    return null;
  }
}

/** Loads persisted rows; corrupt or missing storage yields []. */
export function loadOutcomeLog(): OutcomeLogRow[] {
  const raw = readOutcomeStorage();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OutcomeLogRow[]) : [];
  } catch {
    return [];
  }
}

function saveOutcomeLog(rows: OutcomeLogRow[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(OUTCOME_LOG_KEY, JSON.stringify(rows));
  } catch {
    // Storage full or unavailable — the in-memory flow continues unaffected.
  }
}

/** Appends one row to the persisted log (cap enforced). */
export function recordOutcomeRow(row: OutcomeLogRow): OutcomeLogRow[] {
  const next = appendOutcomeRow(loadOutcomeLog(), row);
  saveOutcomeLog(next);
  return next;
}

/** Patches the persisted log's matching row; returns the updated list. */
export function updateStoredOutcomeRow(
  match: { blueprintId: string; sessionId?: string },
  patch: Partial<Pick<OutcomeLogRow, 'verdict' | 'score' | 'unauthorizedCount' | 'unmetIds' | 'auditedHeadSha'>>
): OutcomeLogRow[] {
  const next = updateOutcomeRow(loadOutcomeLog(), match, patch);
  saveOutcomeLog(next);
  return next;
}

/** Raw JSON export of the log. No rates or aggregates are computed. */
export function exportOutcomeLog(rows: OutcomeLogRow[]): string {
  return JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
}
