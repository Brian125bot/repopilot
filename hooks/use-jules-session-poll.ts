'use client';

import * as React from 'react';
import {
  nextSessionPollAction,
  pollIntervalForElapsedMs,
  type SessionPollAction,
} from '@/lib/session-poll';

export interface JulesSessionSnapshotPayload {
  sessionId?: string;
  sessionUrl?: string;
  state?: string;
  prUrl?: string;
  prTitle?: string;
}

export function useJulesSessionPoll(opts: {
  enabled: boolean;
  sessionId?: string | null;
  prUrl?: string | null;
  sessionState?: string | null;
  julesKey: string;
  /** Forwarded to the session route so harvested PRs update the server vault record. */
  repo?: string | null;
  blueprintId?: string | null;
  onSnapshot: (snapshot: JulesSessionSnapshotPayload) => void;
  onStatus?: (action: SessionPollAction) => void;
}) {
  const startedAtRef = React.useRef(0);
  const optsRef = React.useRef(opts);

  React.useEffect(() => {
    optsRef.current = opts;
  });

  React.useEffect(() => {
    startedAtRef.current = Date.now();
  }, [opts.sessionId]);

  const tick = React.useCallback(async () => {
    const current = optsRef.current;
    const action = nextSessionPollAction({
      sessionId: current.sessionId,
      prUrl: current.prUrl,
      sessionState: current.sessionState,
      startedAtMs: startedAtRef.current,
      nowMs: Date.now(),
      documentHidden: typeof document !== 'undefined' && document.hidden,
    });
    current.onStatus?.(action);
    if (action !== 'poll' || !current.sessionId) return;

    const headers: Record<string, string> = {};
    if (current.julesKey) headers['x-jules-api-key'] = current.julesKey;
    const params = new URLSearchParams({ id: current.sessionId });
    if (current.repo?.trim()) params.set('repo', current.repo.trim());
    if (current.blueprintId?.trim()) params.set('blueprintId', current.blueprintId.trim());
    const res = await fetch(`/api/jules/session?${params.toString()}`, {
      headers,
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok || data.success === false) return;
    current.onSnapshot({
      sessionId: data.sessionId,
      sessionUrl: data.sessionUrl,
      state: data.state,
      prUrl: data.prUrl,
      prTitle: data.prTitle,
    });
  }, []);

  React.useEffect(() => {
    if (!opts.enabled) return undefined;

    // Tab dormancy recovery: a visible tab polls immediately instead of
    // waiting out the backoff window it slept through.
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Tiered backoff chain (15s → 30s → 60s) instead of a fixed interval,
    // so day-long Jules runs stay cheap on polling quota.
    let timerId: number | null = null;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      const elapsed = Date.now() - startedAtRef.current;
      timerId = window.setTimeout(() => {
        void tick().finally(() => schedule());
      }, pollIntervalForElapsedMs(elapsed));
    };
    void tick().finally(() => schedule());

    return () => {
      stopped = true;
      if (timerId) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [opts.enabled, opts.sessionId, tick]);
}
