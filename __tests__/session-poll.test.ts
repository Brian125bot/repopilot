import { describe, it, expect } from 'vitest';
import {
  SESSION_POLL_MAX_MS,
  applySessionSnapshotToBlueprint,
  isJulesSessionTerminal,
  nextSessionPollAction,
  pollIntervalForElapsedMs,
} from '@/lib/session-poll';
import { Blueprint } from '@/types';

describe('Jules session poll decisions', () => {
  const base = {
    sessionId: 'sessions/abc',
    prUrl: undefined as string | undefined,
    sessionState: 'IN_PROGRESS' as string | undefined,
    startedAtMs: 1_000,
    nowMs: 1_000,
    documentHidden: false,
  };

  it('skips without a session id', () => {
    expect(nextSessionPollAction({ ...base, sessionId: '' })).toBe('skip-no-session');
    expect(nextSessionPollAction({ ...base, sessionId: null })).toBe('skip-no-session');
  });

  it('stops when a PR URL has been harvested', () => {
    expect(nextSessionPollAction({ ...base, prUrl: 'https://github.com/acme/api/pull/1' })).toBe(
      'stop-pr'
    );
  });

  it('stops on terminal Jules states even without a PR', () => {
    expect(isJulesSessionTerminal('COMPLETED')).toBe(true);
    expect(isJulesSessionTerminal('failed')).toBe(true);
    expect(isJulesSessionTerminal('IN_PROGRESS')).toBe(false);
    expect(nextSessionPollAction({ ...base, sessionState: 'COMPLETED' })).toBe('stop-terminal');
  });

  it('stops after the 25 minute cap', () => {
    expect(SESSION_POLL_MAX_MS).toBe(25 * 60 * 1000);
    expect(
      nextSessionPollAction({
        ...base,
        nowMs: base.startedAtMs + SESSION_POLL_MAX_MS,
      })
    ).toBe('stop-timeout');
  });

  it('backs off polling cadence with elapsed time (15s → 30s → 60s)', () => {
    expect(pollIntervalForElapsedMs(0)).toBe(15_000);
    expect(pollIntervalForElapsedMs(119_999)).toBe(15_000);
    expect(pollIntervalForElapsedMs(120_000)).toBe(30_000);
    expect(pollIntervalForElapsedMs(599_999)).toBe(30_000);
    expect(pollIntervalForElapsedMs(600_000)).toBe(60_000);
    expect(pollIntervalForElapsedMs(10 * 60_000)).toBe(60_000);
  });

  it('pauses while the document is hidden and polls when visible', () => {
    expect(nextSessionPollAction({ ...base, documentHidden: true })).toBe('pause-hidden');
    expect(nextSessionPollAction(base)).toBe('poll');
  });

  it('patches a blueprint with harvested session fields without dropping identity', () => {
    const original: Blueprint = {
      blueprintId: 'bp_1',
      repo: 'acme/api',
      baseBranch: 'main',
      branchName: 'jules/feat',
      fileBoundaries: ['src/**'],
      objective: 'Ship it',
      criteria: [{ id: '1', text: 'Works', category: 'functional' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      sessionId: 'sessions/old',
    };
    const patched = applySessionSnapshotToBlueprint(original, {
      sessionId: 'sessions/new',
      sessionUrl: 'https://jules.google.com/session/new',
      state: 'COMPLETED',
      prUrl: 'https://github.com/acme/api/pull/9',
      prTitle: 'Add feat',
    });
    expect(patched.blueprintId).toBe('bp_1');
    expect(patched.criteria).toEqual(original.criteria);
    expect(patched.sessionId).toBe('sessions/new');
    expect(patched.prUrl).toContain('/pull/9');
    expect(patched.sessionState).toBe('COMPLETED');
  });
});
