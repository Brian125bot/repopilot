import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveJobStatus } from '@/lib/job-status';
import { Blueprint, FailureBrief } from '@/types';

const base = (): Blueprint => ({
  blueprintId: 'bp_job',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/feat',
  fileBoundaries: ['src/**'],
  objective: 'Ship it',
  criteria: [{ id: '1', text: 'Works', category: 'functional' }],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const brief = (verdict: FailureBrief['verdict']): FailureBrief => ({
  verdict,
  score: 70,
  unmetIds: ['1'],
  partialIds: [],
  metIds: [],
  unauthorizedPaths: [],
  doNotTouch: [],
  requiredFixes: [],
});

describe('deriveJobStatus', () => {
  it('returns idle when there is no blueprint or no session', () => {
    expect(deriveJobStatus(null)).toBe('idle');
    expect(deriveJobStatus(base())).toBe('idle');
  });

  it('returns watching for an in-progress session without a PR', () => {
    expect(
      deriveJobStatus({
        ...base(),
        sessionId: 'sessions/abc',
        sessionState: 'IN_PROGRESS',
      })
    ).toBe('watching');
  });

  it('returns PR ready when a pull request URL has been harvested', () => {
    expect(
      deriveJobStatus({
        ...base(),
        sessionId: 'sessions/abc',
        prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
      })
    ).toBe('PR ready');
  });

  it('returns last verdict when the blueprint stores an audit outcome', () => {
    expect(
      deriveJobStatus({
        ...base(),
        sessionId: 'sessions/abc',
        prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
        lastBrief: brief('NEEDS_REVISION'),
      })
    ).toBe('last verdict');
  });

  it('shows the four labels in the navbar chrome and uses 1.0.0 as the version mark', () => {
    const nav = readFileSync('components/Navbar.tsx', 'utf8');
    expect(nav).toContain('deriveJobStatus');
    expect(nav).toContain('1.0.0');
    expect(nav).not.toContain('V1 Decoupled');
    expect(nav).not.toContain('0.2.0');
  });
});
