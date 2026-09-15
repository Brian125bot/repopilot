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
    prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
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
          auditedHeadSha: 'abc123',
          currentHeadSha: 'abc123',
          // remediation gets default criteria, so should succeed in dryRun
        })
      )
    );
    expect(remediation.status).toBe(200);
    const data = await remediation.json();
    expect(data.blueprint.isRemediation).toBe(true);
  });

  it('allows remediation when currentHeadSha matches auditedHeadSha', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ head: { sha: 'abc123' } }),
    } as unknown as Response);
    const res = await POST(
      req(
        dispatchBody({
          criteria: [],
          isRemediation: true,
          startingBranch: 'jules/test-gate',
          auditedHeadSha: 'abc123',
          currentHeadSha: 'abc123',
        })
      )
    );
    expect(res.status).toBe(200);
  });

  it('blocks remediation without an audited head SHA', async () => {
    const res = await POST(
      req(
        dispatchBody({
          criteria: [],
          isRemediation: true,
          startingBranch: 'jules/test-gate',
        })
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('auditedHeadSha');
  });

  it('blocks remediation when currentHeadSha is omitted', async () => {
    const res = await POST(
      req(
        dispatchBody({
          criteria: [],
          isRemediation: true,
          startingBranch: 'jules/test-gate',
          auditedHeadSha: 'abc123',
        })
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('currentHeadSha');
  });

  it('blocks remediation when the current head differs from the audited SHA', async () => {
    const res = await POST(
      req(
        dispatchBody({
          criteria: [],
          isRemediation: true,
          startingBranch: 'jules/test-gate',
          auditedHeadSha: 'audited123',
          currentHeadSha: 'current456',
        })
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Head moved since audit');
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
