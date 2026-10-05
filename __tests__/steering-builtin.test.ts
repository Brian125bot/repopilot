import { describe, it, expect } from 'vitest';
import {
  BUILTIN_SNIPPET_IDS,
  getBuiltinSnippets,
  isBuiltinSnippetId,
} from '@/lib/snippets/builtin-loader';
import { forkSnippet } from '@/lib/snippets/fork';
import { SnippetSchema, parseSnippet } from '@/lib/types/steering';
import {
  STEERING_BUILTIN_DELETE_MESSAGE,
  STEERING_BUILTIN_OVERWRITE_MESSAGE,
  createMemorySteeringRecordStore,
  createSteeringStore,
} from '@/lib/vault/steering-store';

const PASS = 'correct horse battery staple';

describe('built-in snippet loader', () => {
  it('provides stable builtin- records that validate', () => {
    const builtins = getBuiltinSnippets();
    expect(builtins.length).toBeGreaterThanOrEqual(20);
    for (const snippet of builtins) {
      expect(snippet.id.startsWith('builtin-')).toBe(true);
      expect(snippet.isBuiltin).toBe(true);
      expect(() => parseSnippet(snippet)).not.toThrow();
      expect(SnippetSchema.safeParse(snippet).success).toBe(true);
    }
    expect(BUILTIN_SNIPPET_IDS).toEqual(builtins.map((snippet) => snippet.id));
  });

  it('gives every built-in a unique id', () => {
    expect(new Set(BUILTIN_SNIPPET_IDS).size).toBe(BUILTIN_SNIPPET_IDS.length);
    expect(BUILTIN_SNIPPET_IDS.length).toBe(getBuiltinSnippets().length);
  });

  it('keeps the four original built-in ids stable across the COR-58 expansion', () => {
    for (const id of [
      'builtin-run-tests',
      'builtin-verify-lint',
      'builtin-explain-diff',
      'builtin-explain-failure',
    ]) {
      expect(BUILTIN_SNIPPET_IDS).toContain(id);
    }
  });

  it('returns frozen copies that cannot mutate the base fixtures', () => {
    const first = getBuiltinSnippets();
    const second = getBuiltinSnippets();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(isBuiltinSnippetId(first[0].id)).toBe(true);
    expect(isBuiltinSnippetId('custom-scope-check')).toBe(false);
  });

  it('rejects attempts to delete built-ins through the store', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    for (const id of BUILTIN_SNIPPET_IDS) {
      await expect(store.deleteSnippet(id)).rejects.toThrow(STEERING_BUILTIN_DELETE_MESSAGE);
    }
    expect(store.isLocked()).toBe(false);
  });

  it('keeps a built-in listable after the delete guard rejects it', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    const id = BUILTIN_SNIPPET_IDS[0];

    await expect(store.deleteSnippet(id)).rejects.toThrow(STEERING_BUILTIN_DELETE_MESSAGE);

    expect((await store.listSnippets()).map((snippet) => snippet.id)).toContain(id);
    expect((await store.getSnippet(id))?.isBuiltin).toBe(true);
  });
});

describe('forking a built-in snippet', () => {
  it('mints a new non-builtin record with forkedFromId and real timestamps', () => {
    const source = getBuiltinSnippets()[0];
    const before = new Date().toISOString();
    const fork = forkSnippet(source);
    const after = new Date().toISOString();

    expect(fork.id.startsWith('builtin-')).toBe(false);
    expect(isBuiltinSnippetId(fork.id)).toBe(false);
    expect(fork.isBuiltin).toBe(false);
    expect(fork.isPinned).toBe(false);
    expect(fork.usageCount).toBe(0);
    expect(fork.forkedFromId).toBe(source.id);
    expect(fork.title).toBe(source.title);
    expect(fork.content).toBe(source.content);
    expect(fork.category).toBe(source.category);
    expect(fork.createdAt).toBe(fork.updatedAt);
    expect(fork.createdAt).not.toBe(source.createdAt);
    expect(Date.parse(fork.createdAt)).toBeGreaterThanOrEqual(Date.parse(before));
    expect(Date.parse(fork.createdAt)).toBeLessThanOrEqual(Date.parse(after));
    expect(parseSnippet(fork)).toEqual(fork);
  });

  it('accepts an injected clock and never mutates the source', () => {
    const source = getBuiltinSnippets()[1];
    const fork = forkSnippet(source, '2026-10-02T09:30:00.000Z');

    expect(fork.createdAt).toBe('2026-10-02T09:30:00.000Z');
    expect(fork.updatedAt).toBe('2026-10-02T09:30:00.000Z');
    expect(getBuiltinSnippets()[1]).toEqual(source);
  });

  it('saves a fork but refuses any write under a builtin- id', async () => {
    const store = createSteeringStore(createMemorySteeringRecordStore());
    store.unlock(PASS);
    const source = getBuiltinSnippets()[0];
    const fork = forkSnippet(source);

    await store.saveSnippet(fork);

    const listed = await store.listSnippets();
    expect(listed.some((snippet) => snippet.id === fork.id && snippet.forkedFromId === source.id)).toBe(true);
    expect(listed.some((snippet) => snippet.id === source.id)).toBe(true);
    await expect(store.saveSnippet({ ...fork, id: 'builtin-sneaky-fork' })).rejects.toThrow(
      STEERING_BUILTIN_OVERWRITE_MESSAGE
    );
  });
});
