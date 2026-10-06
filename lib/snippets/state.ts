/**
 * COR-59 session lifecycle inference.
 *
 * Pure pattern matching over the two signals the client has about a
 * live Jules session: the structured session state string (when the
 * session resource has been read) and the latest unstructured message
 * text. Deterministic — the same inputs always infer the same stage,
 * so the ranking engine and the UI never disagree about where a turn
 * sits in the lifecycle.
 */

export type SessionStage =
  | 'plan_review'
  | 'mid_execution'
  | 'pre_pr'
  | 'post_pr'
  | 'unknown';

export interface SessionStageInput {
  /** Latest Jules message text, when one is available. */
  latestMessage?: string | null;
  /** Structured Jules session state, e.g. "EXECUTING". */
  sessionState?: string | null;
  /** Pull request URL harvested from the session, if Jules opened one. */
  prUrl?: string | null;
}

/** Jules session states that mean "a plan or proposal is on the table". */
const PLAN_REVIEW_STATES: ReadonlySet<string> = new Set([
  'CREATED',
  'PLANNING',
  'AWAITING_APPROVAL',
  'PLAN_REVIEW',
]);

/** Jules session states that mean "edits and tests are running". */
const MID_EXECUTION_STATES: ReadonlySet<string> = new Set([
  'EXECUTING',
  'RUNNING',
  'CODING',
  'QUEUED',
  'IN_PROGRESS',
]);

/** Jules session states that mean "a PR is being prepared". */
const PRE_PR_STATES: ReadonlySet<string> = new Set([
  'PR_CREATION',
  'PREPARING_PR',
  'SUMMARIZING',
]);

/** Jules session states that mean "a PR exists and awaits review or CI". */
const POST_PR_STATES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'PR_CREATED',
  'PR_OPEN',
  'PR_MERGED',
  'MERGED',
]);

/**
 * Terminal failure states carry no active stage. A failed or canceled
 * session is not mid-execution — the operator must start a new turn.
 */
const TERMINAL_FAILURE_STATES: ReadonlySet<string> = new Set([
  'FAILED',
  'CANCELED',
  'CANCELLED',
  'EXPIRED',
  'ERROR',
  'REJECTED',
  'STATE_UNSPECIFIED',
]);

/** Phrases Jules uses while presenting an initial plan or proposal. */
const PLAN_REVIEW_PATTERNS: readonly RegExp[] = [
  /\bhere'?s (my )?(plan|approach|proposal|outline)\b/i,
  /\bi (plan|propose|suggest|recommend)\b/i,
  /\bplan:\s/i,
  /\bproposal\b/i,
  /\bapproach\b/i,
  /\bbefore (i |we )?(start|begin|make any changes)\b/i,
  /\boutlin(e|es|ing)\b/i,
];

/** Phrases Jules uses while running edits and tests. */
const MID_EXECUTION_PATTERNS: readonly RegExp[] = [
  /\b(running|execute|executing|executed)\b/i,
  /\b(implement|implementing|implemented)\b/i,
  /\b(edit|editing|edits|edited)\b/i,
  /\b(fix|fixing|fixes|fixed)\b/i,
  /\b(updating|updated)\b/i,
  /\b(modifying|modified)\b/i,
  /\b(working on|making changes|making progress)\b/i,
  /\btests? (are |is )?(running|passing|failing)\b/i,
  /\btest suite\b/i,
  /\blint(ing|er)?\b/i,
];

/** Phrases Jules uses while preparing a PR or summarizing changes. */
const PRE_PR_PATTERNS: readonly RegExp[] = [
  /\b(preparing|drafting|creating|opening)\b[^.]*\b(pull request|pr)\b/i,
  /\bpull request (draft|description)\b/i,
  /\bsummar(y|izing|ising|ised)\b[^.]*\b(changes|change|the diff)\b/i,
  /\b(pushing|pushed|committing|committed)\b/i,
  /\bbranch (is |was )?(ready|prepared)\b/i,
];

/** Phrases Jules uses once a PR exists and awaits review or CI. */
const POST_PR_PATTERNS: readonly RegExp[] = [
  /\bpull request (was |has been |is )?(created|opened|submitted|ready)\b/i,
  /\bpr (was |has been |is )?(created|opened|submitted|ready)\b/i,
  /\b(created|opened) (a |the )?pull request\b/i,
  /\bready for review\b/i,
  /\bawaiting (review|ci|checks)\b/i,
  /\bci (checks|is) (running|pending|passing|failing)\b/i,
  /\bchecks? (are |is )?(running|pending|passing|failing)\b/i,
];

function normalizeState(value?: string | null): string {
  return (value || '').trim().toUpperCase();
}

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Infers the lifecycle stage of a Jules session.
 *
 * Precedence: a harvested PR URL, then the structured session state,
 * then unstructured message patterns. When nothing matches — only
 * unstructured text that fits no known pattern — the stage is
 * `unknown`.
 */
export function inferSessionStage(input: SessionStageInput = {}): SessionStage {
  if ((input.prUrl || '').trim()) return 'post_pr';

  const state = normalizeState(input.sessionState);
  if (state) {
    if (PLAN_REVIEW_STATES.has(state)) return 'plan_review';
    if (MID_EXECUTION_STATES.has(state)) return 'mid_execution';
    if (PRE_PR_STATES.has(state)) return 'pre_pr';
    if (POST_PR_STATES.has(state)) return 'post_pr';
    if (TERMINAL_FAILURE_STATES.has(state)) return 'unknown';
  }

  const message = (input.latestMessage || '').trim();
  if (message) {
    if (matchesAny(POST_PR_PATTERNS, message)) return 'post_pr';
    if (matchesAny(PRE_PR_PATTERNS, message)) return 'pre_pr';
    if (matchesAny(PLAN_REVIEW_PATTERNS, message)) return 'plan_review';
    if (matchesAny(MID_EXECUTION_PATTERNS, message)) return 'mid_execution';
  }

  return 'unknown';
}

/** Human label for the stage, used in citations and UI copy. */
export function describeSessionStage(stage: SessionStage): string {
  switch (stage) {
    case 'plan_review':
      return 'plan review';
    case 'mid_execution':
      return 'mid execution';
    case 'pre_pr':
      return 'pre-PR';
    case 'post_pr':
      return 'post-PR';
    default:
      return 'unknown stage';
  }
}
