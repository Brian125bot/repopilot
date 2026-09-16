import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as evaluatePOST } from '@/app/api/audit/evaluate/route';
import { POST as fetchDiffPOST } from '@/app/api/audit/fetch-diff/route';
import { evaluateDiffAgainstCriteria } from '@/lib/gemini';
import {
  buildOutcomeRow,
  updateOutcomeRow,
  exportOutcomeLog,
} from '@/lib/outcome-memory';
import type { Blueprint } from '@/types';

vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    evaluateDiffAgainstCriteria: vi.fn(),
  };
});

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';

describe('COR-40 Evaluate persists auditedHeadSha', () => {
  beforeEach(() => {
    vi.mocked(evaluateDiffAgainstCriteria).mockReset();
  });

  it('successful evaluate writes auditedHeadSha onto report and top-level', async () => {
    const { reconcileAuditReport } = await import('@/lib/scoring');
    const base = {
      criteriaResults: [
        {
          id: '1',
          criterion: 'Works',
          status: 'MET' as const,
          evidence: 'ok',
          lineReferences: [] as string[],
        },
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
        prMetadata: { title: 'PR', number: 42, headBranch: 'jules/x', headSha: SHA },
      }),
    });
    const res = await evaluatePOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report.auditedHeadSha).toBe(SHA);
    expect(data.auditedHeadSha).toBe(SHA);
  });

  it('evaluate without SHA stores null (remediation stays blocked)', async () => {
    const { reconcileAuditReport } = await import('@/lib/scoring');
    const base = {
      criteriaResults: [
        {
          id: '1',
          criterion: 'Works',
          status: 'MET' as const,
          evidence: 'ok',
          lineReferences: [] as string[],
        },
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
    expect(data.auditedHeadSha).toBeNull();
  });

  it('blueprint + outcome log carry the SHA that was graded', () => {
    const blueprint: Blueprint = {
      blueprintId: 'bp_cor40_persist',
      repo: 'acme-corp/api-gateway',
      baseBranch: 'main',
      branchName: 'jules/x',
      fileBoundaries: ['src/**'],
      objective: 'Works',
      criteria: [],
      createdAt: new Date().toISOString(),
      auditedHeadSha: SHA,
    };
    const row = buildOutcomeRow({
      blueprint,
      turn: 'initial',
      usedPriorSession: false,
      verdict: 'NEEDS_REVISION',
      score: 62,
      unauthorizedCount: 0,
      unmetIds: ['1'],
    });
    expect(row.auditedHeadSha).toBe(SHA);

    const patched = updateOutcomeRow([row], { blueprintId: blueprint.blueprintId }, { auditedHeadSha: SHA });
    expect(patched[0].auditedHeadSha).toBe(SHA);
    expect(exportOutcomeLog(patched)).toContain(SHA);
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
    expect(data.headSha).toBeNull();
  });
});
