import { describe, it, expect } from 'vitest';
import { AcceptanceCriterion, GeminiAuditReport, PRMetadata } from '@/types';
import { compileRemediationPrompt } from '@/lib/prompt-compiler';

describe('Autonomous Remediation Workflow & Branch Safety', () => {
  const mockPR: PRMetadata = {
    title: 'feat(rate-limiter): add sliding window redis rate limiter middleware',
    number: 42,
    author: 'jules-agent',
    htmlUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
    baseBranch: 'main',
    headBranch: 'jules/rate-limiter-redis',
    state: 'open',
  };

  const mockReport: GeminiAuditReport = {
    criteriaResults: [
      {
        id: '1',
        criterion: 'Middleware extracts client IP correctly with support for X-Forwarded-For',
        status: 'MET',
        evidence: 'IP extracted on line 18 using req.headers.get("x-forwarded-for")',
        lineReferences: ['src/middleware/rate-limiter.ts:18-24'],
      },
      {
        id: '2',
        criterion: 'Sliding window algorithm enforces 60 requests per minute ceiling',
        status: 'PARTIALLY_MET',
        evidence: 'Window slides correctly, but expiry calculation lacks 60-second TTL fallback',
        lineReferences: ['src/middleware/rate-limiter.ts:45-52'],
      },
      {
        id: '3',
        criterion: 'Zero modifications to out-of-scope files or root dependencies',
        status: 'UNMET',
        evidence: 'package.json dependencies were modified with unauthorized package',
        lineReferences: ['package.json:14'],
      },
    ],
    scopeIntegrity: {
      strictlyInScope: false,
      unauthorizedFiles: ['package.json'],
      explanation: 'Detected unauthorized modification to package.json violating dependency freeze.',
    },
    blastRadius: {
      rating: 'MEDIUM',
      explanation: 'Root configuration touched; risk of upstream deployment failures.',
    },
    mergeVerdict: {
      status: 'NEEDS_REVISION',
      overallScore: 62,
      recommendation: 'Revert package.json changes and complete TTL fallback logic.',
      keyBlockers: [
        'Unauthorized file modification: package.json must be reverted.',
        'Criterion 2 incomplete: TTL calculation missing in sliding window.',
      ],
      actionableFeedbackForAgent:
        '1. Revert package.json changes.\n2. Fix TTL fallback logic in src/middleware/rate-limiter.ts.\n3. Run all tests and commit directly to jules/rate-limiter-redis.',
    },
  };

  it('correctly targets the audited branch instead of base branch', () => {
    // In remediation, the target branch MUST match PR headBranch
    const targetBranch = mockPR.headBranch;
    expect(targetBranch).toBe('jules/rate-limiter-redis');
    expect(targetBranch).not.toBe(mockPR.baseBranch);
  });

  it('compiles actionable remediation prompt embedding blockers, evidence, and critical branch directive', () => {
    const defaultRemediationPrompt = compileRemediationPrompt({
      targetBranch: mockPR.headBranch,
      baseBranch: mockPR.baseBranch,
      prNumber: mockPR.number,
      prUrl: mockPR.htmlUrl,
      report: mockReport,
    });

    expect(defaultRemediationPrompt).toContain('CRITICAL BRANCH WORKFLOW DIRECTIVE');
    expect(defaultRemediationPrompt).toContain('jules/rate-limiter-redis');
    expect(defaultRemediationPrompt).toContain('Unauthorized file modification: package.json must be reverted');
    expect(defaultRemediationPrompt).toContain('Criterion 2 incomplete');
    expect(defaultRemediationPrompt).toContain('**Unauthorized Files to Revert:** package.json');
  });
});
