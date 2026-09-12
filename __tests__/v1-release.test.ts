import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('RepoPilot 1.0 release artifacts', () => {
  it('declares version 1.0.0 and keeps Gemini User-Agent RepoPilot/1.0', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(pkg.version).toBe('1.0.0');
    const gemini = readFileSync('lib/gemini.ts', 'utf8');
    expect(gemini).toContain("'User-Agent': 'RepoPilot/1.0'");
    expect(gemini).not.toContain('aistudio-build');
    const evaluate = readFileSync('app/api/audit/evaluate/route.ts', 'utf8');
    expect(evaluate).toMatch(/export const maxDuration = 60/);
  });

  it('ships LICENSE, SECURITY note, golden path, and CI lint+build', () => {
    expect(existsSync('LICENSE')).toBe(true);
    expect(existsSync('SECURITY.md')).toBe(true);
    const security = readFileSync('SECURITY.md', 'utf8');
    expect(security).toMatch(/localStorage/i);
    expect(security).toMatch(/persists nothing|does not persist/i);
    const golden = readFileSync('docs/GOLDEN_PATH.md', 'utf8');
    expect(golden).toMatch(/Settings keys/i);
    expect(golden).toMatch(/connected repo/i);
    expect(golden).toMatch(/Dispatch/i);
    expect(golden).toMatch(/Evaluate/i);
    expect(golden).toMatch(/same-branch|audited PR branch/i);
    expect(golden).toMatch(/Two stages/i);
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm test');
    expect(ci).toContain('tsc --noEmit');
    expect(ci).toContain('eslint');
    expect(ci).toContain('next build');
  });

  it('does not log credential header names as values in API routes', () => {
    const routes = [
      'app/api/audit/evaluate/route.ts',
      'app/api/jules/dispatch/route.ts',
      'app/api/jules/session/route.ts',
      'app/api/jules/message/route.ts',
      'app/api/audit/fetch-diff/route.ts',
    ];
    for (const file of routes) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/console\.(error|log|warn)\([^)]*headers/);
      expect(src).not.toMatch(/console\.(error|log|warn)\([^)]*x-jules-api-key/);
      expect(src).not.toMatch(/console\.(error|log|warn)\([^)]*x-gemini-api-key/);
      expect(src).not.toMatch(/console\.(error|log|warn)\([^)]*x-github-pat/);
    }
  });
});
