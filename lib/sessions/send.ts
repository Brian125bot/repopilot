import {
  applyNewRemediationSession,
  compileContinuationPrompt,
} from '@/lib/outcome-memory';
import type { Blueprint, FailureBrief } from '@/types';

/**
 * COR-59 send handler for interactive Jules session turns.
 *
 * CRITICAL INVARIANT: this is not a second dispatch
 * implementation. Every turn reuses the COR-39 continuation
 * machinery — the continuation prompt is compiled by
 * `compileContinuationPrompt` (the COR-39 continuation
 * compiler) with the operator-reviewed snippet text appended
 * as the turn directive, dispatched through the existing
 * `/api/jules/dispatch` continuation path
 * (`isRemediation: true`), and the blueprint is rebound with
 * `applyNewRemediationSession`, exactly like the Stage 2
 * remediation flow. Nothing here talks to the Jules API
 * directly and no new route is introduced.
 *
 * Operator-in-the-loop: this handler only runs when the
 * operator clicks Send in `ResponseEditor`. There is no
 * auto-send path anywhere in the snippet flow.
 */

/** The existing continuation dispatch endpoint. */
export const INTERACTIVE_TURN_ENDPOINT = '/api/jules/dispatch';

/** Heading of the appended operator directive inside the compiled prompt. */
export const DIRECTIVE_SECTION_HEADING =
  '## 7. Operator directive (this turn)';

export interface InteractiveTurnParams {
  /**
   * Active session blueprint. `auditedHeadSha` locks the
   * continuation (COR-40) — a blueprint without it cannot
   * compile a continuation prompt and the turn is refused.
   */
  blueprint: Blueprint;
  /** Latest failure brief, input to the continuation compiler. */
  brief: FailureBrief;
  /** Operator-reviewed directive text (snippet content, possibly edited). */
  directive: string;
  /** Client-side Jules API key; sent as `x-jules-api-key`, never stored. */
  julesApiKey: string;
  /**
   * COR-40 lock: live PR head SHA. The dispatch route rejects
   * the turn unless it equals the blueprint's audited SHA.
   */
  currentHeadSha: string;
  prNumber?: number;
  prUrl?: string;
  /** Fetch override for tests. */
  fetchFn?: typeof fetch;
}

export interface InteractiveTurnResult {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string;
  sessionState?: string;
  /** Blueprint rebound via `applyNewRemediationSession`; present only when ok. */
  blueprint?: Blueprint;
  /** The compiled continuation prompt that was dispatched. */
  compiledPrompt?: string;
  error?: string;
}

/** Shape of a successful /api/jules/dispatch response. */
interface DispatchResponse {
  success?: boolean;
  sessionId?: string;
  sessionUrl?: string;
  sessionState?: string;
  error?: string;
}

/**
 * Compiles the turn prompt: the COR-39 continuation contract
 * (objective, boundaries, MET seal, revert-only paths, required
 * fixes, branch lock) with the operator's directive appended as
 * the final section. Throws when the blueprint carries no
 * audited head SHA — the continuation compiler's fail-closed
 * contract — so a turn can never be compiled from an unlocked
 * commit.
 */
export function compileInteractiveTurnPrompt(
  params: InteractiveTurnParams
): string {
  const auditedHeadSha = (params.blueprint.auditedHeadSha || '').trim();
  const continuation = compileContinuationPrompt({
    blueprint: { ...params.blueprint, auditedHeadSha },
    brief: params.brief,
  });
  const directive = params.directive.trim();
  return [
    continuation,
    '',
    DIRECTIVE_SECTION_HEADING,
    'Apply exactly this directive for the current turn, within the boundaries and branch lock above:',
    directive,
  ].join('\n');
}

/**
 * Pure: the exact `/api/jules/dispatch` body for an
 * interactive continuation turn. Exported so the continuation
 * contract is unit-testable without a network or a DOM.
 */
export function buildInteractiveTurnBody(
  params: InteractiveTurnParams
): Record<string, unknown> {
  const blueprint = params.blueprint;
  const fileBoundaries = blueprint.fileBoundaries ?? [];
  const criteria = blueprint.criteria ?? [];
  return {
    repo: blueprint.repo,
    baseBranch: blueprint.baseBranch,
    branchName: blueprint.branchName,
    startingBranch: blueprint.branchName,
    isRemediation: true,
    auditedHeadSha: (blueprint.auditedHeadSha || '').trim(),
    currentHeadSha: (params.currentHeadSha || '').trim(),
    ...(params.prNumber !== undefined ? { prNumber: params.prNumber } : {}),
    ...(params.prUrl ? { prUrl: params.prUrl } : {}),
    ...(fileBoundaries.length > 0
      ? { fileBoundaries: [...fileBoundaries] }
      : {}),
    ...(criteria.length > 0
      ? {
          criteria: criteria.map((criterion) => ({
            id: criterion.id,
            text: criterion.text,
            category: criterion.category,
          })),
        }
      : {}),
    customPrompt: compileInteractiveTurnPrompt(params),
    objective: `Interactive Jules turn on branch "${blueprint.branchName}"`,
  };
}

/**
 * Sends one interactive turn through the COR-39 continuation
 * path and rebinds the blueprint to the session Jules created.
 * Fail-closed: a missing directive, an unlocked audited SHA, a
 * non-OK dispatch, or a response without a session id never
 * resolves to success.
 */
export async function sendInteractiveTurn(
  params: InteractiveTurnParams
): Promise<InteractiveTurnResult> {
  const directive = params.directive.trim();
  if (!directive) {
    return {
      ok: false,
      status: 400,
      error: 'Directive is required to continue a Jules session.',
    };
  }

  const auditedHeadSha = (params.blueprint.auditedHeadSha || '').trim();
  if (!auditedHeadSha) {
    return {
      ok: false,
      status: 400,
      error: 'Remediation blocked — re-evaluate to lock audited head SHA.',
    };
  }

  let body: Record<string, unknown>;
  let compiledPrompt: string;
  try {
    compiledPrompt = compileInteractiveTurnPrompt(params);
    body = buildInteractiveTurnBody(params);
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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.julesApiKey) {
    headers['x-jules-api-key'] = params.julesApiKey;
  }

  let response: Response;
  try {
    response = await (params.fetchFn ?? fetch)(
      INTERACTIVE_TURN_ENDPOINT,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }
    );
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      error:
        networkError instanceof Error
          ? networkError.message
          : 'Network error continuing the Jules session.',
    };
  }

  const data = (await response
    .json()
    .catch(() => ({}))) as DispatchResponse;

  if (!response.ok || data.success === false) {
    return {
      ok: false,
      status: response.status,
      error:
        data.error ||
        `Failed to continue the Jules session (HTTP ${response.status}).`,
    };
  }

  const sessionId = (data.sessionId || '').trim();
  if (!sessionId) {
    return {
      ok: false,
      status: 502,
      error: 'The continuation dispatch returned no session id.',
    };
  }

  // COR-39 continuation compiler: rebind the blueprint to the
  // session Jules just created, keeping the audited-branch
  // contract and stamping the operator-reviewed prompt.
  const rebound = applyNewRemediationSession(params.blueprint, {
    sessionId,
    sessionUrl: data.sessionUrl,
    sessionState: data.sessionState,
  });

  return {
    ok: true,
    status: response.status,
    sessionId,
    sessionUrl: data.sessionUrl,
    sessionState: data.sessionState,
    blueprint: { ...rebound, compiledPrompt },
    compiledPrompt,
  };
}
