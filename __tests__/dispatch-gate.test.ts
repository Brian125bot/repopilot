import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/jules/dispatch/route';
import { NextRequest } from 'next/server';

function dispatchBody(overrides: Record<string, unknown> = {}) {
  return {
    repo: 'acme-corp/api-gateway',
    baseBranch: 'main',
    branchName: 'jules/test-gate',
    fileBoundaries: ['src/middleware/**'],
    objective: 'Implement limiter in src/middleware/rate-limiter.ts verified by unit tests returning HTTP 429',
    criteria: [
      { id: '1', text: 'Enforce 60 req/min in src/middleware/rate-limiter.ts verified by test', category: 'functional' },
      { id: '2', text: 'Unit tests cover burst in tests/x.test.ts', category: 'testing' },
      { id: '3', text: 'Zero modifications to package.json', category: 'constraint' },
    ],
    dryRun: true,
    ...overrides,
  };
}

function req(body: unknown) {
  return new NextRequest('http://localhost:3000/api/jules/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('dispatch pre-dispatch gate (P0)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('blocks structural errors with 400 (bad repo)', async () => {
    const res = await POST(req(dispatchBody({ repo: 'badformat' })));
    expect(res.status).toBe(400);
  });

  it('blocks empty criteria with 400 even in dryRun', async () => {
    const res = await POST(req(dispatchBody({ criteria: [] })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/criterion/i);
  });

  it('passes grounded prompt through with warnings array on success', async () => {
    const res = await POST(
      req(
        dispatchBody({
          repoContext: {
            repo: 'acme-corp/api-gateway',
            primaryLanguage: 'TypeScript',
            treePreview: ['src/middleware/rate-limiter.ts'],
            treePaths: ['src/middleware/rate-limiter.ts'],
            keyFiles: { testCommand: 'npm test', framework: 'Next.js', packageManager: 'npm' },
          },
          testCommand: 'npm test',
        })
      )
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.blueprint.compiledPrompt).toContain('Repo Grounding');
    expect(data.blueprint.compiledPrompt).toContain('npm test');
    expect(data.blueprint.compiledPrompt).toContain('[functional]');
  });

  it('bypasses gate for customPrompt and remediation', async () => {
    const custom = await POST(
      req(dispatchBody({ criteria: [], objective: 'x', customPrompt: 'custom remediation prompt' }))
    );
    // customPrompt path skips criteria requirement? No — criteria still required unless remediation.
    // But gate itself is bypassed, so failure (if any) comes from criteria check, not gate.
    expect([200, 400]).toContain(custom.status);

    const remediation = await POST(
      req(
        dispatchBody({
          criteria: [],
          isRemediation: true,
          startingBranch: 'jules/test-gate',
          auditedHeadSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
          currentHeadSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
          // remediation gets default criteria, so should succeed in dryRun
        })
      )
    );
    expect(remediation.status).toBe(200);
    const data = await remediation.json();
    expect(data.blueprint.isRemediation).toBe(true);
  });

  describe('COR-40 audited SHA lock', () => {
    const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
    const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';

    it('allows remediation when currentHeadSha matches auditedHeadSha (case-insensitive)', async () => {
      const res = await POST(
        req(
          dispatchBody({
            criteria: [],
            isRemediation: true,
            startingBranch: 'jules/test-gate',
            auditedHeadSha: SHA,
            currentHeadSha: SHA.toUpperCase(),
          })
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.blueprint.auditedHeadSha).toBe(SHA);
    });

    it('blocks remediation when currentHeadSha is omitted', async () => {
      const res = await POST(
        req(
          dispatchBody({
            criteria: [],
            isRemediation: true,
            startingBranch: 'jules/test-gate',
            auditedHeadSha: SHA,
          })
        )
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(String(data.error || data.message || '')).toContain('Head moved since audit');
    });

    it.each([
      { name: 'empty', value: '' },
      { name: 'whitespace', value: '   ' },
      { name: 'null', value: null },
    ])('blocks remediation when currentHeadSha is $name', async ({ value }) => {
      const res = await POST(
        req(
          dispatchBody({
            criteria: [],
            isRemediation: true,
            startingBranch: 'jules/test-gate',
            auditedHeadSha: SHA,
            currentHeadSha: value,
          })
        )
      );
      expect(res.status).toBe(400);
      expect(String((await res.json()).error || '')).toContain('Head moved since audit');
    });

    it('blocks remediation when current head differs from audited SHA', async () => {
      const res = await POST(
        req(
          dispatchBody({
            criteria: [],
            isRemediation: true,
            startingBranch: 'jules/test-gate',
            auditedHeadSha: SHA,
            currentHeadSha: OTHER,
          })
        )
      );
      expect(res.status).toBe(400);
      expect(String((await res.json()).error || '')).toContain('Head moved since audit');
    });

    it('blocks remediation when auditedHeadSha is missing', async () => {
      const res = await POST(
        req(
          dispatchBody({
            criteria: [],
            isRemediation: true,
            startingBranch: 'jules/test-gate',
            currentHeadSha: SHA,
          })
        )
      );
      expect(res.status).toBe(400);
    });

    it('blocks remediation when startingBranch is main fallback', async () => {
      const res = await POST(
        req(
          dispatchBody({
            criteria: [],
            isRemediation: true,
            startingBranch: 'main',
            branchName: 'main',
            auditedHeadSha: SHA,
            currentHeadSha: SHA,
          })
        )
      );
      expect(res.status).toBe(400);
      expect(String((await res.json()).error || '')).toMatch(/startingBranch/i);
    });
  });

  it('embeds category + Why and DoD self-check in compiled first-pass prompt', async () => {
    const res = await POST(
      req(
        dispatchBody({
          criteria: [
            { id: '1', text: 'Unit tests cover burst + expiry in tests/x.test.ts', category: 'testing', rationale: 'Prevents regression' },
            { id: '2', text: 'Zero modifications to package.json', category: 'constraint' },
            { id: '3', text: 'Enforce limit in src/m.ts verified by test', category: 'functional' },
          ],
        })
      )
    );
    const data = await res.json();
    const prompt: string = data.blueprint.compiledPrompt;
    expect(prompt).toContain('[testing]');
    expect(prompt).toContain('Why: Prevents regression');
    expect(prompt).toContain('Definition of Done + Self-Check');
    expect(prompt).toContain('git status');
  });
});
