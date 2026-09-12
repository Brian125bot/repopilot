import { describe, it, expect } from 'vitest';
import {
  normalizeRepoSlug,
  sanitizeJulesCredential,
  findJulesSource,
  resolveAutomationMode,
  candidateSourceResourceNames,
  preferredJulesAuthScheme,
  isJulesPrincipalAuthError,
} from '@/lib/jules';
import {
  parseOwnerRepo,
  parseGitHubPRUrl,
  parseAuditIngestTarget,
  githubRequestHeaders,
} from '@/lib/github';

describe('jules helpers', () => {
  it('normalizeRepoSlug strips github prefix, .git, slashes', () => {
    expect(normalizeRepoSlug('https://github.com/acme/api.git')).toBe('acme/api');
    expect(normalizeRepoSlug('/acme/api/')).toBe('acme/api');
    expect(normalizeRepoSlug('  acme/api  ')).toBe('acme/api');
  });

  it('sanitizeJulesCredential trims Bearer/api-key prefixes and rejects empties', () => {
    expect(sanitizeJulesCredential('  Bearer abc123  ')).toContain('abc123');
    expect(sanitizeJulesCredential('')).toBe('');
    expect(sanitizeJulesCredential('   ')).toBe('');
  });

  it('findJulesSource matches owner/repo case-insensitively', () => {
    const sources = [
      { name: 'sources/1', githubRepo: { owner: 'Acme', repo: 'Api' } },
      { name: 'sources/2', githubRepo: { owner: 'other', repo: 'x' } },
    ];
    expect(findJulesSource(sources, 'acme/api')?.name).toBe('sources/1');
    expect(findJulesSource(sources, 'missing/repo')).toBeNull();
    expect(findJulesSource([], 'a/b')).toBeNull();
  });

  it('resolveAutomationMode returns AUTO_CREATE_PR only for first-pass', () => {
    expect(resolveAutomationMode(false)).toBe('AUTO_CREATE_PR');
    expect(resolveAutomationMode(true)).toBeUndefined();
  });

  it('candidateSourceResourceNames includes slug variants', () => {
    const c = candidateSourceResourceNames('acme/api');
    expect(c.length).toBeGreaterThan(0);
    expect(c.join(' ').toLowerCase()).toContain('acme');
  });

  it('preferredJulesAuthScheme distinguishes key shapes', () => {
    expect(['api-key', 'bearer']).toContain(preferredJulesAuthScheme('AIza-xyz'));
    expect(['api-key', 'bearer']).toContain(preferredJulesAuthScheme('ya29.short'));
  });

  it('isJulesPrincipalAuthError detects auth failures', () => {
    expect(isJulesPrincipalAuthError('401: API keys are not supported for this API')).toBe(true);
    expect(isJulesPrincipalAuthError('must assert a principal identity')).toBe(true);
    expect(isJulesPrincipalAuthError('all good')).toBe(false);
  });
});

describe('github helpers', () => {
  it('parseOwnerRepo handles https, slug, and rejects bad', () => {
    expect(parseOwnerRepo('https://github.com/acme/api')).toEqual({ owner: 'acme', repo: 'api' });
    expect(parseOwnerRepo('acme/api')).toEqual({ owner: 'acme', repo: 'api' });
    expect(parseOwnerRepo('badformat')).toBeNull();
  });

  it('parseGitHubPRUrl extracts owner/repo/pullNumber', () => {
    const p = parseGitHubPRUrl('https://github.com/acme/api/pull/42');
    expect(p?.pullNumber).toBe(42);
    expect(p?.owner).toBe('acme');
    expect(parseGitHubPRUrl('not a url')).toBeNull();
  });

  it('parseAuditIngestTarget distinguishes PR vs branch vs unknown', () => {
    expect(parseAuditIngestTarget('https://github.com/a/b/pull/7').kind).toBe('pr');
    expect(parseAuditIngestTarget('a/b (feature-x)').kind).toBe('branch');
    expect(parseAuditIngestTarget('a/b#feature-x').kind).toBe('branch');
    expect(parseAuditIngestTarget('').kind).toBe('unknown');
  });

  it('githubRequestHeaders includes auth only when token present', () => {
    expect(githubRequestHeaders('abc').Authorization).toMatch(/abc/);
    expect(githubRequestHeaders(null).Authorization).toBeUndefined();
  });
});
