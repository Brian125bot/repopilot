import { describe, it, expect } from 'vitest';
import { sanitizeUnifiedDiff, isFileExcluded, matchesFileBoundary } from '@/lib/diff-sanitizer';

const diffWith = (files: string[]) =>
  files.map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new`).join('\n');

describe('diff sanitizer extended', () => {
  it('excludes lockfiles, build artifacts, minified, binary', () => {
    expect(isFileExcluded('package-lock.json').isExcluded).toBe(true);
    expect(isFileExcluded('dist/bundle.js').isExcluded).toBe(true);
    expect(isFileExcluded('app.min.js').isExcluded).toBe(true);
    expect(isFileExcluded('logo.png').isExcluded).toBe(true);
    expect(isFileExcluded('src/a.ts').isExcluded).toBe(false);
  });

  it('matches ** and * without false prefix matches', () => {
    expect(matchesFileBoundary('src/middleware/auth.ts', ['src/middleware/**'])).toBe(true);
    expect(matchesFileBoundary('src/middlewareextra/x.ts', ['src/middleware/**'])).toBe(false);
    expect(matchesFileBoundary('src/a.ts', ['src/*.ts'])).toBe(true);
    expect(matchesFileBoundary('src/nested/a.ts', ['src/*.ts'])).toBe(false);
    expect(matchesFileBoundary('anything.ts', [])).toBe(true);
  });

  it('flags unauthorized paths while keeping sanitized diff clean of excluded files', () => {
    const raw = diffWith(['src/ok.ts', 'package-lock.json', 'other/evil.ts']);
    const out = sanitizeUnifiedDiff(raw, ['src/**']);
    expect(out.stats.unauthorizedPaths).toContain('other/evil.ts');
    expect(out.stats.touchedPaths).toContain('src/ok.ts');
    expect(out.sanitizedDiff).not.toContain('package-lock.json');
    expect(out.files.find((f) => f.filename === 'package-lock.json')?.isExcluded).toBe(true);
  });

  it('truncates giant diffs with notice and preserves headers', () => {
    const big = `diff --git a/src/big.ts b/src/big.ts\n${'+x'.repeat(60000)}`;
    const out = sanitizeUnifiedDiff(big, ['src/**'], 1000);
    expect(out.isTruncated).toBe(true);
    expect(out.truncationNotice).toMatch(/truncat/i);
    expect(out.sanitizedDiff.length).toBeLessThanOrEqual(2000);
  });

  it('counts additions/deletions and handles empty diff', () => {
    const empty = sanitizeUnifiedDiff('', ['src/**']);
    expect(empty.stats.totalFilesTouched).toBe(0);
    const raw = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@\n+one\n+two\n-old`;
    const out = sanitizeUnifiedDiff(raw, ['src/**']);
    expect(out.stats.linesAdded).toBe(2);
    expect(out.stats.linesRemoved).toBe(1);
  });
});
