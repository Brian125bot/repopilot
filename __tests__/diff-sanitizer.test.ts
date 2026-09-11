import { describe, it, expect } from 'vitest';
import { isFileExcluded, matchesFileBoundary, sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';

describe('Diff Sanitizer & Scope Analysis Engine', () => {
  describe('isFileExcluded', () => {
    it('excludes lockfiles according to dependency freeze policy', () => {
      expect(isFileExcluded('package-lock.json').isExcluded).toBe(true);
      expect(isFileExcluded('frontend/package-lock.json').isExcluded).toBe(true);
      expect(isFileExcluded('yarn.lock').isExcluded).toBe(true);
      expect(isFileExcluded('pnpm-lock.yaml').isExcluded).toBe(true);
      expect(isFileExcluded('bun.lockb').isExcluded).toBe(true);
    });

    it('excludes binary media assets', () => {
      expect(isFileExcluded('public/logo.png').isExcluded).toBe(true);
      expect(isFileExcluded('assets/diagram.webp').isExcluded).toBe(true);
      expect(isFileExcluded('favicon.ico').isExcluded).toBe(true);
      expect(isFileExcluded('fonts/inter.woff2').isExcluded).toBe(true);
    });

    it('excludes generated build artifacts and minified files', () => {
      expect(isFileExcluded('.next/server/pages.js').isExcluded).toBe(true);
      expect(isFileExcluded('dist/bundle.min.js').isExcluded).toBe(true);
      expect(isFileExcluded('coverage/lcov.info').isExcluded).toBe(true);
      expect(isFileExcluded('.git/HEAD').isExcluded).toBe(true);
    });

    it('allows source code files and configuration', () => {
      expect(isFileExcluded('src/middleware.ts').isExcluded).toBe(false);
      expect(isFileExcluded('app/api/route.ts').isExcluded).toBe(false);
      expect(isFileExcluded('tests/unit.test.ts').isExcluded).toBe(false);
      expect(isFileExcluded('README.md').isExcluded).toBe(false);
    });
  });

  describe('matchesFileBoundary', () => {
    const boundaries = [
      'src/middleware/rate-limiter.ts',
      'src/config/*',
      'tests/**/*.test.ts',
    ];

    it('matches exact filenames', () => {
      expect(matchesFileBoundary('src/middleware/rate-limiter.ts', boundaries)).toBe(true);
      expect(matchesFileBoundary('a/src/middleware/rate-limiter.ts', boundaries)).toBe(true);
      expect(matchesFileBoundary('b/src/middleware/rate-limiter.ts', boundaries)).toBe(true);
    });

    it('matches directory prefix wildcards', () => {
      expect(matchesFileBoundary('src/config/redis.ts', boundaries)).toBe(true);
      expect(matchesFileBoundary('src/config/db.ts', boundaries)).toBe(true);
    });

    it('matches glob recursive double stars', () => {
      expect(matchesFileBoundary('tests/unit.test.ts', boundaries)).toBe(true);
      expect(matchesFileBoundary('tests/middleware/rate-limiter.test.ts', boundaries)).toBe(true);
    });

    it('rejects unauthorized out-of-scope files', () => {
      expect(matchesFileBoundary('src/routes/users.ts', boundaries)).toBe(false);
      expect(matchesFileBoundary('package.json', boundaries)).toBe(false);
      expect(matchesFileBoundary('tsconfig.json', boundaries)).toBe(false);
    });

    it('strictly rejects path prefix false positives without relying on startsWith', () => {
      // Boundaries: 'src/middleware/rate-limiter.ts', 'src/config/*', 'tests/**/*.test.ts'
      // Exact file prefix should NOT match extensions or substrings
      expect(matchesFileBoundary('src/middleware/rate-limiter.ts.bak', boundaries)).toBe(false);
      expect(matchesFileBoundary('src/middleware/rate-limiter.tsx', boundaries)).toBe(false);
      // Single * should NOT match deep subpaths or partial folder names
      expect(matchesFileBoundary('src/config/sub/deep.ts', boundaries)).toBe(false);
      expect(matchesFileBoundary('src/configuration.ts', boundaries)).toBe(false);
      expect(matchesFileBoundary('src/config-extra/file.ts', boundaries)).toBe(false);
    });

    it('allows all files if boundaries array is empty or wildcard', () => {
      expect(matchesFileBoundary('any/file/path.ts', [])).toBe(true);
      expect(matchesFileBoundary('any/file/path.ts', ['*'])).toBe(true);
      expect(matchesFileBoundary('any/file/path.ts', ['**'])).toBe(true);
    });
  });

  describe('sanitizeUnifiedDiff', () => {
    const sampleDiff = `diff --git a/src/middleware/rate-limiter.ts b/src/middleware/rate-limiter.ts
new file mode 100644
index 0000000..8a4e1d2
--- /dev/null
+++ b/src/middleware/rate-limiter.ts
@@ -0,0 +1,10 @@
+export function checkLimit(ip: string) {
+  return { allowed: true };
+}
diff --git a/package.json b/package.json
index 1111111..2222222 100644
--- a/package.json
+++ b/package.json
@@ -5,2 +5,3 @@
   "dependencies": {
+    "ioredis": "^5.3.2"
   }
diff --git a/package-lock.json b/package-lock.json
index 3333333..4444444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -10,3 +10,10 @@
+   "ioredis": { "version": "5.3.2" }
`;

    it('extracts files, additions, deletions, and stats', () => {
      const result = sanitizeUnifiedDiff(sampleDiff, ['src/middleware/rate-limiter.ts']);

      expect(result.stats.totalFilesTouched).toBe(3);
      expect(result.stats.linesAdded).toBeGreaterThan(0);
      expect(result.files).toHaveLength(3);
    });

    it('flags unauthorized files that violate declared boundaries', () => {
      const result = sanitizeUnifiedDiff(sampleDiff, ['src/middleware/rate-limiter.ts']);

      expect(result.stats.unauthorizedPaths).toContain('package.json');
      expect(result.stats.unauthorizedPaths).not.toContain('src/middleware/rate-limiter.ts');

      const pkgFile = result.files.find((f) => f.filename === 'package.json');
      expect(pkgFile?.isAuthorized).toBe(false);

      const limiterFile = result.files.find((f) => f.filename === 'src/middleware/rate-limiter.ts');
      expect(limiterFile?.isAuthorized).toBe(true);
    });

    it('excludes lockfiles from the sanitized diff to protect prompt tokens', () => {
      const result = sanitizeUnifiedDiff(sampleDiff, ['src/middleware/rate-limiter.ts']);

      const lockfile = result.files.find((f) => f.filename === 'package-lock.json');
      expect(lockfile?.isExcluded).toBe(true);
      expect(result.sanitizedDiff).not.toContain('package-lock.json');
    });

    it('returns empty result structure on empty or whitespace diff', () => {
      const result = sanitizeUnifiedDiff('');
      expect(result.sanitizedDiff).toBe('');
      expect(result.stats.totalFilesTouched).toBe(0);
      expect(result.files).toHaveLength(0);
    });
  });
});
