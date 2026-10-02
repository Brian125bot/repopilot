import { parseSnippet, type Snippet, type SnippetCategory } from '@/lib/types/steering';

/**
 * COR-58 pure record factories for the snippet library.
 *
 * Built-in snippets are immutable: `saveSnippet` rejects any `builtin-` id and
 * `SnippetSchema` rejects `isBuiltin: false` on one, so editing a built-in cannot
 * mutate it. Editing a built-in therefore mints a genuinely new custom record.
 */

export interface CreateSnippetInput {
  title: string;
  content: string;
  category: SnippetCategory;
  isPinned?: boolean;
  now?: string;
}

export function createSnippet({
  title,
  content,
  category,
  isPinned = false,
  now,
}: CreateSnippetInput): Snippet {
  const timestamp = now ?? new Date().toISOString();
  const candidate: Snippet = {
    id: `snippet-${crypto.randomUUID()}`,
    title,
    content,
    category,
    isBuiltin: false,
    isPinned,
    usageCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return parseSnippet(candidate);
}

export function forkSnippet(source: Snippet, now?: string): Snippet {
  const timestamp = now ?? new Date().toISOString();
  const candidate: Snippet = {
    id: `snippet-${crypto.randomUUID()}`,
    title: source.title,
    content: source.content,
    category: source.category,
    isBuiltin: false,
    isPinned: false,
    usageCount: 0,
    forkedFromId: source.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return parseSnippet(candidate);
}
