import { compileContinuationPrompt } from '@/lib/outcome-memory';
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
 * Operator-in-the-loop: this handler only runs when the operator clicks
 * Send in `ResponseEditor`. There is no auto-send path anywhere in the
 * snippet flow.
 */

/** The existing follow-up endpoint for the current session. */
export const INTERACTIVE_TURN_ENDPOINT = '/api/jules/message';

/** Heading of the appended operator directive inside the compiled prompt. */
export const DIRECTIVE_SECTION_HEADING =
  '## 7. Operator directive (this turn)';

/** Shown when no live Jules session can receive the reply. */
export const NO_ACTIVE_SESSION_MESSAGE =
  'No active Jules session. Start a remediation from the scorecard first.';

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
  if (!params.canContinue || !sessionId) {
    return { ok: false, status: 409, error: NO_ACTIVE_SESSION_MESSAGE };
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
