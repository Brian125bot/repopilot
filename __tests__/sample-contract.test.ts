import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyStage1Defaults, SAMPLE_RATE_LIMITER_CONTRACT } from '@/lib/sample-contract';

describe('Stage 1 first-run contract', () => {
  it('starts with empty repo, objective, criteria, branch, and boundaries', () => {
    const firstRun = emptyStage1Defaults();
    expect(firstRun.repo).toBe('');
    expect(firstRun.objective).toBe('');
    expect(firstRun.criteria).toEqual([]);
    expect(firstRun.branchName).toBe('');
    expect(firstRun.fileBoundaries).toBe('');
  });

  it('Load sample yields the rate-limiter repo, objective, criteria, and boundaries', () => {
    const sample = SAMPLE_RATE_LIMITER_CONTRACT;
    expect(sample.repo).toBe('acme-corp/api-gateway');
    expect(sample.objective).toMatch(/rate limiter/i);
    expect(sample.criteria.length).toBeGreaterThanOrEqual(5);
    expect(sample.criteria.map((c) => c.text).join(' ')).toMatch(/X-Forwarded-For/);
    expect(sample.branchName).toBe('jules/rate-limiter-redis');
    expect(sample.fileBoundaries).toContain('src/middleware/rate-limiter.ts');
    expect(sample.fileBoundaries).toContain('tests/rate-limiter.test.ts');
    expect(emptyStage1Defaults().repo).not.toBe(sample.repo);
  });

  it('wires empty defaults and Load sample into Stage 1, and labels simulations', () => {
    const intake = readFileSync('components/IntakeDispatchStage.tsx', 'utf8');
    expect(intake).toContain('emptyStage1Defaults');
    expect(intake).toContain('SAMPLE_RATE_LIMITER_CONTRACT');
    expect(intake).toContain('Load sample');
    expect(intake).toContain('Dry-run (simulation, no Jules key needed)');
    const audit = readFileSync('components/AuditEvaluationStage.tsx', 'utf8');
    expect(audit).toContain('Load Demo PR (simulation)');
  });
});
