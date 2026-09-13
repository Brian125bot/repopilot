import { Blueprint } from '@/types';

export const SESSION_POLL_INTERVAL_MS = 15_000;
/** Watch cap: fast polls slow down instead of stopping (see pollIntervalForElapsedMs). */
export const SESSION_POLL_MAX_MS = 25 * 60 * 1000;

/**
 * Tiered backoff so long Jules runs stay cheap: every 15s for the first
 * 2 minutes, every 30s up to 10 minutes, every 60s up to the 25-minute cap.
 */
export function pollIntervalForElapsedMs(elapsedMs: number): number {
  if (elapsedMs < 2 * 60 * 1000) return 15_000;
  if (elapsedMs < 10 * 60 * 1000) return 30_000;
  return 60_000;
}

const TERMINAL_STATES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'CANCELLED',
  'ERROR',
  'REJECTED',
]);

export function isJulesSessionTerminal(state?: string | null): boolean {
  if (!state) return false;
  return TERMINAL_STATES.has(state.trim().toUpperCase());
}

export type SessionPollAction =
  | 'poll'
  | 'stop-pr'
  | 'stop-terminal'
  | 'stop-timeout'
  | 'pause-hidden'
  | 'skip-no-session';

export function nextSessionPollAction(input: {
  sessionId?: string | null;
  prUrl?: string | null;
  sessionState?: string | null;
  startedAtMs: number;
  nowMs: number;
  documentHidden: boolean;
}): SessionPollAction {
  if (!input.sessionId || !String(input.sessionId).trim()) return 'skip-no-session';
  if (input.prUrl && String(input.prUrl).trim()) return 'stop-pr';
  if (isJulesSessionTerminal(input.sessionState)) return 'stop-terminal';
  if (input.nowMs - input.startedAtMs >= SESSION_POLL_MAX_MS) return 'stop-timeout';
  if (input.documentHidden) return 'pause-hidden';
  return 'poll';
}

export function applySessionSnapshotToBlueprint(
  blueprint: Blueprint,
  snapshot: {
    sessionId?: string;
    sessionUrl?: string;
    state?: string;
    prUrl?: string;
    prTitle?: string;
  }
): Blueprint {
  return {
    ...blueprint,
    sessionId: snapshot.sessionId || blueprint.sessionId,
    sessionUrl: snapshot.sessionUrl || blueprint.sessionUrl,
    sessionState: snapshot.state || blueprint.sessionState,
    prUrl: snapshot.prUrl || blueprint.prUrl,
    prTitle: snapshot.prTitle || blueprint.prTitle,
  };
}
