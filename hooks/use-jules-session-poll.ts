'use client';

import * as React from 'react';
import {
  SESSION_POLL_INTERVAL_MS,
  nextSessionPollAction,
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
    const res = await fetch(`/api/jules/session?id=${encodeURIComponent(current.sessionId)}`, {
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

    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const intervalId = window.setInterval(() => {
      void tick();
    }, SESSION_POLL_INTERVAL_MS);
    void tick();

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [opts.enabled, opts.sessionId, tick]);
}
