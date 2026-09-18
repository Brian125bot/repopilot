import { describe, it, expect } from 'vitest';
import {
  BUILTIN_SNIPPET_IDS,
  getBuiltinSnippets,
  isBuiltinSnippetId,
} from '@/lib/snippets/builtin-loader';
import { SnippetSchema } from '@/lib/types/steering';
import { createMemorySteeringRecordStore, createSteeringStore } from '@/lib/vault/steering-store';

const PASS = 'correct horse battery staple';

describe('built-in snippet loader', () => {
  it('provides stable builtin- records that validate', () => {
    const builtins = getBuiltinSnippets();
    expect(builtins.length).toBeGreaterThanOrEqual(3);
    for (const snippet of builtins) {
      expect(snippet.id.startsWith('builtin-')).toBe(true);
      expect(snippet.isBuiltin).toBe(true);
      expect(SnippetSchema.safeParse(snippet).success).toBe(true);
    }
    expect(BUILTIN_SNIPPET_IDS).toEqual(builtins.map((snippet) => snippet.id));
    expect(new Set(BUILTIN_SNIPPET_IDS).size).toBe(BUILTIN_SNIPPET_IDS.length);
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
      await expect(store.deleteSnippet(id)).rejects.toThrow();
    }
    expect(store.isLocked()).toBe(false);
  });
});
