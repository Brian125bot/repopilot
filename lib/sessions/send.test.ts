import { describe, expect, it } from 'vitest';
import {
  DIRECTIVE_SECTION_HEADING,
  INTERACTIVE_TURN_ENDPOINT,
  buildInteractiveTurnBody,
  compileInteractiveTurnPrompt,
  sendInteractiveTurn,
  type InteractiveTurnParams,
} from './send';
import type { Blueprint, FailureBrief } from '@/types';

const STAMP = '2026-09-01T12:00:00.000Z';
const AUDITED_SHA = 'abc123def456789';

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
    currentHeadSha: AUDITED_SHA,
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
  it('compiles the continuation contract and appends the directive', () => {
    const prompt = compileInteractiveTurnPrompt(params());

    // COR-39 continuation compiler output is present…
    expect(prompt).toContain('Continuation Contract');
    expect(prompt).toContain('Fix the failing auth tests');
    expect(prompt).toContain('LOCKED AUDITED SHA: ' + AUDITED_SHA);
    // …and the operator directive is the final section.
    expect(prompt).toContain(DIRECTIVE_SECTION_HEADING);
    expect(prompt).toContain('Run the relevant tests');
    expect(prompt.indexOf(DIRECTIVE_SECTION_HEADING)).toBeGreaterThan(
      prompt.indexOf('LOCKED AUDITED SHA')
    );
  });

  it('trims the directive', () => {
    const prompt = compileInteractiveTurnPrompt(
      params({ directive: '  Run the relevant tests  ' })
    );
    expect(prompt).toContain('Run the relevant tests');
    expect(prompt).not.toContain('  Run the relevant tests  ');
  });

  it('throws when the blueprint carries no audited head SHA', () => {
    expect(() =>
      compileInteractiveTurnPrompt(
        params({ blueprint: blueprint({ auditedHeadSha: null }) })
      )
    ).toThrow(/audited head SHA/i);
  });
});

describe('buildInteractiveTurnBody', () => {
  it('builds the exact continuation dispatch body', () => {
    const body = buildInteractiveTurnBody(params());

    expect(body.repo).toBe('acme-corp/api-gateway');
    expect(body.baseBranch).toBe('main');
    expect(body.branchName).toBe('jules/remediate-auth');
    expect(body.startingBranch).toBe('jules/remediate-auth');
    expect(body.isRemediation).toBe(true);
    expect(body.auditedHeadSha).toBe(AUDITED_SHA);
    expect(body.currentHeadSha).toBe(AUDITED_SHA);
    expect(body.customPrompt).toContain('Run the relevant tests');
    expect(body.objective).toContain('jules/remediate-auth');
    expect(body.fileBoundaries).toEqual(['lib/**', 'components/**']);
    expect(body.criteria).toEqual([
      { id: 'crit-1', text: 'All tests pass', category: 'testing' },
    ]);
  });

  it('carries the PR reference when given', () => {
    const body = buildInteractiveTurnBody(
      params({ prNumber: 42, prUrl: 'https://github.com/acme-corp/api-gateway/pull/42' })
    );
    expect(body.prNumber).toBe(42);
    expect(body.prUrl).toBe('https://github.com/acme-corp/api-gateway/pull/42');
  });

  it('omits optional fields when absent', () => {
    const body = buildInteractiveTurnBody(
      params({
        prNumber: undefined,
        prUrl: undefined,
        blueprint: blueprint({
          fileBoundaries: [],
          criteria: [],
        }),
      })
    );
    expect(body.prNumber).toBeUndefined();
    expect(body.prUrl).toBeUndefined();
    expect(body.fileBoundaries).toBeUndefined();
    expect(body.criteria).toBeUndefined();
  });

  it('normalizes the current head SHA', () => {
    const body = buildInteractiveTurnBody(
      params({ currentHeadSha: `  ${AUDITED_SHA}  ` })
    );
    expect(body.currentHeadSha).toBe(AUDITED_SHA);
  });
});

describe('sendInteractiveTurn', () => {
  it('dispatches through the continuation path and rebinds the blueprint', async () => {
    const { fetchFn, calls } = mockFetch({
      body: {
        success: true,
        sessionId: 'sessions/new456',
        sessionUrl: 'https://jules.google.com/session/new456',
        sessionState: 'EXECUTING',
      },
    });

    const result = await sendInteractiveTurn(
      params({ fetchFn })
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.sessionId).toBe('sessions/new456');
    expect(result.sessionUrl).toBe(
      'https://jules.google.com/session/new456'
    );
    expect(result.sessionState).toBe('EXECUTING');

    // Exactly one call to the existing dispatch endpoint.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(INTERACTIVE_TURN_ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect(
      (calls[0].init.headers as Record<string, string>)['x-jules-api-key']
    ).toBe('jules-test-key');

    const sent = JSON.parse(
      String(calls[0].init.body)
    ) as Record<string, unknown>;
    expect(sent.isRemediation).toBe(true);
    expect(sent.auditedHeadSha).toBe(AUDITED_SHA);
    expect(sent.currentHeadSha).toBe(AUDITED_SHA);
    expect(String(sent.customPrompt)).toContain('Run the relevant tests');

    // applyNewRemediationSession rebound the blueprint.
    expect(result.blueprint?.sessionId).toBe('sessions/new456');
    expect(result.blueprint?.sessionUrl).toBe(
      'https://jules.google.com/session/new456'
    );
    expect(result.blueprint?.sessionState).toBe('EXECUTING');
    expect(result.blueprint?.isRemediation).toBe(true);
    // The audited-branch contract survives the rebind.
    expect(result.blueprint?.auditedHeadSha).toBe(AUDITED_SHA);
    expect(result.blueprint?.branchName).toBe('jules/remediate-auth');
    // The operator-reviewed prompt is stamped on the blueprint.
    expect(result.blueprint?.compiledPrompt).toBe(result.compiledPrompt);
    expect(result.blueprint?.compiledPrompt).toContain(
      'Run the relevant tests'
    );
  });

  it('sends no api-key header when the key is empty', async () => {
    const { fetchFn, calls } = mockFetch({
      body: { success: true, sessionId: 'sessions/new456' },
    });
    await sendInteractiveTurn(params({ julesApiKey: '', fetchFn }));
    expect(
      (calls[0].init.headers as Record<string, string>)['x-jules-api-key']
    ).toBeUndefined();
  });

  it('refuses an empty directive without dispatching', async () => {
    const { fetchFn, calls } = mockFetch({});
    const result = await sendInteractiveTurn(
      params({ directive: '   ', fetchFn })
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('Directive is required');
    expect(calls).toHaveLength(0);
  });

  it('refuses a blueprint without an audited head SHA', async () => {
    const { fetchFn, calls } = mockFetch({});
    const result = await sendInteractiveTurn(
      params({
        blueprint: blueprint({ auditedHeadSha: null }),
        fetchFn,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('re-evaluate');
    expect(calls).toHaveLength(0);
  });

  it('propagates dispatch errors fail-closed', async () => {
    const { fetchFn } = mockFetch({
      status: 409,
      body: {
        success: false,
        error: 'Head moved since audit — re-evaluate.',
      },
    });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.error).toBe('Head moved since audit — re-evaluate.');
    expect(result.blueprint).toBeUndefined();
  });

  it('treats a success:false body as a failure', async () => {
    const { fetchFn } = mockFetch({
      status: 200,
      body: { success: false, error: 'Remediation blocked.' },
    });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Remediation blocked.');
  });

  it('falls back to an HTTP error message when the body has none', async () => {
    const { fetchFn } = mockFetch({ status: 500, body: {} });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 500');
  });

  it('maps a network failure to a 502', async () => {
    const fetchFn = (async () => {
      throw new Error('fetch failed');
    }) as typeof fetch;
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe('fetch failed');
  });

  it('refuses a dispatch response without a session id', async () => {
    const { fetchFn } = mockFetch({
      body: { success: true },
    });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain('no session id');
  });

  it('keeps the original session identity when the dispatch fails', async () => {
    const { fetchFn } = mockFetch({
      status: 400,
      body: { success: false, error: 'Bad input' },
    });
    const result = await sendInteractiveTurn(params({ fetchFn }));
    expect(result.blueprint).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });
});
