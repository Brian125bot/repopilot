import { describe, it, expect } from 'vitest';
import { compileJulesPrompt, extractBlueprintFromPRBody } from '@/lib/prompt-compiler';
import { Blueprint, AcceptanceCriterion } from '@/types';

describe('Prompt Compiler & Anti-Drift Contract Engine', () => {
  const sampleCriteria: AcceptanceCriterion[] = [
    {
      id: 'crit-1',
      text: 'Extract client IP address with fallback to X-Forwarded-For',
      category: 'functional',
    },
    {
      id: 'crit-2',
      text: 'Enforce Redis token-bucket rate limit of 60 req/min',
      category: 'functional',
    },
    {
      id: 'crit-3',
      text: 'Do not modify package.json or root configuration files',
      category: 'constraint',
    },
  ];

  const sampleInput = {
    repo: 'acme-corp/api-gateway',
    baseBranch: 'main',
    branchName: 'jules/rate-limiter',
    fileBoundaries: ['src/middleware/rate-limit.ts', 'tests/rate-limit.test.ts'],
    objective: 'Implement Redis rate limiting middleware with unit tests.',
    criteria: sampleCriteria,
  };

  it('compiles a complete anti-drift Markdown contract with metadata headers', () => {
    const blueprintId = 'bp_test_12345';
    const compiled = compileJulesPrompt(sampleInput, blueprintId);

    expect(compiled).toContain('# RepoPilot Autonomous Agent Contract');
    expect(compiled).toContain('**Contract ID:** `bp_test_12345`');
    expect(compiled).toContain('**Repository:** `acme-corp/api-gateway`');
    expect(compiled).toContain('**Base Branch:** `main`');
    expect(compiled).toContain('**Target Branch:** `jules/rate-limiter`');
  });

  it('embeds declared file boundaries with zero-tolerance anti-drift directives', () => {
    const compiled = compileJulesPrompt(sampleInput, 'bp_test_12345');

    expect(compiled).toContain('- `src/middleware/rate-limit.ts`');
    expect(compiled).toContain('- `tests/rate-limit.test.ts`');
    expect(compiled).toContain('No Out-of-Scope Modifications');
    expect(compiled).toContain('Dependency Freeze');
    expect(compiled).toContain('Minimal Diff Principle');
  });

  it('formats acceptance criteria with numeric indices and criterion IDs', () => {
    const compiled = compileJulesPrompt(sampleInput, 'bp_test_12345');

    expect(compiled).toContain('1. [CRIT-crit-1] Extract client IP address with fallback to X-Forwarded-For');
    expect(compiled).toContain('2. [CRIT-crit-2] Enforce Redis token-bucket rate limit of 60 req/min');
    expect(compiled).toContain('3. [CRIT-crit-3] Do not modify package.json or root configuration files');
  });

  it('embeds a valid JSON serialized AUDIT_BLUEPRINT comment block', () => {
    const blueprintId = 'bp_embedded_999';
    const compiled = compileJulesPrompt(sampleInput, blueprintId);

    expect(compiled).toContain('<!-- AUDIT_BLUEPRINT:');
    const extracted = extractBlueprintFromPRBody(compiled);

    expect(extracted).not.toBeNull();
    expect(extracted?.blueprintId).toBe('bp_embedded_999');
    expect(extracted?.repo).toBe('acme-corp/api-gateway');
    expect(extracted?.criteria).toHaveLength(3);
    expect(extracted?.fileBoundaries).toEqual([
      'src/middleware/rate-limit.ts',
      'tests/rate-limit.test.ts',
    ]);
  });

  it('extracts blueprint from complex PR description containing markdown and comments', () => {
    const mockBlueprint: Blueprint = {
      blueprintId: 'bp_extracted_456',
      repo: 'org/service',
      baseBranch: 'main',
      branchName: 'jules/feature',
      fileBoundaries: ['src/core.ts'],
      objective: 'Core feature update',
      criteria: [{ id: '1', text: 'Working implementation', category: 'functional' }],
      createdAt: '2026-09-11T12:00:00Z',
    };

    const prBody = `
## Summary of Changes
This pull request introduces the requested core feature.
- Verified in staging
- Passed all linter checks

<!-- AUDIT_BLUEPRINT: ${JSON.stringify(mockBlueprint)} -->

Footer note for reviewers.
`;

    const result = extractBlueprintFromPRBody(prBody);
    expect(result).not.toBeNull();
    expect(result?.blueprintId).toBe('bp_extracted_456');
    expect(result?.objective).toBe('Core feature update');
  });

  it('returns null when PR body has no embedded blueprint or corrupted JSON', () => {
    expect(extractBlueprintFromPRBody('')).toBeNull();
    expect(extractBlueprintFromPRBody('Just a regular pull request description')).toBeNull();
    expect(extractBlueprintFromPRBody('<!-- AUDIT_BLUEPRINT: { broken json ... -->')).toBeNull();
    expect(extractBlueprintFromPRBody('<!-- AUDIT_BLUEPRINT: {"missingKeys": true} -->')).toBeNull();
  });

  it('handles empty boundaries gracefully by applying general anti-drift fallback', () => {
    const inputWithoutBoundaries = {
      ...sampleInput,
      fileBoundaries: [],
    };
    const compiled = compileJulesPrompt(inputWithoutBoundaries, 'bp_no_bounds');
    expect(compiled).toContain('strictly adhering to anti-drift rules');
  });
});
