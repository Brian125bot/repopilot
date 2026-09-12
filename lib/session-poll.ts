import { Blueprint } from '@/types';

export const SESSION_POLL_INTERVAL_MS = 15_000;
export const SESSION_POLL_MAX_MS = 20 * 60 * 1000;

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
