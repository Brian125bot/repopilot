import { describe, it, expect } from 'vitest';
import {
  lintObjective,
  lintCriteria,
  checkBoundariesAgainstTree,
  preDispatchGate,
  deriveDoNotTouchList,
  pickFilesToReadFirst,
} from '@/lib/contract-lint';

describe('lintObjective (verb + where + verification)', () => {
  it('passes a well-formed objective', () => {
    const r = lintObjective(
      'Implement IP sliding-window limiter in src/middleware/rate-limiter.ts verified by unit tests for burst + expiry returning HTTP 429'
    );
    expect(r.ok).toBe(true);
    expect(r.hasVerb).toBe(true);
    expect(r.hasWhere).toBe(true);
    expect(r.hasVerification).toBe(true);
  });

  it('flags short, vague objectives without where/verification', () => {
    const r = lintObjective('Improve stuff robustly');
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/too short|where|verified|vague/i);
  });
});

describe('lintCriteria (falsifiable + balanced)', () => {
  const good = [
    { id: '1', text: 'Middleware extracts client IP in src/middleware/rate-limiter.ts verified by unit test', category: 'functional' as const },
    { id: '2', text: 'Unit tests cover burst + expiry in tests/rate-limiter.test.ts', category: 'testing' as const },
    { id: '3', text: 'Zero modifications to package.json dependencies', category: 'constraint' as const },
  ];

  it('passes a balanced falsifiable matrix', () => {
    const r = lintCriteria(good);
    expect(r.ok).toBe(true);
  });

  it('flags vague terms and missing categories', () => {
    const r = lintCriteria([
      { id: '1', text: 'Should be robust and clean', category: 'functional' as const },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.global.join(' ')).toMatch(/testing|constraint/i);
  });

  it('flags duplicates', () => {
    const r = lintCriteria([
      { id: '1', text: 'Enforce 60 req/min in src/middleware/rate-limiter.ts verified by test', category: 'functional' as const },
      { id: '2', text: 'Enforce 60 req/min in src/middleware/rate-limiter.ts verified by test', category: 'functional' as const },
      { id: '3', text: 'Unit tests cover burst in tests/x.test.ts', category: 'testing' as const },
      { id: '4', text: 'Zero modifications to package.json', category: 'constraint' as const },
    ]);
    expect(r.issues.some((i) => i.messages.join(' ').match(/Duplicate/i))).toBe(true);
  });
});

describe('checkBoundariesAgainstTree', () => {
  const tree = ['src/middleware/rate-limiter.ts', 'tests/rate-limiter.test.ts', 'package.json'];

  it('marks existing prefixes as matched with counts', () => {
    const [a] = checkBoundariesAgainstTree(['src/middleware/**'], tree);
    expect(a.existsInTree).toBe(true);
    expect(a.matchCount).toBeGreaterThan(0);
  });

  it('marks misses as false for pre-dispatch warning', () => {
    const [a] = checkBoundariesAgainstTree(['src/does-not-exist/**'], tree);
    expect(a.existsInTree).toBe(false);
    expect(a.matchCount).toBe(0);
  });

  it('returns null when no tree is available (cannot validate)', () => {
    const [a] = checkBoundariesAgainstTree(['src/middleware/**'], []);
    expect(a.existsInTree).toBeNull();
  });
});

describe('preDispatchGate', () => {
  it('fails closed on bad repo / missing objective / no criteria', () => {
    const g = preDispatchGate({ repo: 'bad', objective: '', criteria: [], boundaries: [] });
    expect(g.ok).toBe(false);
    expect(g.errors.length).toBeGreaterThan(0);
  });

  it('warns (not blocks) on unmatched boundary + thin criteria', () => {
    const g = preDispatchGate({
      repo: 'acme-corp/api-gateway',
      objective: 'Implement limiter in src/middleware/rate-limiter.ts verified by unit tests returning HTTP 429',
      criteria: [{ id: '1', text: 'Enforce 60 req/min in src/middleware/rate-limiter.ts verified by test', category: 'functional' }],
      boundaries: ['src/ghost/**'],
      treePaths: ['src/middleware/rate-limiter.ts'],
    });
    expect(g.ok).toBe(true);
    expect(g.warnings.join(' ')).toMatch(/ghost|testing|constraint|4–7/i);
  });
});

describe('deriveDoNotTouchList / pickFilesToReadFirst', () => {
  it('always freezes manifests and adds repo-present configs', () => {
    const list = deriveDoNotTouchList({
      treePreview: ['package.json', 'tsconfig.json', 'Dockerfile'],
      keyFiles: { hasTsConfig: true, hasDocker: true },
    });
    expect(list).toContain('package.json');
    expect(list.join(' ')).toMatch(/tsconfig|Dockerfile/);
  });

  it('picks exact boundary files first, code before tests, capped', () => {
    const picks = pickFilesToReadFirst(
      ['src/middleware/rate-limit.ts'],
      ['src/middleware/rate-limit.ts', 'src/middleware/other.ts', 'tests/rate-limit.test.ts'],
      2
    );
    expect(picks[0]).toBe('src/middleware/rate-limit.ts');
    expect(picks.length).toBe(2);
  });
});
