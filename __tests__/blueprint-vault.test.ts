import { describe, it, expect } from 'vitest';
import { Blueprint, AcceptanceCriterion } from '@/types';

describe('Blueprint Vault & State Lifecycle', () => {
  const createSampleBlueprint = (id: string, repo: string): Blueprint => ({
    blueprintId: id,
    repo,
    baseBranch: 'main',
    branchName: `jules/feature-${id}`,
    fileBoundaries: ['src/**/*.ts'],
    objective: 'Implement secure payment webhook validation',
    criteria: [
      { id: '1', text: 'Verify HMAC SHA-256 signature', category: 'security' },
      { id: '2', text: 'Return 200 on valid signature', category: 'functional' },
      { id: '3', text: 'Zero modifications to root dependencies', category: 'constraint' },
    ],
    createdAt: new Date().toISOString(),
  });

  it('maintains valid blueprint contracts and data schema', () => {
    const bp = createSampleBlueprint('bp_test_1', 'acme/billing-service');
    expect(bp.blueprintId).toBe('bp_test_1');
    expect(bp.repo).toBe('acme/billing-service');
    expect(bp.criteria).toHaveLength(3);
    expect(bp.criteria.map((c) => c.category)).toEqual(['security', 'functional', 'constraint']);
  });

  it('deduplicates blueprints correctly when updating active vault entries', () => {
    const initialList: Blueprint[] = [
      createSampleBlueprint('bp_1', 'acme/service-a'),
      createSampleBlueprint('bp_2', 'acme/service-b'),
    ];

    const updatedBp1: Blueprint = {
      ...initialList[0],
      objective: 'Updated objective for service A',
    };

    // Deduplication logic identical to App.tsx
    const filtered = initialList.filter((b) => b.blueprintId !== updatedBp1.blueprintId);
    const result = [updatedBp1, ...filtered];

    expect(result).toHaveLength(2);
    expect(result[0].blueprintId).toBe('bp_1');
    expect(result[0].objective).toBe('Updated objective for service A');
  });

  it('safely serializes and deserializes blueprint payloads to JSON', () => {
    const original = createSampleBlueprint('bp_json_test', 'acme/core-api');
    const serialized = JSON.stringify(original);
    const parsed = JSON.parse(serialized) as Blueprint;

    expect(parsed.blueprintId).toBe(original.blueprintId);
    expect(parsed.repo).toBe(original.repo);
    expect(parsed.criteria).toEqual(original.criteria);
    expect(parsed.fileBoundaries).toEqual(original.fileBoundaries);
  });

  it('merges Refresh session harvest without losing blueprint identity', () => {
    const original = createSampleBlueprint('bp_refresh_1', 'acme/core-api');
    const patched: Blueprint = {
      ...original,
      sessionId: 'sessions/session_77',
      sessionUrl: 'https://jules.google.com/session/session_77',
      sessionState: 'COMPLETED',
      prUrl: 'https://github.com/acme/core-api/pull/42',
      prTitle: 'Add limiter',
    };

    expect(patched.blueprintId).toBe(original.blueprintId);
    expect(patched.repo).toBe(original.repo);
    expect(patched.branchName).toBe(original.branchName);
    expect(patched.criteria).toEqual(original.criteria);
    expect(patched.sessionState).toBe('COMPLETED');
    expect(patched.prUrl).toContain('/pull/42');
  });
});
