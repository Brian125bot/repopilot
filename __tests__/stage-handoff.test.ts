import { describe, it, expect } from 'vitest';
import { matchVaultBlueprint, stage2Prefill } from '@/lib/stage-handoff';
import { Blueprint } from '@/types';

const bp = (overrides: Partial<Blueprint> = {}): Blueprint => ({
  blueprintId: 'bp_1',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/rate-limiter',
  fileBoundaries: ['src/**'],
  objective: 'Limiter',
  criteria: [{ id: '1', text: 'Works', category: 'functional' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('stage2Prefill', () => {
  it('prefills a real PR URL and requests auto-fetch when harvested', () => {
    const result = stage2Prefill(
      bp({ prUrl: 'https://github.com/acme-corp/api-gateway/pull/42' })
    );
    expect(result.prInput).toBe('https://github.com/acme-corp/api-gateway/pull/42');
    expect(result.autoFetchPrUrl).toBe('https://github.com/acme-corp/api-gateway/pull/42');
    expect(result.waitingForPr).toBe(false);
  });

  it('does not stuff repo (branch) into the ingest field while waiting', () => {
    const result = stage2Prefill(bp({ sessionId: 'sessions/abc', sessionState: 'IN_PROGRESS' }));
    expect(result.prInput).toBe('');
    expect(result.autoFetchPrUrl).toBeNull();
    expect(result.waitingForPr).toBe(true);
    expect(result.waitingMessage).toMatch(/has not opened a PR/i);
    expect(result.headBranch).toBe('jules/rate-limiter');
  });
});

describe('matchVaultBlueprint', () => {
  const vault = [
    bp({ blueprintId: 'bp_other', repo: 'other/svc', branchName: 'jules/x' }),
    bp({
      blueprintId: 'bp_match',
      prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
    }),
  ];

  it('matches by harvested PR URL rather than comparing repo to the full input string', () => {
    const hit = matchVaultBlueprint(vault, {
      prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
    });
    expect(hit?.blueprintId).toBe('bp_match');
  });

  it('matches owner/repo from a PR URL plus head branch', () => {
    const hit = matchVaultBlueprint(vault, {
      prUrl: 'https://github.com/acme-corp/api-gateway/pull/99',
      headBranch: 'jules/rate-limiter',
    });
    expect(hit?.blueprintId).toBe('bp_match');
  });

  it('prefers the active blueprint id', () => {
    const hit = matchVaultBlueprint(vault, { activeId: 'bp_other' });
    expect(hit?.blueprintId).toBe('bp_other');
  });
});
