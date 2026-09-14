import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as dispatchPOST } from '@/app/api/jules/dispatch/route';
import { POST as evaluatePOST } from '@/app/api/audit/evaluate/route';
import { POST as fetchDiffPOST } from '@/app/api/audit/fetch-diff/route';
import { JulesDispatchBodySchema } from '@/lib/validation';
import { normalizeHeadSha, isHeadStale } from '@/lib/github';
import {
  buildFailureBrief,
  buildOutcomeRow,
  compileContinuationPrompt,
  updateOutcomeRow,
} from '@/lib/outcome-memory';
import { compileRemediationPrompt } from '@/lib/prompt-compiler';
import { evaluateDiffAgainstCriteria } from '@/lib/gemini';
import type { Blueprint, GeminiAuditReport } from '@/types';

vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    evaluateDiffAgainstCriteria: vi.fn(),
  };
});

const AUDITED_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
const MOVED_SHA = 'ffffffffffffffffffffffffffffffffffffffff';

function remediationBody(overrides: Record<string, unknown> = {}) {
  return {
    repo: 'acme-corp/api-gateway',
    baseBranch: 'main',
    branchName: 'jules/rate-limiter-redis',
    startingBranch: 'jules/rate-limiter-redis',
    isRemediation: true,
    prNumber: 42,
    prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
    objective: 'Remediate PR #42 on branch "jules/rate-limiter-redis": address audit blockers',
    criteria: [{ id: '1', text: 'Fix in src verified by test', category: 'functional' }],
    dryRun: true,
    ...overrides,
  };
}

function dispatchReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/jules/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const blueprintFixture: Blueprint = {
  blueprintId: 'bp_cor40_1',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/rate-limiter-redis',
  fileBoundaries: ['src/middleware/**'],
  objective: 'Implement limiter',
  criteria: [],
  createdAt: new Date().toISOString(),
  sessionId: 'sessions/cor40',
  auditedHeadSha: AUDITED_SHA,
};

const reportFixture: GeminiAuditReport = {
  criteriaResults: [
    { id: '1', criterion: 'Works', status: 'UNMET', evidence: 'Missing', lineReferences: [] },
  ],
  scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
  blastRadius: { rating: 'LOW', explanation: 'Small.' },
  mergeVerdict: {
    status: 'NEEDS_REVISION',
    overallScore: 62,
    keyBlockers: ['Missing TTL'],
    actionableFeedbackForAgent: 'Add TTL.',
  },
  auditedHeadSha: AUDITED_SHA,
};

describe('COR-40 auditedHeadSha helpers', () => {
  it('normalizeHeadSha trims or returns null', () => {
    expect(normalizeHeadSha('  abc123  ')).toBe('abc123');
    expect(normalizeHeadSha('')).toBeNull();
    expect(normalizeHeadSha(null)).toBeNull();
    expect(normalizeHeadSha(undefined)).toBeNull();
  });

  it('isHeadStale detects drift case-insensitively, never on missing sides', () => {
    expect(isHeadStale(AUDITED_SHA, AUDITED_SHA)).toBe(false);
    expect(isHeadStale(AUDITED_SHA, AUDITED_SHA.toUpperCase())).toBe(false);
    expect(isHeadStale(AUDITED_SHA, MOVED_SHA)).toBe(true);
    expect(isHeadStale(null, MOVED_SHA)).toBe(false);
    expect(isHeadStale(AUDITED_SHA, null)).toBe(false);
    expect(isHeadStale(null, null)).toBe(false);
  });
});

describe('COR-40 dispatch gate: audited SHA lock', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('missing SHA blocks remediation', async () => {
    const parsed = JulesDispatchBodySchema.safeParse(remediationBody({ auditedHeadSha: undefined }));
    expect(parsed.success).toBe(false);

    const res = await dispatchPOST(dispatchReq(remediationBody({ auditedHeadSha: undefined })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(String(data.error || data.message || '')).toMatch(/re-evaluate/i);
  });

  it('null SHA blocks remediation until re-evaluate', async () => {
    const res = await dispatchPOST(dispatchReq(remediationBody({ auditedHeadSha: null })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error || '')).toMatch(/re-evaluate/i);
  });

  it('mismatch blocks remediation with head-moved message', async () => {
    const parsed = JulesDispatchBodySchema.safeParse(
      remediationBody({ auditedHeadSha: AUDITED_SHA, currentHeadSha: MOVED_SHA })
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/Head moved since audit/);
    }

    const res = await dispatchPOST(
      dispatchReq(remediationBody({ auditedHeadSha: AUDITED_SHA, currentHeadSha: MOVED_SHA }))
    );
    expect([400, 409]).toContain(res.status);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(String(data.error || data.message || '')).toMatch(/Head moved since audit/);
  });

  it('match allows remediation (dryRun)', async () => {
    const res = await dispatchPOST(
      dispatchReq(remediationBody({ auditedHeadSha: AUDITED_SHA, currentHeadSha: AUDITED_SHA }))
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.blueprint.auditedHeadSha).toBe(AUDITED_SHA);
  });

  it('omitted currentHeadSha allows when audited SHA present', async () => {
    const res = await dispatchPOST(dispatchReq(remediationBody({ auditedHeadSha: AUDITED_SHA })));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('first-pass dispatch does not require a SHA', async () => {
    const res = await dispatchPOST(
      dispatchReq({
        repo: 'acme-corp/api-gateway',
        baseBranch: 'main',
        branchName: 'jules/first-pass',
        objective: 'Implement limiter in src verified by tests',
        criteria: [{ id: '1', text: 'Enforce limit in src verified by test', category: 'functional' }],
        dryRun: true,
        isRemediation: false,
      })
    );
    expect(res.status).toBe(200);
  });
});

describe('COR-40 Evaluate persists auditedHeadSha', () => {
  beforeEach(() => {
    vi.mocked(evaluateDiffAgainstCriteria).mockReset();
  });

  it('Evaluate returns the PR head SHA as auditedHeadSha', async () => {
    const { reconcileAuditReport } = await import('@/lib/scoring');
    const base = {
      criteriaResults: [
        { id: '1', criterion: 'Works', status: 'MET' as const, evidence: 'ok', lineReferences: [] as string[] },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [] as string[], explanation: 'Clean.' },
      blastRadius: { rating: 'LOW' as const, explanation: 'Small.' },
      mergeVerdict: {
        status: 'READY_TO_MERGE' as const,
        overallScore: 100,
        keyBlockers: [] as string[],
        actionableFeedbackForAgent: 'None',
      },
    };
    vi.mocked(evaluateDiffAgainstCriteria).mockResolvedValue({
      ...reconcileAuditReport(base, []),
      evaluatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        diff: 'diff --git a/src/a.ts b/src/a.ts\n+hello',
        criteria: [{ id: '1', text: 'Works' }],
        prMetadata: { title: 'PR', number: 42, headBranch: 'jules/x', headSha: AUDITED_SHA },
      }),
    });
    const res = await evaluatePOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report.auditedHeadSha).toBe(AUDITED_SHA);
    expect(data.auditedHeadSha).toBe(AUDITED_SHA);
  });

  it('Evaluate with missing SHA stores null (remediation stays blocked)', async () => {
    const { reconcileAuditReport } = await import('@/lib/scoring');
    const base = {
      criteriaResults: [
        { id: '1', criterion: 'Works', status: 'MET' as const, evidence: 'ok', lineReferences: [] as string[] },
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [] as string[], explanation: 'Clean.' },
      blastRadius: { rating: 'LOW' as const, explanation: 'Small.' },
      mergeVerdict: {
        status: 'READY_TO_MERGE' as const,
        overallScore: 100,
        keyBlockers: [] as string[],
        actionableFeedbackForAgent: 'None',
      },
    };
    vi.mocked(evaluateDiffAgainstCriteria).mockResolvedValue({
      ...reconcileAuditReport(base, []),
      evaluatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        diff: 'diff --git a/src/a.ts b/src/a.ts\n+hello',
        criteria: [{ id: '1', text: 'Works' }],
        prMetadata: { title: 'PR', number: 42, headBranch: 'jules/x' },
      }),
    });
    const res = await evaluatePOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report.auditedHeadSha).toBeNull();
  });

  it('Evaluate writes the SHA onto a blueprint fixture (client persist step)', () => {
    // Mirrors AuditEvaluationStage.handleRunAudit: report SHA -> blueprint + outcome row.
    const evaluated: GeminiAuditReport = { ...reportFixture, auditedHeadSha: AUDITED_SHA };
    const bare: Blueprint = { ...blueprintFixture, auditedHeadSha: undefined };
    const persisted: Blueprint = { ...bare, auditedHeadSha: evaluated.auditedHeadSha };

    expect(persisted.auditedHeadSha).toBe(AUDITED_SHA);

    const row = buildOutcomeRow({
      blueprint: persisted,
      turn: 'initial',
      usedPriorSession: false,
      verdict: 'NEEDS_REVISION',
      score: 62,
      unauthorizedCount: 0,
      unmetIds: ['1'],
    });
    expect(row.auditedHeadSha).toBe(AUDITED_SHA);

    const patched = updateOutcomeRow([row], { blueprintId: persisted.blueprintId }, { auditedHeadSha: AUDITED_SHA });
    expect(patched[0].auditedHeadSha).toBe(AUDITED_SHA);
  });
});

describe('COR-40 prompts carry the SHA in the branch-lock block', () => {
  it('FailureBrief carries the audited SHA from blueprint/report', () => {
    const brief = buildFailureBrief(reportFixture, blueprintFixture, []);
    expect(brief.auditedHeadSha).toBe(AUDITED_SHA);
  });

  it('compileContinuationPrompt includes the SHA in the branch lock', () => {
    const brief = buildFailureBrief(reportFixture, blueprintFixture, []);
    const prompt = compileContinuationPrompt({ blueprint: blueprintFixture, brief });
    expect(prompt).toContain('Branch lock');
    expect(prompt).toContain(AUDITED_SHA);
  });

  it('compileContinuationPrompt states missing SHA when none was locked', () => {
    const bare: Blueprint = { ...blueprintFixture, auditedHeadSha: null };
    const noShaReport: GeminiAuditReport = { ...reportFixture, auditedHeadSha: null };
    const brief = buildFailureBrief(noShaReport, bare, []);
    const prompt = compileContinuationPrompt({ blueprint: bare, brief });
    expect(prompt).toContain('missing');
    expect(prompt).toMatch(/re-evaluate/i);
  });

  it('compileRemediationPrompt includes the SHA in MET/branch-lock block', () => {
    const prompt = compileRemediationPrompt({
      targetBranch: 'jules/rate-limiter-redis',
      baseBranch: 'main',
      prNumber: 42,
      prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
      report: reportFixture,
      fileBoundaries: ['src/middleware/**'],
      auditedHeadSha: AUDITED_SHA,
    });
    expect(prompt).toContain(AUDITED_SHA);
    expect(prompt).toContain('jules/rate-limiter-redis');
  });
});

describe('COR-40 fetch-diff exposes headSha', () => {
  it('raw diff returns null headSha', async () => {
    const req = new NextRequest('http://localhost:3000/api/audit/fetch-diff', {
      method: 'POST',
      body: JSON.stringify({
        rawDiff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
      }),
    });
    const res = await fetchDiffPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pr.headSha).toBeNull();
  });

  it('GitHub PR ingest returns head.sha as pr.headSha', async () => {
    const diffText = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : (input as { url: string }).url);
      const accept = String((init?.headers as Record<string, string> | undefined)?.Accept || '');
      if (url.includes('/pulls/42') && accept.includes('diff')) {
        return { ok: true, status: 200, text: async () => diffText } as unknown as Response;
      }
      if (url.includes('/pulls/42')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: 'Add limiter',
            number: 42,
            user: { login: 'jules-agent' },
            html_url: 'https://github.com/acme-corp/api-gateway/pull/42',
            base: { ref: 'main' },
            head: { ref: 'jules/rate-limiter', sha: AUDITED_SHA },
            state: 'open',
            body: '',
          }),
        } as unknown as Response;
      }
      if (url.includes('/commits/')) {
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    });
    try {
      const req = new NextRequest('http://localhost:3000/api/audit/fetch-diff', {
        method: 'POST',
        body: JSON.stringify({ prUrl: 'https://github.com/acme-corp/api-gateway/pull/42' }),
      });
      const res = await fetchDiffPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pr.headSha).toBe(AUDITED_SHA);
      expect(data.headSha).toBe(AUDITED_SHA);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
