import { describe, expect, it } from 'vitest';
import {
  DIRECTIVE_SECTION_HEADING,
  INTERACTIVE_TURN_ENDPOINT,
  MISSING_PR_METADATA_MESSAGE,
  NO_ACTIVE_SESSION_MESSAGE,
  snippetSendBlockReason,
  buildInteractiveTurnBody,
  compileInteractiveTurnPrompt,
  sendInteractiveTurn,
  type InteractiveTurnParams,
} from './send';
import type { Blueprint, FailureBrief } from '@/types';

const STAMP = '2026-09-01T12:00:00.000Z';
const AUDITED_SHA = 'abc123def456789';
const AUDITED_BRANCH = 'feature/audited-pr-head';
const SESSION_ID = 'sessions/abc123';

function blueprint(
  overrides: Partial<Blueprint> = {}
): Blueprint {
  return {
    blueprintId: 'bp_test_123',
    repo: 'acme-corp/api-gateway',
    baseBranch: 'main',
    branchName: 'jules/remediate-auth',
    fileBoundaries: ['lib/**', 'components/**'],
    objective: 'Fix the failing auth tests',
    criteria: [
      { id: 'crit-1', text: 'All tests pass', category: 'testing' },
    ],
    createdAt: STAMP,
    sessionId: 'sessions/abc123',
    sessionUrl: 'https://jules.google.com/session/abc123',
    sessionState: 'EXECUTING',
    prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
    auditedHeadSha: AUDITED_SHA,
    ...overrides,
  };
}

function brief(
  overrides: Partial<FailureBrief> = {}
): FailureBrief {
  return {
    verdict: 'NEEDS_REVISION',
    score: 62,
    unmetIds: ['crit-1'],
    partialIds: [],
    metIds: [],
    unauthorizedPaths: [],
    doNotTouch: [],
    requiredFixes: [
      '[UNMET] Criterion crit-1: All tests pass — Remaining: 2 failing',
    ],
    ...overrides,
  };
}

function params(
  overrides: Partial<InteractiveTurnParams> = {}
): InteractiveTurnParams {
  return {
    blueprint: blueprint(),
    brief: brief(),
    directive: 'Run the relevant tests',
    julesApiKey: 'jules-test-key',
    targetBranch: AUDITED_BRANCH,
    sessionId: SESSION_ID,
    canContinue: true,
    requireVerifiedKey: () => true,
    checkHeadFreshness: async () => ({ ok: true, audited: AUDITED_SHA, live: AUDITED_SHA }),
    prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
    ...overrides,
  };
}

/** Hermetic Response stand-in — no undici dependency. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function mockFetch(response: {
  status?: number;
  body?: unknown;
}): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return jsonResponse(
      response.status ?? 200,
      response.body ?? {}
    );
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('compileInteractiveTurnPrompt', () => {
  const base = {
    blueprint: blueprint(),
    brief: brief(),
    directive: '  Run the relevant tests  ',
    targetBranch: AUDITED_BRANCH,
    auditedHeadSha: AUDITED_SHA,
  };

  it('compiles the continuation contract and appends the trimmed directive', () => {
    const prompt = compileInteractiveTurnPrompt(base);
    expect(prompt).toContain('Continuation Contract');
    expect(prompt).toContain('LOCKED AUDITED SHA: ' + AUDITED_SHA);
    expect(prompt).toContain(DIRECTIVE_SECTION_HEADING);
    expect(prompt).toContain('\nRun the relevant tests');
    expect(prompt).not.toContain('  Run the relevant tests  ');
    expect(prompt.indexOf(DIRECTIVE_SECTION_HEADING)).toBeGreaterThan(
      prompt.indexOf('LOCKED AUDITED SHA')
    );
  });

  it('locks the audited branch even when blueprint.branchName differs', () => {
    const prompt = compileInteractiveTurnPrompt({
      ...base,
      blueprint: blueprint({ branchName: 'jules/stale-other-branch' }),
    });
    expect(prompt).toContain(`LOCKED HEAD BRANCH: ${AUDITED_BRANCH}`);
    expect(prompt).not.toContain('jules/stale-other-branch');
  });

  it('uses the supplied audited SHA over the blueprint field', () => {
    const prompt = compileInteractiveTurnPrompt({
      ...base,
      blueprint: blueprint({ auditedHeadSha: null }),
    });
    expect(prompt).toContain('LOCKED AUDITED SHA: ' + AUDITED_SHA);
  });

  it('throws when no audited head SHA is supplied', () => {
    expect(() =>
      compileInteractiveTurnPrompt({ ...base, auditedHeadSha: '' })
    ).toThrow(/audited head SHA/i);
  });
});

describe('buildInteractiveTurnBody', () => {
  it('builds the exact /api/jules/message body', () => {
    expect(
      buildInteractiveTurnBody({
        sessionId: SESSION_ID,
        prompt: 'p',
        auditedHeadSha: ` ${AUDITED_SHA} `,
        currentHeadSha: AUDITED_SHA,
      })
    ).toEqual({
      sessionId: SESSION_ID,
      prompt: 'p',
      isRemediation: true,
      auditedHeadSha: AUDITED_SHA,
      currentHeadSha: AUDITED_SHA,
    });
  });
});

describe('sendInteractiveTurn', () => {
  function body(calls: Array<{ init: RequestInit }>): Record<string, unknown> {
    return JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  }

  it('replies in the current session via /api/jules/message, never dispatch', async () => {
    const { fetchFn, calls } = mockFetch({
      body: { success: true, sessionId: SESSION_ID, sessionUrl: 'https://jules.google.com/session/abc123' },
    });
    const result = await sendInteractiveTurn(params({ fetchFn }));

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.auditedHeadSha).toBe(AUDITED_SHA);
    expect(calls).toHaveLength(1);
    expect(INTERACTIVE_TURN_ENDPOINT).toBe('/api/jules/message');
    expect(calls[0].url).toBe('/api/jules/message');
    expect(calls.some((c) => c.url.includes('/api/jules/dispatch'))).toBe(false);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-jules-api-key']).toBe('jules-test-key');
    const sent = body(calls);
    expect(sent.sessionId).toBe(SESSION_ID);
    expect(sent.isRemediation).toBe(true);
    expect(sent.auditedHeadSha).toBe(AUDITED_SHA);
    expect(sent.currentHeadSha).toBe(AUDITED_SHA);
    expect(String(sent.prompt)).toContain('Run the relevant tests');
    expect(String(sent.prompt)).toContain(`LOCKED HEAD BRANCH: ${AUDITED_BRANCH}`);
    // Key only in the header.
    expect(JSON.stringify(sent)).not.toContain('jules-test-key');
    expect(sent).not.toHaveProperty('startingBranch');
  });

  it('targets the audited branch when blueprint.branchName differs', async () => {
    const { fetchFn, calls } = mockFetch({ body: { success: true } });
    await sendInteractiveTurn(
      params({ fetchFn, blueprint: blueprint({ branchName: 'jules/stale-other-branch' }) })
    );
    const prompt = String(body(calls).prompt);
    expect(prompt).toContain(`LOCKED HEAD BRANCH: ${AUDITED_BRANCH}`);
    expect(prompt).not.toContain('jules/stale-other-branch');
  });

  it('locks to freshness.audited even when the blueprint has no SHA', async () => {
    const { fetchFn, calls } = mockFetch({ body: { success: true } });
    const result = await sendInteractiveTurn(
      params({ fetchFn, blueprint: blueprint({ auditedHeadSha: null }) })
    );
    expect(result.ok).toBe(true);
    expect(body(calls).auditedHeadSha).toBe(AUDITED_SHA);
  });

  it('leaves the blueprint unchanged', async () => {
    const bp = blueprint();
    const snapshot = JSON.parse(JSON.stringify(bp));
    const { fetchFn } = mockFetch({ body: { success: true, sessionId: 'sessions/other' } });
    const result = await sendInteractiveTurn(params({ fetchFn, blueprint: bp }));
    expect(result.ok).toBe(true);
    expect(bp).toEqual(snapshot);
    expect(result).not.toHaveProperty('blueprint');
  });

  it('runs the key gate before the freshness gate', async () => {
    const order: string[] = [];
    const { fetchFn } = mockFetch({ body: { success: true } });
    await sendInteractiveTurn(
      params({
        fetchFn,
        requireVerifiedKey: () => { order.push('key'); return true; },
        checkHeadFreshness: async () => { order.push('fresh'); return { ok: true, audited: AUDITED_SHA, live: AUDITED_SHA }; },
      })
    );
    expect(order).toEqual(['key', 'fresh']);
  });

  it('refuses when the key gate fails, without checking freshness or fetching', async () => {
    let checked = false;
    const { fetchFn, calls } = mockFetch({});
    const result = await sendInteractiveTurn(
      params({
        fetchFn,
        requireVerifiedKey: () => false,
        checkHeadFreshness: async () => { checked = true; return { ok: true, audited: AUDITED_SHA, live: AUDITED_SHA }; },
      })
    );
    expect(result.ok).toBe(false);
    expect(checked).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses when the head moved', async () => {
    const { fetchFn, calls } = mockFetch({});
    const result = await sendInteractiveTurn(
      params({
        fetchFn,
        checkHeadFreshness: async () => ({ ok: false, error: 'Head moved since audit — re-evaluate.' }),
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Head moved since audit — re-evaluate.');
    expect(calls).toHaveLength(0);
  });

  it('refuses when the live head is missing or differs even if the gate passed', async () => {
    for (const live of [null, 'fffffff0000000']) {
      const { fetchFn, calls } = mockFetch({});
      const result = await sendInteractiveTurn(
        params({ fetchFn, checkHeadFreshness: async () => ({ ok: true, audited: AUDITED_SHA, live }) })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Head moved');
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses when the audited SHA is missing', async () => {
    const { fetchFn, calls } = mockFetch({});
    const result = await sendInteractiveTurn(
      params({ fetchFn, checkHeadFreshness: async () => ({ ok: true, audited: '', live: AUDITED_SHA }) })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('re-evaluate');
    expect(calls).toHaveLength(0);
  });

  it('refuses without a live session and never falls back to dispatch', async () => {
    for (const p of [{ canContinue: false }, { sessionId: null }, { sessionId: '  ' }]) {
      const { fetchFn, calls } = mockFetch({});
      const result = await sendInteractiveTurn(params({ fetchFn, ...p }));
      expect(result.ok).toBe(false);
      expect(result.error).toBe(NO_ACTIVE_SESSION_MESSAGE);
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses when PR metadata is missing (no audited branch), with no fallback', async () => {
    for (const targetBranch of ['', '   ']) {
      const { fetchFn, calls } = mockFetch({});
      const result = await sendInteractiveTurn(params({ fetchFn, targetBranch }));
      expect(result.ok).toBe(false);
      expect(result.error).toBe(MISSING_PR_METADATA_MESSAGE);
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses an empty directive without fetching', async () => {
    const { fetchFn, calls } = mockFetch({});
    const result = await sendInteractiveTurn(params({ directive: '   ', fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('sends no api-key header when the key is empty', async () => {
    const { fetchFn, calls } = mockFetch({ body: { success: true } });
    await sendInteractiveTurn(params({ julesApiKey: '', fetchFn }));
    expect((calls[0].init.headers as Record<string, string>)['x-jules-api-key']).toBeUndefined();
  });

  it('propagates server errors fail-closed', async () => {
    const { fetchFn } = mockFetch({ status: 409, body: { success: false, error: 'Head moved since audit — re-evaluate.' } });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.error).toBe('Head moved since audit — re-evaluate.');
  });

  it('treats a success:false body as a failure', async () => {
    const { fetchFn } = mockFetch({ status: 200, body: { success: false, error: 'Nope.' } });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Nope.');
  });

  it('falls back to an HTTP error message when the body has none', async () => {
    const { fetchFn } = mockFetch({ status: 500, body: {} });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.error).toContain('HTTP 500');
  });

  it('maps a network failure to a 502', async () => {
    const fetchFn = (async () => { throw new Error('fetch failed'); }) as typeof fetch;
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.status).toBe(502);
    expect(result.error).toBe('fetch failed');
  });
});

describe('snippetSendBlockReason', () => {
  const ok = { canContinue: true, sessionId: SESSION_ID, targetBranch: AUDITED_BRANCH };
  it('allows a live session with an audited branch', () => {
    expect(snippetSendBlockReason(ok)).toBeNull();
  });
  it('blocks without a live session', () => {
    expect(snippetSendBlockReason({ ...ok, canContinue: false })).toBe(NO_ACTIVE_SESSION_MESSAGE);
    expect(snippetSendBlockReason({ ...ok, sessionId: null })).toBe(NO_ACTIVE_SESSION_MESSAGE);
  });
  it('blocks when PR metadata is missing', () => {
    expect(snippetSendBlockReason({ ...ok, targetBranch: '' })).toBe(MISSING_PR_METADATA_MESSAGE);
  });
});
