import { describe, it, expect } from 'vitest';
import {
  RepoProfileSchema,
  SnippetSchema,
  SteeringParseError,
  parseRepoProfile,
  parseSnippet,
  type RepoProfile,
  type Snippet,
} from '@/lib/types/steering';

const STAMP = '2026-09-01T12:00:00.000Z';

function profile(overrides: Partial<RepoProfile> = {}): RepoProfile {
  return {
    id: 'octo/hello-world',
    repoRef: { owner: 'octo', repo: 'hello-world', defaultBranch: 'main' },
    stack: { packageManager: 'npm', testRunner: 'vitest', framework: 'next', languages: ['TypeScript'] },
    conventions: [{ id: 'conv-commits', title: 'Conventional commits', body: 'Use conventional commit prefixes.' }],
    customInstructions: 'Prefer small diffs.',
    updatedAt: STAMP,
    version: 1,
    ...overrides,
  };
}

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 'custom-scope-check',
    title: 'Check scope',
    content: 'List every file in scope and flag anything unintended.',
    category: 'investigation',
    isBuiltin: false,
    isPinned: false,
    usageCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe('RepoProfile schema', () => {
  it('accepts a compliant profile and infers defaults-free shape', () => {
    const result = RepoProfileSchema.safeParse(profile());
    expect(result.success).toBe(true);
    expect(parseRepoProfile(profile())).toEqual(profile());
  });

  it('accepts a profile without optional fields', () => {
    const minimal = profile({ customInstructions: undefined, notes: undefined });
    delete minimal.customInstructions;
    delete minimal.notes;
    const noBranch = { ...minimal, repoRef: { owner: 'octo', repo: 'hello-world' } };
    expect(RepoProfileSchema.safeParse(noBranch).success).toBe(true);
  });

  it.each([
    { name: 'missing id', value: () => ({ ...profile(), id: undefined }) },
    { name: 'missing repoRef', value: () => ({ ...profile(), repoRef: undefined }) },
    { name: 'missing stack', value: () => ({ ...profile(), stack: undefined }) },
    { name: 'missing conventions', value: () => ({ ...profile(), conventions: undefined }) },
    { name: 'missing updatedAt', value: () => ({ ...profile(), updatedAt: undefined }) },
    { name: 'missing version', value: () => ({ ...profile(), version: undefined }) },
  ])('rejects $name', ({ value }) => {
    expect(RepoProfileSchema.safeParse(value()).success).toBe(false);
    expect(() => parseRepoProfile(value())).toThrow(SteeringParseError);
  });

  it.each([
    { name: 'malformed date', value: 'not-a-date' },
    { name: 'date-only without time', value: '2026-09-01' },
    { name: 'empty string', value: '' },
  ])('rejects $name updatedAt', ({ value }) => {
    expect(RepoProfileSchema.safeParse(profile({ updatedAt: value })).success).toBe(false);
  });

  it('rejects zero or fractional versions', () => {
    expect(RepoProfileSchema.safeParse(profile({ version: 0 })).success).toBe(false);
    expect(RepoProfileSchema.safeParse(profile({ version: 1.5 })).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(RepoProfileSchema.safeParse({ ...profile(), extra: 'nope' }).success).toBe(false);
  });
});

describe('Snippet schema', () => {
  it('accepts a compliant custom snippet and applies defaults', () => {
    const raw = snippet({ isPinned: undefined, usageCount: undefined });
    delete (raw as Partial<Snippet>).isPinned;
    delete (raw as Partial<Snippet>).usageCount;
    const parsed = parseSnippet(raw);
    expect(parsed.isPinned).toBe(false);
    expect(parsed.usageCount).toBe(0);
  });

  it('accepts a compliant built-in snippet', () => {
    const builtin = snippet({ id: 'builtin-run-tests', isBuiltin: true });
    expect(SnippetSchema.safeParse(builtin).success).toBe(true);
  });

  it.each([
    { name: 'missing id', value: () => ({ ...snippet(), id: undefined }) },
    { name: 'missing title', value: () => ({ ...snippet(), title: undefined }) },
    { name: 'missing content', value: () => ({ ...snippet(), content: undefined }) },
    { name: 'missing category', value: () => ({ ...snippet(), category: undefined }) },
    { name: 'missing isBuiltin', value: () => ({ ...snippet(), isBuiltin: undefined }) },
    { name: 'missing createdAt', value: () => ({ ...snippet(), createdAt: undefined }) },
    { name: 'missing updatedAt', value: () => ({ ...snippet(), updatedAt: undefined }) },
  ])('rejects $name', ({ value }) => {
    expect(SnippetSchema.safeParse(value()).success).toBe(false);
    expect(() => parseSnippet(value())).toThrow(SteeringParseError);
  });

  it('rejects an invalid category', () => {
    expect(SnippetSchema.safeParse(snippet({ category: 'brainstorm' as never })).success).toBe(false);
  });

  it('rejects malformed createdAt and updatedAt', () => {
    expect(SnippetSchema.safeParse(snippet({ createdAt: 'yesterday' })).success).toBe(false);
    expect(SnippetSchema.safeParse(snippet({ updatedAt: '2026/09/01' })).success).toBe(false);
  });

  it('rejects builtin flag and id prefix drift', () => {
    expect(SnippetSchema.safeParse(snippet({ id: 'custom-x', isBuiltin: true })).success).toBe(false);
    expect(SnippetSchema.safeParse(snippet({ id: 'builtin-custom-x', isBuiltin: false })).success).toBe(false);
  });

  it('rejects blank title and content', () => {
    expect(SnippetSchema.safeParse(snippet({ title: '   ' })).success).toBe(false);
    expect(SnippetSchema.safeParse(snippet({ content: '' })).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(SnippetSchema.safeParse({ ...snippet(), extra: 'nope' }).success).toBe(false);
  });
});
