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

  it('formats acceptance criteria with numeric indices, criterion IDs, and categories', () => {
    const compiled = compileJulesPrompt(sampleInput, 'bp_test_12345');

    expect(compiled).toContain('1. [CRIT-crit-1][functional] Extract client IP address with fallback to X-Forwarded-For');
    expect(compiled).toContain('2. [CRIT-crit-2][functional] Enforce Redis token-bucket rate limit of 60 req/min');
    expect(compiled).toContain('3. [CRIT-crit-3][constraint] Do not modify package.json or root configuration files');
  });

  it('preserves rationale as Why lines so Jules does not deprioritize testing/constraint rows', () => {
    const compiled = compileJulesPrompt(
      {
        ...sampleInput,
        criteria: [
          { id: '1', text: 'Unit tests cover burst + expiry', category: 'testing', rationale: 'Prevents regression' },
        ],
      },
      'bp_why_1'
    );
    expect(compiled).toContain('[testing]');
    expect(compiled).toContain('Why: Prevents regression');
  });

  it('adds repo grounding, explicit DO-NOT list, and self-check DoD when repoContext is supplied', () => {
    const compiled = compileJulesPrompt(
      {
        ...sampleInput,
        repoContext: {
          repo: 'acme-corp/api-gateway',
          primaryLanguage: 'TypeScript',
          treePreview: ['src/middleware/rate-limit.ts', 'tests/rate-limit.test.ts', 'package.json'],
          treePaths: ['src/middleware/rate-limit.ts', 'tests/rate-limit.test.ts', 'package.json'],
          keyFiles: {
            testCommand: 'npm test',
            framework: 'Next.js',
            packageManager: 'npm',
          } as never,
        },
        testCommand: 'npm test',
      },
      'bp_grounded_1'
    );
    expect(compiled).toContain('## 0. Repo Grounding');
    expect(compiled).toContain('Read first');
    expect(compiled).toContain('`npm test`');
    expect(compiled).toContain('DO NOT touch');
    expect(compiled).toContain('Definition of Done + Self-Check Before PR');
    expect(compiled).toContain('git status');
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

describe('compileJulesPrompt COR-56 goal ingestion section', () => {
  const baseInput = {
    repo: 'acme/api-gateway',
    baseBranch: 'main',
    branchName: 'jules/goal-ingestion',
    fileBoundaries: ['lib/goals/**'],
    objective: 'Add an empty-scan save guard',
    criteria: [
      { id: 'crit-1', text: 'npm test lib/repo-profile/save-policy.test.ts covers the refusal', category: 'testing' as const },
    ],
  };

  const goal = {
    title: 'Add empty-scan save guard',
    scope: ['lib/repo-profile/save-policy.ts'],
    acceptanceCriteria: ['npm test lib/repo-profile/save-policy.test.ts covers the refusal'],
    assumptions: ['The scanner keeps its four-stage shape'],
    ambiguityFlags: ['operator did not name the test command'],
  };

  // The embedded AUDIT_BLUEPRINT carries a wall-clock createdAt, so normalize it
// before asserting two compiles are byte-identical.
const withoutTimestamp = (prompt: string): string =>
  prompt.replace(/"createdAt":"[^"]*"/g, '"createdAt":"<ts>"');

it('leaves the contract byte-identical when no goal was captured', () => {
    // Same blueprintId across all three: the only variable under test is `goal`.
    const withoutGoal = compileJulesPrompt(baseInput, 'bp_goal_absent');
    const explicitNull = compileJulesPrompt({ ...baseInput, goal: null }, 'bp_goal_absent');
    const explicitUndefined = compileJulesPrompt({ ...baseInput, goal: undefined }, 'bp_goal_absent');

    expect(withoutGoal).not.toContain('Goal Ingestion');
    expect(withoutTimestamp(explicitNull)).toBe(withoutTimestamp(withoutGoal));
    expect(withoutTimestamp(explicitUndefined)).toBe(withoutTimestamp(withoutGoal));
  });

  it('adds a §1.1 block carrying title, scope, assumptions, and reviewed flags', () => {
    const compiled = compileJulesPrompt({ ...baseInput, goal }, 'bp_goal_present');

    expect(compiled).toContain('## 1.1 Goal Ingestion (operator-confirmed)');
    expect(compiled).toContain('Add empty-scan save guard');
    expect(compiled).toContain('lib/repo-profile/save-policy.ts');
    expect(compiled).toContain('The scanner keeps its four-stage shape');
    expect(compiled).toContain('operator did not name the test command');
  });

  it('keeps §2 onward unchanged so the blast radius cannot be widened by a goal', () => {
    const compiled = compileJulesPrompt({ ...baseInput, goal }, 'bp_goal_scope');
    const baseline = compileJulesPrompt(baseInput, 'bp_goal_scope');

    expect(withoutTimestamp(compiled.slice(compiled.indexOf('## 2. Strict Scope')))).toBe(
      withoutTimestamp(baseline.slice(baseline.indexOf('## 2. Strict Scope')))
    );
  });

  it('states §3 stays authoritative rather than adding requirements', () => {
    const compiled = compileJulesPrompt({ ...baseInput, goal }, 'bp_goal_authoritative');
    expect(compiled).toContain('§3 is the authoritative criteria matrix');
  });

  it('handles an empty scope and no assumptions without printing placeholders', () => {
    const compiled = compileJulesPrompt(
      { ...baseInput, goal: { ...goal, scope: [], assumptions: [], ambiguityFlags: [] } },
      'bp_goal_empty'
    );

    expect(compiled).toContain('Not narrowed beyond §2 boundaries.');
    expect(compiled).toContain('None recorded.');
    expect(compiled).not.toContain('Ambiguity flags');
    expect(compiled).not.toContain('undefined');
  });
});
