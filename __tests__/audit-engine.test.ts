import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as evaluatePOST, GET as evaluateGET } from '@/app/api/audit/evaluate/route';
import { POST as fetchDiffPOST } from '@/app/api/audit/fetch-diff/route';
import { NextRequest } from 'next/server';
import { evaluateDiffAgainstCriteria } from '@/lib/gemini';

vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    evaluateDiffAgainstCriteria: vi.fn(),
  };
});

describe('Audit Engine & Evaluation Pipeline', () => {
  beforeEach(() => {
    vi.mocked(evaluateDiffAgainstCriteria).mockReset();
  });
  describe('/api/audit/fetch-diff Route', () => {
    it('accepts raw unified diff and returns structured sanitized result', async () => {
      const rawDiff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
`;
      const req = new NextRequest('http://localhost:3000/api/audit/fetch-diff', {
        method: 'POST',
        body: JSON.stringify({
          rawDiff,
          fileBoundaries: ['src/index.ts'],
        }),
      });

      const res = await fetchDiffPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.sanitizedResult.files).toHaveLength(1);
      expect(data.sanitizedResult.files[0].filename).toBe('src/index.ts');
      expect(data.sanitizedResult.files[0].isAuthorized).toBe(true);
    });

    it('rejects request when neither PR URL nor raw diff is provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/audit/fetch-diff', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await fetchDiffPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('/api/audit/evaluate Route', () => {
    it('GET reports server key presence without calling Gemini', async () => {
      const res = await evaluateGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(typeof data.hasServerKey).toBe('boolean');
      expect(evaluateDiffAgainstCriteria).not.toHaveBeenCalled();
    });

    it('rejects evaluation requests with empty diff', async () => {
      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: '',
          criteria: [{ id: '1', text: 'criterion' }],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Cannot evaluate empty diff');
    });

    it('rejects evaluation requests with missing criteria matrix', async () => {
      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: 'diff --git a/a.ts b/a.ts\n+hello',
          criteria: [],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Acceptance criteria matrix is required');
    });

    it('forwards sanitizer unauthorizedPaths so scope is forced (fail-closed scope)', async () => {
      const { reconcileAuditReport } = await import('@/lib/scoring');
      const optimistic = {
        criteriaResults: [
          { id: '1', criterion: 'Works', status: 'MET' as const, evidence: 'ok', lineReferences: [] },
        ],
        scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Model says ok.' },
        blastRadius: { rating: 'LOW' as const, explanation: 'Small.' },
        mergeVerdict: {
          status: 'READY_TO_MERGE' as const,
          overallScore: 99,
          keyBlockers: [],
          actionableFeedbackForAgent: 'None',
        },
      };
      const forced = reconcileAuditReport(optimistic, ['package.json']);

      vi.mocked(evaluateDiffAgainstCriteria).mockResolvedValue({
        ...forced,
        evaluatedAt: new Date().toISOString(),
      });

      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: 'diff --git a/package.json b/package.json\n+{}',
          criteria: [{ id: '1', text: 'No scope drift' }],
          fileBoundaries: ['src/**'],
          unauthorizedPaths: ['package.json'],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(200);
      expect(evaluateDiffAgainstCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ unauthorizedPaths: ['package.json'] })
      );
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.report.scopeIntegrity.strictlyInScope).toBe(false);
      expect(data.report.scopeIntegrity.unauthorizedFiles).toContain('package.json');
      expect(data.report.mergeVerdict.status).not.toBe('READY_TO_MERGE');
    });

    it('keeps scope clean when unauthorizedPaths is empty (no over-blocking)', async () => {
      const { reconcileAuditReport } = await import('@/lib/scoring');
      const clean = {
        criteriaResults: [
          { id: '1', criterion: 'Works', status: 'MET' as const, evidence: 'ok', lineReferences: [] },
        ],
        scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
        blastRadius: { rating: 'LOW' as const, explanation: 'Small.' },
        mergeVerdict: {
          status: 'READY_TO_MERGE' as const,
          overallScore: 100,
          keyBlockers: [],
          actionableFeedbackForAgent: 'None',
        },
      };

      vi.mocked(evaluateDiffAgainstCriteria).mockResolvedValue({
        ...reconcileAuditReport(clean, []),
        evaluatedAt: new Date().toISOString(),
      });

      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: 'diff --git a/src/a.ts b/src/a.ts\n+hello',
          criteria: [{ id: '1', text: 'Works' }],
          fileBoundaries: ['src/**'],
          unauthorizedPaths: [],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(200);
      expect(evaluateDiffAgainstCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ unauthorizedPaths: [] })
      );
      const data = await res.json();
      expect(data.report.scopeIntegrity.strictlyInScope).toBe(true);
    });

    it('re-derives unauthorized paths when the client omits them (union is add-only)', async () => {
      const { reconcileAuditReport } = await import('@/lib/scoring');
      const optimistic = {
        criteriaResults: [
          { id: '1', criterion: 'Works', status: 'MET' as const, evidence: 'ok', lineReferences: [] },
        ],
        scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Model says ok.' },
        blastRadius: { rating: 'LOW' as const, explanation: 'Small.' },
        mergeVerdict: {
          status: 'READY_TO_MERGE' as const,
          overallScore: 99,
          keyBlockers: [],
          actionableFeedbackForAgent: 'None',
        },
      };
      vi.mocked(evaluateDiffAgainstCriteria).mockResolvedValue({
        ...reconcileAuditReport(optimistic, ['package.json']),
        evaluatedAt: new Date().toISOString(),
      });

      const dirtyDiff = [
        'diff --git a/package.json b/package.json',
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -1 +1 @@',
        '+{}',
      ].join('\n');
      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: dirtyDiff,
          criteria: [{ id: '1', text: 'No scope drift' }],
          fileBoundaries: ['src/**'],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(200);
      expect(evaluateDiffAgainstCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ unauthorizedPaths: expect.arrayContaining(['package.json']) })
      );
      const data = await res.json();
      expect(data.report.scopeIntegrity.strictlyInScope).toBe(false);
      expect(data.report.mergeVerdict.status).not.toBe('READY_TO_MERGE');
    });

    it('never lets an empty client list clear re-derived hits', async () => {
      const { reconcileAuditReport } = await import('@/lib/scoring');
      const optimistic = {
        criteriaResults: [
          { id: '1', criterion: 'Works', status: 'MET' as const, evidence: 'ok', lineReferences: [] },
        ],
        scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Model says ok.' },
        blastRadius: { rating: 'LOW' as const, explanation: 'Small.' },
        mergeVerdict: {
          status: 'READY_TO_MERGE' as const,
          overallScore: 99,
          keyBlockers: [],
          actionableFeedbackForAgent: 'None',
        },
      };
      vi.mocked(evaluateDiffAgainstCriteria).mockResolvedValue({
        ...reconcileAuditReport(optimistic, ['package.json']),
        evaluatedAt: new Date().toISOString(),
      });

      const dirtyDiff = [
        'diff --git a/package.json b/package.json',
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -1 +1 @@',
        '+{}',
      ].join('\n');
      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: dirtyDiff,
          criteria: [{ id: '1', text: 'No scope drift' }],
          fileBoundaries: ['src/**'],
          unauthorizedPaths: [],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(200);
      expect(evaluateDiffAgainstCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ unauthorizedPaths: expect.arrayContaining(['package.json']) })
      );
    });
  });
});
