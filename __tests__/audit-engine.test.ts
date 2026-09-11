import { describe, it, expect, vi } from 'vitest';
import { POST as evaluatePOST } from '@/app/api/audit/evaluate/route';
import { POST as fetchDiffPOST } from '@/app/api/audit/fetch-diff/route';
import { NextRequest } from 'next/server';

describe('Audit Engine & Evaluation Pipeline', () => {
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
  });
});
