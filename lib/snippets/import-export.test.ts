import { describe, expect, it } from 'vitest';
import {
  SNIPPET_EXPORT_FORMAT,
  SNIPPET_IMPORT_DECRYPT_FAILED,
  SNIPPET_IMPORT_INVALID_PAYLOAD,
  SNIPPET_IMPORT_NOT_A_BUNDLE,
  SnippetImportError,
  exportSnippets,
  importSnippets,
  isSnippetImportError,
  resolveImportConflicts,
} from './import-export';
import { BUILTIN_SNIPPET_IDS, getBuiltinSnippets } from './builtin-loader';
import { parseSnippet, type Snippet } from '@/lib/types/steering';
import {
  STEERING_BUILTIN_DELETE_MESSAGE,
  createMemorySteeringStore,
  wrapRecord,
} from '@/lib/vault/steering-store';

const PASS = 'correct horse battery staple';
const WRONG_PASS = 'incorrect horse battery staple';
const STAMP = '2026-09-01T12:00:00.000Z';

/** Hermetic: no IndexedDB, no DOM, no network. Real WebCrypto does the work. */
function custom(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 'snippet-scope-check',
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

function countingMinter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `snippet-minted-${n}`;
  };
}

describe('encrypted snippet export and import', () => {
  it('round-trips custom snippets through an encrypted bundle', async () => {
    const source = [
      custom(),
      custom({ id: 'snippet-release-note', title: 'Draft a release note', category: 'general' }),
    ];

    const bundleJson = await exportSnippets(source, PASS);
    const restored = await importSnippets(bundleJson, PASS);

    expect(restored).toEqual(source);
    expect(readBundleHeader(bundleJson).format).toBe(SNIPPET_EXPORT_FORMAT);
  });

  it('leaves no snippet plaintext in the serialized bundle', async () => {
    const bundleJson = await exportSnippets([custom()], PASS);

    expect(bundleJson).not.toContain('flag anything unintended');
    expect(bundleJson).not.toContain('Check scope');
    expect(bundleJson).not.toContain(PASS);
  });

  it('restores a bundle in a store that has never seen the source snippets', async () => {
    // Stands in for a fresh browser: different store, independent export passphrase.
    const bundleJson = await exportSnippets([custom()], 'export passphrase on another machine');
    const store = createMemorySteeringStore();
    store.unlock(PASS);

    for (const snippet of await importSnippets(bundleJson, 'export passphrase on another machine')) {
      await store.saveSnippet(snippet);
    }

    const listed = await store.listSnippets();
    expect(listed.filter((snippet) => !snippet.isBuiltin)).toEqual([custom()]);
  });

  it('rejects a wrong export passphrase with a typed error', async () => {
    const bundleJson = await exportSnippets([custom()], PASS);

    await expect(importSnippets(bundleJson, WRONG_PASS)).rejects.toBeInstanceOf(SnippetImportError);
    await expect(importSnippets(bundleJson, WRONG_PASS)).rejects.toThrow(SNIPPET_IMPORT_DECRYPT_FAILED);
    await expect(importSnippets(bundleJson, WRONG_PASS)).rejects.not.toThrow('flag anything unintended');
  });

  it('rejects a file that is not a bundle', async () => {
    await expect(importSnippets('not json at all', PASS)).rejects.toThrow(SNIPPET_IMPORT_NOT_A_BUNDLE);
    await expect(importSnippets(JSON.stringify({ julesKey: 'ghp_nope' }), PASS)).rejects.toThrow(
      SNIPPET_IMPORT_NOT_A_BUNDLE
    );
    await expect(importSnippets(JSON.stringify({ format: SNIPPET_EXPORT_FORMAT }), PASS)).rejects.toThrow(
      SNIPPET_IMPORT_NOT_A_BUNDLE
    );
  });

  it('reports a decrypted-but-unreadable payload separately from a decrypt failure', async () => {
    const bundleJson = await exportSnippets([custom()], PASS);
    // A genuine bundle header wrapping a payload that no longer satisfies SnippetSchema.
    const tampered = JSON.parse(bundleJson) as { envelope: unknown };
    tampered.envelope = await wrapRecord({ snippets: [{ nope: true }] }, PASS);

    const error = await importSnippets(JSON.stringify(tampered), PASS).then(
      () => null,
      (err: unknown) => err
    );
    expect(isSnippetImportError(error)).toBe(true);
    expect((error as SnippetImportError).code).toBe('invalid_payload');
    expect(SNIPPET_IMPORT_INVALID_PAYLOAD).toContain('unreadable');
  });

  it('exports an empty list rather than failing when the operator has no custom snippets', async () => {
    const bundleJson = await exportSnippets(getBuiltinSnippets(), PASS);
    expect(await importSnippets(bundleJson, PASS)).toEqual([]);
  });
});

describe('import conflict resolution', () => {
  const existing = [
    custom({ id: 'snippet-a', title: 'Check scope', usageCount: 4 }),
    custom({ id: 'snippet-b', title: 'Draft a release note' }),
  ];

  it('replace overwrites a same-title snippet in place and appends the rest', () => {
    const incoming = [
      custom({ id: 'snippet-incoming-a', title: 'check SCOPE ', content: 'Rewritten by the import.' }),
      custom({ id: 'snippet-c', title: 'Describe rollback' }),
    ];

    const resolved = resolveImportConflicts(existing, incoming, 'replace');

    expect(resolved.map((snippet) => snippet.id)).toEqual([
      'snippet-incoming-a',
      'snippet-b',
      'snippet-c',
    ]);
    expect(resolved[0].content).toBe('Rewritten by the import.');
    expect(resolved[0].usageCount).toBe(0);
  });

  it('replace drops an existing record whose id the import reuses under a new title', () => {
    const incoming = [custom({ id: 'snippet-a', title: 'Entirely different title' })];

    const resolved = resolveImportConflicts(existing, incoming, 'replace');

    // snippet-a is gone (the store is keyed by id, so both cannot exist); the
    // unrelated snippet-b is untouched.
    expect(resolved).toEqual([existing[1], incoming[0]]);
  });

  it('merge keeps both copies and re-ids the incoming one', () => {
    const incoming = [
      custom({ id: 'snippet-incoming-a', title: 'Check scope', usageCount: 9 }),
      custom({ id: 'snippet-c', title: 'Describe rollback' }),
    ];

    const resolved = resolveImportConflicts(existing, incoming, 'merge', {
      mintId: countingMinter(),
      now: '2026-10-02T00:00:00.000Z',
    });

    expect(resolved).toEqual([
      existing[0],
      existing[1],
      { ...incoming[0], id: 'snippet-minted-1', usageCount: 0, isPinned: false, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
      incoming[1],
    ]);
    expect(new Set(resolved.map((snippet) => snippet.id)).size).toBe(resolved.length);
  });

  it('merge re-ids a same-id import even when the titles differ', () => {
    const incoming = [custom({ id: 'snippet-b', title: 'Brand new title' })];

    const resolved = resolveImportConflicts(existing, incoming, 'merge', { mintId: countingMinter() });

    expect(resolved.map((snippet) => [snippet.id, snippet.title])).toEqual([
      ['snippet-a', 'Check scope'],
      ['snippet-b', 'Draft a release note'],
      ['snippet-minted-1', 'Brand new title'],
    ]);
  });

  it('skip drops same-title imports and adds the rest untouched', () => {
    const incoming = [
      custom({ id: 'snippet-incoming-a', title: 'CHECK SCOPE' }),
      custom({ id: 'snippet-c', title: 'Describe rollback' }),
    ];

    expect(resolveImportConflicts(existing, incoming, 'skip')).toEqual([
      ...existing,
      incoming[1],
    ]);
  });

  it('never lets a built-in title collide with the operator’s own fork', () => {
    const builtin = getBuiltinSnippets()[0];
    const fork = custom({ id: 'snippet-fork', title: builtin.title, forkedFromId: builtin.id });

    for (const mode of ['replace', 'merge', 'skip'] as const) {
      const resolved = resolveImportConflicts([builtin], [fork], mode, { mintId: countingMinter() });
      expect(resolved.map((snippet) => snippet.id)).toEqual([builtin.id, 'snippet-fork']);
      expect(resolved[0]).toEqual(builtin);
    }
  });

  it('keeps built-ins and never writes an incoming built-in, in any mode', () => {
    const builtins = getBuiltinSnippets();
    const rogue = builtins[0];

    for (const mode of ['replace', 'merge', 'skip'] as const) {
      const resolved = resolveImportConflicts([...builtins, ...existing], [rogue, custom()], mode, {
        mintId: countingMinter(),
      });
      const ids = resolved.map((snippet) => snippet.id);
      // Built-ins survive untouched, and the incoming built-in was dropped rather
      // than duplicated or written.
      for (const builtinId of BUILTIN_SNIPPET_IDS) {
        expect(ids).toContain(builtinId);
      }
      expect(ids.filter((id) => id.startsWith('builtin-')).length).toBe(builtins.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('built-ins survive a full import', () => {
  it('leaves every built-in listed and unchanged after importing customs', async () => {
    const store = createMemorySteeringStore();
    store.unlock(PASS);
    const before = await store.listSnippets();
    const bundleJson = await exportSnippets([custom()], PASS);
    const incoming = await importSnippets(bundleJson, PASS);

    const current = (await store.listSnippets()).filter((snippet) => !snippet.isBuiltin);
    const resolved = resolveImportConflicts(current, incoming, 'merge');
    const currentIds = new Set(current.map((snippet) => snippet.id));
    const resolvedIds = new Set(resolved.map((snippet) => snippet.id));
    for (const snippet of resolved.filter((entry) => !currentIds.has(entry.id))) {
      await store.saveSnippet(snippet);
    }
    for (const snippet of current.filter((entry) => !resolvedIds.has(entry.id))) {
      await store.deleteSnippet(snippet.id);
    }

    const after = await store.listSnippets();
    expect(after.filter((snippet) => snippet.isBuiltin)).toEqual(
      before.filter((snippet) => snippet.isBuiltin)
    );
    expect(after.map((snippet) => snippet.id)).toEqual([
      ...BUILTIN_SNIPPET_IDS,
      ...after.filter((snippet) => !snippet.isBuiltin).map((snippet) => snippet.id),
    ]);
    expect(after.some((snippet) => !snippet.isBuiltin)).toBe(true);
  });

  it('never lets a bundle write a snippet under a builtin- id', async () => {
    const forged = parseSnippet({ ...getBuiltinSnippets()[1] });
    const bundleJson = await exportSnippets([forged], PASS);
    expect(await importSnippets(bundleJson, PASS)).toEqual([]);
  });

  it('still refuses to delete a built-in after an import', async () => {
    const store = createMemorySteeringStore();
    store.unlock(PASS);
    await expect(store.deleteSnippet(BUILTIN_SNIPPET_IDS[0])).rejects.toThrow(STEERING_BUILTIN_DELETE_MESSAGE);
    expect((await store.listSnippets()).some((snippet) => snippet.id === BUILTIN_SNIPPET_IDS[0])).toBe(true);
  });
});

/** Reads only the non-secret header fields of a bundle. */
function readBundleHeader(json: string): { format: string; version: number; exportedAt: string } {
  const parsed = JSON.parse(json) as { format: string; version: number; exportedAt: string };
  return { format: parsed.format, version: parsed.version, exportedAt: parsed.exportedAt };
}
