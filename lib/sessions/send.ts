import {
  applyNewRemediationSession,
  compileContinuationPrompt,
} from '@/lib/outcome-memory';
import type { Blueprint, FailureBrief } from '@/types';

/**
 * COR-59 send handler for interactive Jules session turns.
 *
 * Owner decision (2026-10-06): clicking Send on a snippet replies in
 * the CURRENT Jules session. It never starts a new session and never
 * calls `/api/jules/dispatch`. The flow mirrors the scorecard's
 * `handleContinueJulesSession`:
 *
 *   1. `requireVerifiedKey` (parent policy gate: verified key, vault lock)
 *   2. `checkHeadFreshness` (COR-40: refuse a missing audited SHA, an
 *      unresolvable live head, or a head that moved)
 *   3. POST `/api/jules/message` with
 *      `{ sessionId, prompt, isRemediation: true, auditedHeadSha, currentHeadSha }`
 *      and the key only in the `x-jules-api-key` header.
 *
 * The blueprint is never rebound or re-saved here. The prompt's branch
 * lock is the audited PR's head branch (`targetBranch`), never
 * `blueprint.branchName`, because a vault blueprint matched by repo may
 * point at a different branch.
 *
 * Fallback (owner decision, 2026-10-15): when the session has ended
 * (`shouldOfferContinueSession` false) but the audited PR is fully known,
 * the panel offers a separate, clearly labelled "Start new Jules session"
 * button. Only that explicit click calls `startNewSessionTurn`, which
 * POSTs `/api/jules/dispatch` with the same body as the scorecard's
 * remediation dispatch (`buildRemediationDispatchBody`) and returns the
 * blueprint rebound via `bindNewRemediationSession`, exactly as that path
 * does. `sendInteractiveTurn` itself never dispatches.
 *
 * Operator-in-the-loop: this handler only runs when the operator clicks
 * Send in `ResponseEditor`. There is no auto-send path anywhere in the
 * snippet flow.
 */

/** Endpoint for the explicit start-new-session fallback only. */
export const NEW_SESSION_ENDPOINT = '/api/jules/dispatch';

/** The existing follow-up endpoint for the current session. */
export const INTERACTIVE_TURN_ENDPOINT = '/api/jules/message';

/** Heading of the appended operator directive inside the compiled prompt. */
export const DIRECTIVE_SECTION_HEADING =
  '## 7. Operator directive (this turn)';

/** Shown when no live Jules session can receive the reply. */
export const NO_ACTIVE_SESSION_MESSAGE =
  'No active Jules session. Start a remediation from the scorecard first.';

/** Shown when PR metadata (the audited head branch) is missing. */
export const MISSING_PR_METADATA_MESSAGE =
  'PR metadata is missing, so the audited branch is unknown. Re-evaluate the PR before sending.';

/**
 * Why snippet Send is disabled, or null when it may send. No live
 * session or no audited PR head branch both block; neither falls back
 * to dispatch or to `blueprint.branchName`.
 */
export function snippetSendBlockReason(input: {
  canContinue: boolean;
  sessionId: string | null;
  targetBranch: string;
}): string | null {
  if (!input.canContinue || !(input.sessionId || '').trim()) {
    return NO_ACTIVE_SESSION_MESSAGE;
  }
  if (!(input.targetBranch || '').trim()) return MISSING_PR_METADATA_MESSAGE;
  return null;
}

export type HeadFreshnessResult =
  | { ok: true; audited: string; live: string | null }
  | { ok: false; error: string };

export interface InteractivePromptParams {
  /** Active session blueprint (read-only here; never rebound). */
  blueprint: Blueprint;
  /** Latest failure brief, input to the continuation compiler. */
  brief: FailureBrief;
  /** Operator-reviewed directive text (snippet content, possibly edited). */
  directive: string;
  /** Audited PR head branch; overrides `blueprint.branchName` in the lock. */
  targetBranch: string;
  /** Audited head SHA from the freshness gate (`freshness.audited`). */
  auditedHeadSha: string;
}

export interface InteractiveTurnParams
  extends Omit<InteractivePromptParams, 'auditedHeadSha'> {
  /** Client-side Jules API key; sent as `x-jules-api-key`, never stored. */
  julesApiKey: string;
  /** Session to reply in, from `resolveContinueSessionId`. */
  sessionId: string | null;
  /** `shouldOfferContinueSession` result; false refuses the turn. */
  canContinue: boolean;
  /** Parent policy gate; returning false aborts the turn. */
  requireVerifiedKey: () => boolean;
  /** COR-40 freshness gate, run after the key gate. */
  checkHeadFreshness: () => Promise<HeadFreshnessResult>;
  prUrl?: string;
  /** Fetch override for tests. */
  fetchFn?: typeof fetch;
}

export interface InteractiveTurnResult {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string;
  /** The compiled continuation prompt that was sent. */
  compiledPrompt?: string;
  /** Audited SHA the turn was locked to (for the outcome row). */
  auditedHeadSha?: string;
  error?: string;
}

interface MessageResponse {
  success?: boolean;
  sessionId?: string;
  sessionUrl?: string;
  error?: string;
}

/**
 * Compiles the turn prompt: the COR-39 continuation contract with the
 * branch lock set to the audited PR branch and the SHA lock set to the
 * audited head SHA, plus the operator directive as the final section.
 * Throws when no audited SHA is supplied (fail-closed).
 */
export function compileInteractiveTurnPrompt(
  params: InteractivePromptParams
): string {
  const auditedHeadSha = (params.auditedHeadSha || '').trim();
  const continuation = compileContinuationPrompt({
    blueprint: {
      ...params.blueprint,
      branchName: params.targetBranch,
      auditedHeadSha,
    },
    brief: params.brief,
  });
  return [
    continuation,
    '',
    DIRECTIVE_SECTION_HEADING,
    'Apply exactly this directive for the current turn, within the boundaries and branch lock above:',
    params.directive.trim(),
  ].join('\n');
}

/** Pure: the exact `/api/jules/message` body for a turn. */
export function buildInteractiveTurnBody(input: {
  sessionId: string;
  prompt: string;
  auditedHeadSha: string;
  currentHeadSha: string;
  prUrl?: string;
}): Record<string, unknown> {
  return {
    sessionId: input.sessionId,
    prompt: input.prompt,
    isRemediation: true,
    auditedHeadSha: input.auditedHeadSha.trim(),
    currentHeadSha: input.currentHeadSha.trim(),
    ...(input.prUrl ? { prUrl: input.prUrl } : {}),
  };
}

/**
 * Sends one interactive turn into the current Jules session.
 * Fail-closed: a missing directive, no live session, a failed key gate,
 * a stale or missing head, a compile error or a non-OK response never
 * resolves to success.
 */
export async function sendInteractiveTurn(
  params: InteractiveTurnParams
): Promise<InteractiveTurnResult> {
  const directive = params.directive.trim();
  if (!directive) {
    return { ok: false, status: 400, error: 'Directive is required to reply to Jules.' };
  }
  const sessionId = (params.sessionId || '').trim();
  const blocked = snippetSendBlockReason(params);
  if (blocked) {
    return { ok: false, status: 409, error: blocked };
  }
  if (!params.requireVerifiedKey()) {
    return { ok: false, status: 401, error: 'Verify your Jules API key before sending.' };
  }

  const freshness = await params.checkHeadFreshness();
  if (!freshness.ok) {
    return { ok: false, status: 409, error: freshness.error };
  }
  const auditedHeadSha = (freshness.audited || '').trim();
  const currentHeadSha = (freshness.live || '').trim();
  if (!auditedHeadSha) {
    return { ok: false, status: 400, error: 'Remediation blocked — re-evaluate to lock audited head SHA.' };
  }
  if (!currentHeadSha || currentHeadSha.toLowerCase() !== auditedHeadSha.toLowerCase()) {
    return { ok: false, status: 409, error: 'Head moved since audit — re-evaluate.' };
  }

  let compiledPrompt: string;
  try {
    compiledPrompt = compileInteractiveTurnPrompt({
      blueprint: params.blueprint,
      brief: params.brief,
      directive,
      targetBranch: params.targetBranch,
      auditedHeadSha,
    });
  } catch (compileError) {
    return {
      ok: false,
      status: 400,
      error:
        compileError instanceof Error
          ? compileError.message
          : 'The continuation prompt could not be compiled.',
    };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.julesApiKey) headers['x-jules-api-key'] = params.julesApiKey;

  let response: Response;
  try {
    response = await (params.fetchFn ?? fetch)(INTERACTIVE_TURN_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        buildInteractiveTurnBody({
          sessionId,
          prompt: compiledPrompt,
          auditedHeadSha,
          currentHeadSha,
          prUrl: params.prUrl,
        })
      ),
    });
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      error:
        networkError instanceof Error
          ? networkError.message
          : 'Network error replying to the Jules session.',
    };
  }

  const data = (await response.json().catch(() => ({}))) as MessageResponse;
  if (!response.ok || data.success === false) {
    return {
      ok: false,
      status: response.status,
      error: data.error || `Failed to reply to the Jules session (HTTP ${response.status}).`,
    };
  }

  return {
    ok: true,
    status: response.status,
    sessionId: (data.sessionId || '').trim() || sessionId,
    sessionUrl: data.sessionUrl,
    compiledPrompt,
    auditedHeadSha,
  };
}

// ---------------------------------------------------------------------------
// Start-new-session fallback (explicit click only)
// ---------------------------------------------------------------------------

export type SnippetSendMode =
  | { kind: 'continue' }
  | { kind: 'start-new' }
  | { kind: 'blocked'; reason: string };

export interface SnippetSendModeInput {
  canContinue: boolean;
  sessionId: string | null;
  repo: string;
  targetBranch: string;
  baseBranch?: string;
  prNumber?: number;
  auditedHeadSha?: string | null;
}

/** True when the audited repo, branches, PR number and SHA are all known. */
export function hasAuditedPrMetadata(input: SnippetSendModeInput): boolean {
  return Boolean(
    (input.repo || '').trim() &&
      (input.targetBranch || '').trim() &&
      (input.baseBranch || '').trim() &&
      typeof input.prNumber === 'number' &&
      Number.isFinite(input.prNumber) &&
      (input.auditedHeadSha || '').trim()
  );
}

/**
 * Which snippet action the panel offers: reply in the live session,
 * offer the explicit "Start new Jules session" button, or nothing.
 * Missing PR metadata always blocks with the existing message.
 */
export function snippetSendMode(input: SnippetSendModeInput): SnippetSendMode {
  if (!(input.targetBranch || '').trim()) {
    return { kind: 'blocked', reason: MISSING_PR_METADATA_MESSAGE };
  }
  if (input.canContinue && (input.sessionId || '').trim()) {
    return { kind: 'continue' };
  }
  if (hasAuditedPrMetadata(input)) return { kind: 'start-new' };
  return { kind: 'blocked', reason: MISSING_PR_METADATA_MESSAGE };
}

export interface RemediationDispatchInput {
  repo: string;
  baseBranch: string;
  targetBranch: string;
  auditedHeadSha: string;
  currentHeadSha: string;
  prNumber?: number;
  prUrl?: string;
  customPrompt: string;
  fileBoundaries?: readonly string[];
  criteria?: ReadonlyArray<{ id: string; text: string; category?: string }>;
}

/**
 * Pure: the `/api/jules/dispatch` body for a remediation session on the
 * audited PR. Shared by the scorecard's remediation dispatch and the
 * snippet start-new-session fallback so the two cannot drift. The
 * audited branch is both `branchName` and `startingBranch`.
 */
export function buildRemediationDispatchBody(
  input: RemediationDispatchInput
): Record<string, unknown> {
  return {
    repo: input.repo,
    baseBranch: input.baseBranch,
    branchName: input.targetBranch,
    startingBranch: input.targetBranch, // Jules commits only on the audited branch.
    isRemediation: true,
    auditedHeadSha: input.auditedHeadSha,
    currentHeadSha: input.currentHeadSha,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    customPrompt: input.customPrompt,
    objective: `Remediate PR #${input.prNumber ?? ''} on branch "${input.targetBranch}": address audit blockers`,
    fileBoundaries: [...(input.fileBoundaries ?? [])],
    criteria: (input.criteria ?? []).map((c) => ({ id: c.id, text: c.text, category: c.category })),
  };
}

/** Shape of the dispatch route's success body that the bind step reads. */
export interface RemediationDispatchResponse {
  success?: boolean;
  sessionId?: string;
  sessionUrl?: string;
  sessionState?: string;
  targetBranch?: string;
  apiStatus?: string;
  warningMessage?: string;
  julesApiResponse?: { url?: string };
  blueprint?: Blueprint;
  error?: string;
}

/** Session URL as the scorecard derives it from a dispatch response. */
export function deriveDispatchSessionUrl(data: RemediationDispatchResponse): string | null {
  return (
    data.julesApiResponse?.url ||
    (data.sessionId
      ? `https://jules.google.com/session/${data.sessionId.replace(/^sessions\//, '')}`
      : null)
  );
}

/**
 * Rebinds the audited blueprint to the session a remediation dispatch
 * created (replacing the dead session identity) and stamps the prompt,
 * exactly as the scorecard remediation dispatch does.
 */
export function bindNewRemediationSession(
  blueprint: Blueprint,
  data: RemediationDispatchResponse,
  compiledPrompt: string
): Blueprint {
  return {
    ...applyNewRemediationSession(blueprint, {
      sessionId: data.sessionId || '',
      sessionUrl: data.sessionUrl || deriveDispatchSessionUrl(data),
      sessionState: data.sessionState || data.blueprint?.sessionState,
    }),
    compiledPrompt,
  };
}

export interface NewSessionTurnParams {
  blueprint: Blueprint;
  brief: FailureBrief;
  directive: string;
  julesApiKey: string;
  repo: string;
  targetBranch: string;
  baseBranch?: string;
  prNumber?: number;
  prUrl?: string;
  /** Audited SHA known to the scorecard; required for metadata check. */
  auditedHeadSha?: string | null;
  requireVerifiedKey: () => boolean;
  checkHeadFreshness: () => Promise<HeadFreshnessResult>;
  fetchFn?: typeof fetch;
}

export interface NewSessionTurnResult {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string | null;
  sessionState?: string;
  /** Blueprint rebound to the new session (for onSaveBlueprint). */
  blueprint?: Blueprint;
  compiledPrompt?: string;
  auditedHeadSha?: string;
  error?: string;
}

/**
 * Explicit-click fallback: starts ONE new remediation session on the
 * audited PR branch. Gate order: PR metadata known, then the key gate,
 * then the COR-40 freshness gate. Fail-closed throughout.
 */
export async function startNewSessionTurn(
  params: NewSessionTurnParams
): Promise<NewSessionTurnResult> {
  const directive = params.directive.trim();
  if (!directive) {
    return { ok: false, status: 400, error: 'Directive is required to start a Jules session.' };
  }
  if (
    !hasAuditedPrMetadata({
      canContinue: false,
      sessionId: null,
      repo: params.repo,
      targetBranch: params.targetBranch,
      baseBranch: params.baseBranch,
      prNumber: params.prNumber,
      auditedHeadSha: params.auditedHeadSha,
    })
  ) {
    return { ok: false, status: 409, error: MISSING_PR_METADATA_MESSAGE };
  }
  if (!params.requireVerifiedKey()) {
    return { ok: false, status: 401, error: 'Verify your Jules API key before sending.' };
  }
  const freshness = await params.checkHeadFreshness();
  if (!freshness.ok) return { ok: false, status: 409, error: freshness.error };
  const auditedHeadSha = (freshness.audited || '').trim();
  const currentHeadSha = (freshness.live || '').trim();
  if (!auditedHeadSha) {
    return { ok: false, status: 400, error: 'Remediation blocked — re-evaluate to lock audited head SHA.' };
  }
  if (!currentHeadSha || currentHeadSha.toLowerCase() !== auditedHeadSha.toLowerCase()) {
    return { ok: false, status: 409, error: 'Head moved since audit — re-evaluate.' };
  }

  let compiledPrompt: string;
  try {
    compiledPrompt = compileInteractiveTurnPrompt({
      blueprint: params.blueprint,
      brief: params.brief,
      directive,
      targetBranch: params.targetBranch,
      auditedHeadSha,
    });
  } catch (compileError) {
    return {
      ok: false,
      status: 400,
      error: compileError instanceof Error ? compileError.message : 'The prompt could not be compiled.',
    };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.julesApiKey) headers['x-jules-api-key'] = params.julesApiKey;

  let response: Response;
  try {
    response = await (params.fetchFn ?? fetch)(NEW_SESSION_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        buildRemediationDispatchBody({
          repo: params.repo,
          baseBranch: params.baseBranch as string,
          targetBranch: params.targetBranch,
          auditedHeadSha,
          currentHeadSha,
          prNumber: params.prNumber,
          prUrl: params.prUrl,
          customPrompt: compiledPrompt,
          fileBoundaries: params.blueprint.fileBoundaries ?? [],
          criteria: params.blueprint.criteria ?? [],
        })
      ),
    });
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      error: networkError instanceof Error ? networkError.message : 'Network error starting a Jules session.',
    };
  }

  const data = (await response.json().catch(() => ({}))) as RemediationDispatchResponse;
  if (!response.ok || data.success === false) {
    return {
      ok: false,
      status: response.status,
      error: data.error || `Failed to start a Jules session (HTTP ${response.status}).`,
    };
  }
  const sessionId = (data.sessionId || '').trim();
  if (!sessionId) {
    return { ok: false, status: 502, error: 'The dispatch returned no session id.' };
  }
  const bound = bindNewRemediationSession(params.blueprint, { ...data, sessionId }, compiledPrompt);
  return {
    ok: true,
    status: response.status,
    sessionId,
    sessionUrl: bound.sessionUrl ?? null,
    sessionState: data.sessionState,
    blueprint: bound,
    compiledPrompt,
    auditedHeadSha,
  };
}
