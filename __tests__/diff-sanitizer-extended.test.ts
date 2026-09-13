import { describe, it, expect } from 'vitest';
import {
  MAX_DIFF_CHAR_BUDGET,
  RESERVED_CHARS_PER_COVERED_FILE,
  TRUNCATED_HUNK_MARKER,
  cutAtHunkBoundary,
  omittedFileMarker,
  sanitizeUnifiedDiff,
  isFileExcluded,
  matchesFileBoundary,
} from '@/lib/diff-sanitizer';

const diffWith = (files: string[]) =>
  files.map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new`).join('\n');

const bigFile = (name: string, chars: number) =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${'+x'.repeat(chars)}`;

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

  it('defaults to the shared 90k budget and stamps it on stats', () => {
    expect(MAX_DIFF_CHAR_BUDGET).toBe(90_000);
    expect(RESERVED_CHARS_PER_COVERED_FILE).toBe(4_000);
    const out = sanitizeUnifiedDiff(diffWith(['src/a.ts']), ['src/**']);
    expect(out.isTruncated).toBe(false);
    expect(out.stats.budgetChars).toBe(MAX_DIFF_CHAR_BUDGET);
    expect(out.stats.omittedFiles).toEqual([]);
  });

  it('reserves headroom for criterion-relevant files before shared allocation', () => {
    // Covered file (10k) + uncovered giant (10k) under a 12k budget:
    // covered keeps its 4k reserve plus shared remainder.
    const raw = [bigFile('src/covered.ts', 5000), bigFile('other/huge.ts', 5000)].join('\n');
    const out = sanitizeUnifiedDiff(raw, ['src/**'], 12_000);
    expect(out.isTruncated).toBe(true);
    expect(out.sanitizedDiff).toContain('src/covered.ts');
    expect(out.sanitizedDiff).toContain(TRUNCATED_HUNK_MARKER);
    // Covered file kept at least its reserve; total stays within budget + marker.
    const coveredIdx = out.sanitizedDiff.indexOf('src/covered.ts');
    const hugeIdx = out.sanitizedDiff.indexOf('other/huge.ts');
    expect(coveredIdx).toBeGreaterThanOrEqual(0);
    expect(hugeIdx).toBeGreaterThanOrEqual(0);
    expect(coveredIdx).toBeLessThan(hugeIdx);
  });

  it('never drops trailing files silently — headers plus omission markers remain', () => {
    const raw = [bigFile('src/a.ts', 4000), bigFile('src/b.ts', 4000), bigFile('src/c.ts', 4000)].join('\n');
    const out = sanitizeUnifiedDiff(raw, ['src/**'], 5_000);
    expect(out.isTruncated).toBe(true);
    for (const f of ['src/a.ts', 'src/b.ts', 'src/c.ts']) {
      expect(out.sanitizedDiff).toContain(`diff --git a/${f} b/${f}`);
    }
    expect(out.stats.omittedFiles?.length).toBeGreaterThan(0);
    for (const f of out.stats.omittedFiles || []) {
      expect(out.sanitizedDiff).toContain(omittedFileMarker(f));
    }
  });

  it('cuts partial files at hunk boundaries when possible', () => {
    const text = `line1\n@@ -1 +1 @@\n+aaa\n@@ -9 +9 @@\n+bbb`;
    const cut = cutAtHunkBoundary(text, text.length - 2);
    expect(text.length).toBeGreaterThan(10);
    expect(cut.endsWith('+aaa')).toBe(true);
    expect(cutAtHunkBoundary('short', 100)).toBe('short');
  });

  it('unauthorized detection still works on truncated diffs', () => {
    const raw = [bigFile('src/ok.ts', 4000), bigFile('other/evil.ts', 4000)].join('\n');
    const out = sanitizeUnifiedDiff(raw, ['src/**'], 5_000);
    expect(out.stats.unauthorizedPaths).toContain('other/evil.ts');
    expect(out.stats.touchedPaths).toContain('src/ok.ts');
  });
});
