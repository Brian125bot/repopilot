import { z } from 'zod';
import { SnippetSchema, type Snippet } from '@/lib/types/steering';
import { unwrapRecord, wrapRecord, type SteeringEnvelope } from '@/lib/vault/steering-store';

/**
 * COR-58 encrypted snippet transfer.
 *
 * The bundle is encrypted with the *operator-supplied export passphrase*, not the
 * vault key, so it can be decrypted on a fresh browser without transferring the
 * vault. All key derivation and AES-GCM work is delegated to `wrapRecord` /
 * `unwrapRecord` (PBKDF2-SHA256 + AES-GCM via `lib/credential-vault`); this module
 * adds no second encryption path.
 *
 * Conflict resolution is a pure function over parsed snippet arrays so it can be
 * unit tested without a vault, IndexedDB, or a DOM.
 */

export const SNIPPET_EXPORT_FORMAT = 'repopilot-snippet-bundle';
export const SNIPPET_EXPORT_VERSION = 1;
export const SNIPPET_EXPORT_FILE_PREFIX = 'repopilot-snippets';

/**
 * Hard ceilings for an import. The snippet cap keeps a hostile or hand-edited
 * bundle from making the operator scroll (or the vault write) unbounded; the
 * file cap is checked by the UI *before* the file is read into memory.
 */
export const SNIPPET_IMPORT_MAX_SNIPPETS = 500;
export const SNIPPET_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Longest base64 field a legitimate envelope can carry (salt/iv are 24 chars). */
const MAX_ENVELOPE_FIELD_BYTES = 256;
const MAX_ENVELOPE_CIPHERTEXT_BYTES = 10_000_000;
const MAX_ENVELOPE_TIMESTAMP_BYTES = 64;

/** Mirrors the envelope shape; `unwrapRecord` re-validates it before decrypting. */
const SteeringEnvelopeSchema = z
  .object({
    version: z.literal(1),
    saltB64: z.string().min(1).max(MAX_ENVELOPE_FIELD_BYTES),
    ivB64: z.string().min(1).max(MAX_ENVELOPE_FIELD_BYTES),
    ciphertextB64: z.string().min(1).max(MAX_ENVELOPE_CIPHERTEXT_BYTES),
    updatedAt: z.string().min(1).max(MAX_ENVELOPE_TIMESTAMP_BYTES),
  })
  .strict();

export const SnippetBundleSchema = z
  .object({
    format: z.literal(SNIPPET_EXPORT_FORMAT),
    version: z.literal(SNIPPET_EXPORT_VERSION),
    exportedAt: z.string().min(1).max(MAX_ENVELOPE_TIMESTAMP_BYTES),
    envelope: SteeringEnvelopeSchema,
  })
  .strict();

export type SnippetBundle = z.infer<typeof SnippetBundleSchema>;

const SnippetBundlePayloadSchema = z
  .object({
    snippets: z
      .array(SnippetSchema)
      .max(
        SNIPPET_IMPORT_MAX_SNIPPETS,
        `A bundle may carry at most ${SNIPPET_IMPORT_MAX_SNIPPETS} snippets.`
      ),
  })
  .strict();

export type SnippetImportErrorCode = 'not_a_bundle' | 'decrypt_failed' | 'invalid_payload';

const IMPORT_MESSAGES: Record<SnippetImportErrorCode, string> = {
  not_a_bundle: 'This file is not a RepoPilot snippet bundle.',
  decrypt_failed: 'Could not decrypt the bundle — wrong export passphrase or corrupted file.',
  invalid_payload: 'The bundle decrypted but its snippet list is unreadable.',
};

export const SNIPPET_IMPORT_NOT_A_BUNDLE = IMPORT_MESSAGES.not_a_bundle;
export const SNIPPET_IMPORT_DECRYPT_FAILED = IMPORT_MESSAGES.decrypt_failed;
export const SNIPPET_IMPORT_INVALID_PAYLOAD = IMPORT_MESSAGES.invalid_payload;

export class SnippetImportError extends Error {
  readonly code: SnippetImportErrorCode;
  constructor(code: SnippetImportErrorCode) {
    super(IMPORT_MESSAGES[code]);
    this.name = 'SnippetImportError';
    this.code = code;
  }
}

export function isSnippetImportError(value: unknown): value is SnippetImportError {
  return value instanceof SnippetImportError;
}

/**
 * Size guard for the UI: call it on the picked `File` *before* reading it
 * with `file.text()`, so an oversized file never enters memory.
 */
export function isImportFileSizeAllowed(sizeInBytes: number): boolean {
  return (
    Number.isFinite(sizeInBytes) &&
    sizeInBytes >= 0 &&
    sizeInBytes <= SNIPPET_IMPORT_MAX_FILE_BYTES
  );
}

/** Built-ins ship with the app: they are never exported and never written by an import. */
function isImportableSnippet(snippet: Snippet): boolean {
  return snippet.isBuiltin !== true && !snippet.id.startsWith('builtin-');
}

function titleKey(snippet: Snippet): string {
  return snippet.title.trim().toLowerCase();
}

/**
 * Custom snippets only, wrapped with the operator's export passphrase.
 *
 * Built-ins are omitted deliberately: they are identical on every install, so
 * carrying them would bloat the bundle and create name conflicts on import.
 */
export async function exportSnippets(snippets: Snippet[], exportPassphrase: string): Promise<string> {
  const customs = snippets.filter(isImportableSnippet);
  const envelope = await wrapRecord({ snippets: customs }, exportPassphrase);
  const bundle: SnippetBundle = {
    format: SNIPPET_EXPORT_FORMAT,
    version: SNIPPET_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    envelope,
  };
  return JSON.stringify(SnippetBundleSchema.parse(bundle), null, 2);
}

/** Decrypts a bundle with the export passphrase. Built-in entries inside it are dropped. */
export async function importSnippets(bundleJson: string, exportPassphrase: string): Promise<Snippet[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(bundleJson);
  } catch {
    throw new SnippetImportError('not_a_bundle');
  }
  const bundle = SnippetBundleSchema.safeParse(raw);
  if (!bundle.success) {
    throw new SnippetImportError('not_a_bundle');
  }
  // Decrypt first with a permissive schema so a crypto failure (wrong passphrase,
  // tampered ciphertext) is reported separately from an unreadable payload.
  let decrypted: unknown;
  try {
    decrypted = await unwrapRecord<unknown>(bundle.data.envelope, exportPassphrase, z.unknown());
  } catch {
    throw new SnippetImportError('decrypt_failed');
  }
  const payload = SnippetBundlePayloadSchema.safeParse(decrypted);
  if (!payload.success) {
    throw new SnippetImportError('invalid_payload');
  }
  return payload.data.snippets.filter(isImportableSnippet);
}

export type ImportConflictMode = 'replace' | 'merge' | 'skip';

export interface ResolveImportOptions {
  /**
   * Stamps re-minted copies. When omitted the incoming record's own timestamps are
   * preserved, so the function stays pure and deterministic.
   */
  now?: string;
  /** Id factory for copies that must not reuse an id. Defaults to a fresh uuid. */
  mintId?: () => string;
}

function reMint(snippet: Snippet, mintId: () => string, now: string | undefined): Snippet {
  const stamp = now ?? snippet.updatedAt;
  return {
    ...snippet,
    id: mintId(),
    isBuiltin: false,
    isPinned: false,
    usageCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * Resolves an incoming snippet list against what the operator already has.
 *
 * Guarantees for every mode: a built-in is never replaced, dropped or rewritten
 * (built-ins are carried through first, untouched), an incoming built-in is never
 * written, and the result never contains two records with the same id. Conflicts
 * are matched on the trimmed, case-insensitive title of the operator's **own**
 * snippets only — a fork that keeps a built-in's title is a legitimate custom
 * record and must survive an import on a fresh browser.
 */
export function resolveImportConflicts(
  existing: Snippet[],
  incoming: Snippet[],
  mode: ImportConflictMode,
  options: ResolveImportOptions = {},
): Snippet[] {
  const mintId = options.mintId ?? (() => `snippet-${crypto.randomUUID()}`);
  // A hand-edited bundle can repeat an id; keeping the first occurrence is
  // what preserves the "no two records share an id" invariant below.
  const importable = uniqueById(incoming.filter(isImportableSnippet));
  const builtins = existing.filter(isBuiltinRecord);
  const customs = existing.filter((snippet) => !isBuiltinRecord(snippet));
  const resolvedCustoms = resolveCustoms(customs, importable, mode, mintId, options.now);
  return [...builtins, ...resolvedCustoms];
}

function uniqueById(snippets: Snippet[]): Snippet[] {
  const seen = new Set<string>();
  const out: Snippet[] = [];
  for (const snippet of snippets) {
    if (seen.has(snippet.id)) continue;
    seen.add(snippet.id);
    out.push(snippet);
  }
  return out;
}

function isBuiltinRecord(snippet: Snippet): boolean {
  return snippet.isBuiltin || snippet.id.startsWith('builtin-');
}

function resolveCustoms(
  customs: Snippet[],
  importable: Snippet[],
  mode: ImportConflictMode,
  mintId: () => string,
  now: string | undefined,
): Snippet[] {
  if (mode === 'replace') {
    const out: Snippet[] = [];
    const emittedIds = new Set<string>();
    const consumed = new Set<number>();
    for (const current of customs) {
      const byName = importable.findIndex((candidate) => titleKey(candidate) === titleKey(current));
      if (byName !== -1) {
        consumed.add(byName);
        const replacement = importable[byName];
        // Two local records can share a title (a merge left them behind).
        // The first one is replaced by the incoming record; the second is
        // dropped rather than pushing the same id twice.
        if (!emittedIds.has(replacement.id)) {
          emittedIds.add(replacement.id);
          out.push(replacement);
        }
        continue;
      }
      // A different record reusing this id is replaced by the incoming one; the
      // store is keyed by id, so keeping both is not an option.
      if (importable.some((candidate) => candidate.id === current.id)) continue;
      if (!emittedIds.has(current.id)) {
        emittedIds.add(current.id);
        out.push(current);
      }
    }
    importable.forEach((candidate, index) => {
      if (consumed.has(index) || emittedIds.has(candidate.id)) return;
      emittedIds.add(candidate.id);
      out.push(candidate);
    });
    return out;
  }

  const out: Snippet[] = [...customs];
  const ids = new Set(customs.map((snippet) => snippet.id));
  const titles = new Set(customs.map(titleKey));

  if (mode === 'merge') {
    for (const candidate of importable) {
      const key = titleKey(candidate);
      if (!ids.has(candidate.id) && !titles.has(key)) {
        out.push(candidate);
        ids.add(candidate.id);
        titles.add(key);
        continue;
      }
      // Name or id collision: keep both by giving the incoming copy a fresh id.
      const minted = reMint(candidate, mintId, now);
      out.push(minted);
      ids.add(minted.id);
      titles.add(key);
    }
    return out;
  }

  for (const candidate of importable) {
    const key = titleKey(candidate);
    if (titles.has(key)) continue;
    const resolved = ids.has(candidate.id) ? reMint(candidate, mintId, now) : candidate;
    out.push(resolved);
    titles.add(key);
    ids.add(resolved.id);
  }
  return out;
}

export interface ImportWritePlan {
  /** Resolved records that differ from the stored record with the same id. */
  upserts: Snippet[];
  /** Stored custom ids that the resolved list no longer contains. */
  deletions: string[];
}

function snippetsEqual(a: Snippet, b: Snippet): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.content === b.content &&
    a.category === b.category &&
    a.isBuiltin === b.isBuiltin &&
    a.isPinned === b.isPinned &&
    a.usageCount === b.usageCount &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.forkedFromId === b.forkedFromId
  );
}

/**
 * Turns a resolved import into the exact vault writes it needs.
 *
 * The UI must not guess from ids alone: in replace mode a resolved record
 * can share an id with a stored record while differing in title or content,
 * and only a field-by-field comparison tells "nothing to do" from
 * "overwrite the stored record". Upserting every non-identical resolved
 * record and deleting only the ids that vanished is what makes replace mode
 * lossless in both directions.
 */
export function planImportWrites(current: Snippet[], resolved: Snippet[]): ImportWritePlan {
  const resolvedIds = new Set(resolved.map((snippet) => snippet.id));
  const upserts: Snippet[] = [];
  for (const snippet of resolved) {
    const stored = current.find((entry) => entry.id === snippet.id);
    if (stored === undefined || !snippetsEqual(stored, snippet)) {
      upserts.push(snippet);
    }
  }
  const deletions = current
    .filter((entry) => !resolvedIds.has(entry.id))
    .map((entry) => entry.id);
  return { upserts, deletions };
}
