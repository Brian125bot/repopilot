import { describe, it, expect } from 'vitest';
import { Blueprint, GeminiAuditReport } from '@/types';
import {
  buildFailureBrief,
  compileContinuationPrompt,
  extractPathsFromReferences,
  applyNewRemediationSession,
  resolveContinueSessionId,
  shouldOfferContinueSession,
} from '@/lib/outcome-memory';

const blueprint: Blueprint = {
  blueprintId: 'bp_outcome_1',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/rate-limiter-redis',
  fileBoundaries: ['src/middleware/**', 'tests/middleware/**'],
  objective: 'Implement an IP-based sliding window rate limiter backed by Redis.',
  criteria: [],
  createdAt: new Date().toISOString(),
  sessionId: 'sessions/session_9',
  sessionUrl: 'https://jules.google.com/session/session_9',
  sessionState: 'COMPLETED',
  prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
  auditedHeadSha: 'abc123',
};

const buildReport = (overrides?: Partial<GeminiAuditReport>): GeminiAuditReport => ({
  criteriaResults: [
    {
      id: '1',
      criterion: 'Middleware extracts client IP',
      status: 'MET',
      evidence: 'IP extracted via x-forwarded-for',
      lineReferences: ['src/middleware/rate-limiter.ts:18-24'],
    },
    {
      id: '2',
      criterion: 'Sliding window enforces 60 req/min',
      status: 'UNMET',
      evidence: 'No TTL fallback in window calculation',
      lineReferences: ['src/middleware/rate-limiter.ts:45-52'],
    },
  ],
  scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Model says ok.' },
  blastRadius: { rating: 'LOW', explanation: 'Small diff' },
  mergeVerdict: {
    status: 'NEEDS_REVISION',
    overallScore: 62,
    keyBlockers: ['TTL fallback missing'],
    actionableFeedbackForAgent: 'Add TTL fallback.',
  },
  ...overrides,
});

describe('buildFailureBrief', () => {
  it('splits criterion ids by status and carries session fields from the blueprint', () => {
    const brief = buildFailureBrief(buildReport(), blueprint, []);

    expect(brief.metIds).toEqual(['1']);
    expect(brief.unmetIds).toEqual(['2']);
    expect(brief.partialIds).toEqual([]);
    expect(brief.sessionId).toBe('sessions/session_9');
    expect(brief.sessionState).toBe('COMPLETED');
    expect(brief.prUrl).toBe('https://github.com/acme-corp/api-gateway/pull/42');
    expect(brief.verdict).toBe('NEEDS_REVISION');
    expect(brief.score).toBe(62);
  });

  it('unions sanitizer paths add-only with model-flagged files', () => {
    const report = buildReport({
      scopeIntegrity: {
        strictlyInScope: false,
        unauthorizedFiles: ['tsconfig.json'],
        explanation: 'Model flagged one.',
      },
    });
    const brief = buildFailureBrief(report, blueprint, ['package.json']);

    expect(brief.unauthorizedPaths).toEqual(expect.arrayContaining(['package.json', 'tsconfig.json']));
    expect(new Set(brief.unauthorizedPaths).size).toBe(2);
  });

  it('doNotTouch unions unauthorized paths with MET-evidence paths only, inventing nothing', () => {
    const brief = buildFailureBrief(buildReport(), blueprint, ['package.json']);

    expect(brief.doNotTouch).toContain('package.json');
    expect(brief.doNotTouch).toContain('src/middleware/rate-limiter.ts');
    // Prose mentions without a path token must not leak in.
    expect(brief.doNotTouch).not.toContain('x-forwarded-for');
  });

  it('MET-only report yields empty requiredFixes', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Middleware extracts client IP',
          status: 'MET',
          evidence: 'Implemented',
          lineReferences: [],
        },
      ],
      mergeVerdict: {
        status: 'READY_TO_MERGE',
        overallScore: 100,
        keyBlockers: [],
        actionableFeedbackForAgent: 'None',
      },
    });
    const brief = buildFailureBrief(report, blueprint, []);

    expect(brief.requiredFixes).toEqual([]);
    expect(brief.unmetIds).toEqual([]);
  });

  it('caps requiredFixes at 7', () => {
    const report = buildReport({
      criteriaResults: Array.from({ length: 9 }, (_, i) => ({
        id: String(i + 1),
        criterion: `Criterion ${i + 1}`,
        status: 'UNMET' as const,
        evidence: 'Missing',
        lineReferences: [] as string[],
      })),
    });
    const brief = buildFailureBrief(report, blueprint, []);

    expect(brief.requiredFixes).toHaveLength(7);
  });
});

describe('extractPathsFromReferences', () => {
  it('takes path tokens and ignores prose', () => {
    expect(extractPathsFromReferences(['src/a.ts:1-3', 'see the docs', 'hunk @@ -1 +1 @@'])).toEqual([
      'src/a.ts',
    ]);
  });
});

describe('compileContinuationPrompt', () => {
  it('MET-only brief says do not reopen MET and opens no tasks', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Middleware extracts client IP',
          status: 'MET',
          evidence: 'Implemented',
          lineReferences: [],
        },
      ],
      mergeVerdict: {
        status: 'READY_TO_MERGE',
        overallScore: 100,
        keyBlockers: [],
        actionableFeedbackForAgent: 'None',
      },
    });
    const prompt = compileContinuationPrompt({
      blueprint,
      brief: buildFailureBrief(report, blueprint, []),
    });

    expect(prompt).toContain('do not reopen');
    expect(prompt).toContain('`1`');
    expect(prompt).not.toMatch(/\n1\. /);
  });

  it('lists unauthorized paths under revert and never as a feature task', () => {
    const prompt = compileContinuationPrompt({
      blueprint,
      brief: buildFailureBrief(buildReport(), blueprint, ['package.json']),
    });

    expect(prompt).toContain('Revert only');
    expect(prompt).toContain('`package.json`');
    expect(prompt).toContain('revert to base');
    const fixesSection = prompt.slice(prompt.indexOf('## 5. Required fixes'));
    expect(fixesSection).not.toContain('package.json');
  });

  it('READY brief with 0 unmet asks for no new work', () => {
    const report = buildReport({
      criteriaResults: [
        {
          id: '1',
          criterion: 'Works',
          status: 'MET',
          evidence: 'Yes',
          lineReferences: [],
        },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
      mergeVerdict: {
        status: 'READY_TO_MERGE',
        overallScore: 100,
        keyBlockers: [],
        actionableFeedbackForAgent: 'None',
      },
    });
    const prompt = compileContinuationPrompt({
      blueprint,
      brief: buildFailureBrief(report, blueprint, []),
    });

    expect(prompt).toContain('Do not start new work');
    expect(prompt).not.toMatch(/\n1\. /);
  });

  it('restates objective, boundaries, branch lock, and omits AUTO_CREATE_PR', () => {
    const prompt = compileContinuationPrompt({
      blueprint,
      brief: buildFailureBrief(buildReport(), blueprint, []),
    });

    it('embeds auditedHeadSha in compileContinuationPrompt Section 6', () => {
      const prompt = compileContinuationPrompt({
        blueprint,
        brief: buildFailureBrief(buildReport(), blueprint, []),
      });
      expect(prompt).toContain('## 6. Branch lock');
      expect(prompt).toContain('Audited head SHA: `abc123`');
    });

    it('propagates blueprint.auditedHeadSha into FailureBrief', () => {
      const brief = buildFailureBrief(buildReport(), blueprint, []);
      expect(brief.auditedHeadSha).toBe('abc123');
    });

    expect(prompt).toContain('Implement an IP-based sliding window rate limiter');
    expect(prompt).toContain('`src/middleware/**`');
    expect(prompt).toContain('`tests/middleware/**`');
    expect(prompt).toContain('`jules/rate-limiter-redis`');
    expect(prompt).toContain('https://github.com/acme-corp/api-gateway/pull/42');
    expect(prompt).toContain('1. [UNMET] Criterion 2');
    expect(prompt).not.toContain('AUTO_CREATE_PR');
    expect(prompt).not.toContain('package-lock.json');
  });

  it('caps total prompt near 4000 chars excluding the contract id line', () => {
    const report = buildReport({
      criteriaResults: Array.from({ length: 9 }, (_, i) => ({
        id: String(i + 1),
        criterion: `Very long criterion text ${'x'.repeat(300)}`,
        status: 'UNMET' as const,
        evidence: `Very long evidence ${'y'.repeat(500)}`,
        lineReferences: [] as string[],
      })),
    });
    const prompt = compileContinuationPrompt({
      blueprint,
      brief: buildFailureBrief(report, blueprint, ['package.json', 'a.ts', 'b.ts']),
    });
    const [header, ...rest] = prompt.split('\n');
    expect(header).toContain('bp_outcome_1');
    expect(rest.join('\n').length).toBeLessThanOrEqual(4100);
  });
});

describe('shouldOfferContinueSession / resolveContinueSessionId', () => {
  const withSession = { sessionId: 'sessions/abc123' };
  const withoutSession = { sessionId: '' };
  const whitespaceSession = { sessionId: '   ' };

  it('offers continue only for actionable audits with a live Jules session id', () => {
    expect(shouldOfferContinueSession('NEEDS_REVISION', withSession)).toBe(true);
    expect(shouldOfferContinueSession('BLOCKED', withSession)).toBe(true);
    expect(shouldOfferContinueSession('READY_TO_MERGE', withSession)).toBe(false);
    expect(shouldOfferContinueSession('NEEDS_REVISION', withoutSession)).toBe(false);
    expect(shouldOfferContinueSession('BLOCKED', whitespaceSession)).toBe(false);
    expect(shouldOfferContinueSession('BLOCKED', null)).toBe(false);
    expect(shouldOfferContinueSession(null, withSession)).toBe(false);
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED'])(
    'refuses continue when the Jules session is terminal: %s',
    (sessionState) => {
      expect(shouldOfferContinueSession('NEEDS_REVISION', { sessionId: 'sessions/abc123', sessionState })).toBe(false);
    }
  );

  it('refuses legacy sess_ ids and permits an in-progress sessions/ id', () => {
    expect(shouldOfferContinueSession('BLOCKED', { sessionId: 'sess_legacy', sessionState: 'IN_PROGRESS' })).toBe(false);
    expect(shouldOfferContinueSession('BLOCKED', { sessionId: 'sessions/live_123', sessionState: 'IN_PROGRESS' })).toBe(true);
  });

  it('falls back to a recently dispatched session id', () => {
    expect(shouldOfferContinueSession('BLOCKED', withoutSession, 'sessions/new456')).toBe(true);
    expect(shouldOfferContinueSession('READY_TO_MERGE', withoutSession, 'sessions/new456')).toBe(false);
  });

  it('resolves the most recent session id, never inventing one', () => {
    expect(resolveContinueSessionId(withSession, 'sessions/new456')).toBe('sessions/new456');
    expect(resolveContinueSessionId(withSession, null)).toBe('sessions/abc123');
    expect(resolveContinueSessionId(withoutSession, null)).toBeNull();
    expect(resolveContinueSessionId(null, null)).toBeNull();
  });
});

describe('applyNewRemediationSession', () => {
  it('replaces all persisted session fields after fallback creates a new session', () => {
    const rebound = applyNewRemediationSession(blueprint, {
      sessionId: 'sessions/remediation_456',
      sessionUrl: 'https://jules.google.com/session/remediation_456',
      sessionState: 'QUEUED',
    });

    expect(rebound.sessionId).toBe('sessions/remediation_456');
    expect(rebound.sessionId).not.toBe(blueprint.sessionId);
    expect(rebound.sessionUrl).toBe('https://jules.google.com/session/remediation_456');
    expect(rebound.sessionState).toBe('QUEUED');
    expect(rebound.blueprintId).toBe(blueprint.blueprintId);
  });
});
