'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SnippetEditor, type SnippetEditorMode } from '@/components/SnippetEditor';
import { SnippetIOButtons } from '@/components/SnippetIOButtons';
import { isBuiltinSnippetId } from '@/lib/snippets/builtin-loader';
import { SnippetCategorySchema, type Snippet, type SnippetCategory } from '@/lib/types/steering';
import { STEERING_BUILTIN_DELETE_MESSAGE, type SteeringStore } from '@/lib/vault/steering-store';
import { GitFork, Pencil, Pin, Plus, Trash2 } from 'lucide-react';

const SNIPPET_CATEGORIES = SnippetCategorySchema.options;

export const BUILTIN_FORK_NOTICE = `${STEERING_BUILTIN_DELETE_MESSAGE} Edit to fork this snippet.`;

export interface SnippetLibraryProps {
  store: SteeringStore;
  snippets: Snippet[];
  onChanged: () => void | Promise<void>;
}

interface EditorState {
  mode: SnippetEditorMode;
  source: Snippet | null;
}

function matchesQuery(snippet: Snippet, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    snippet.title.toLowerCase().includes(needle) || snippet.content.toLowerCase().includes(needle)
  );
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function SnippetLibrary({ store, snippets, onChanged }: SnippetLibraryProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SnippetCategory | 'all'>('all');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const filtered = snippets.filter(
      (snippet) =>
        matchesQuery(snippet, query.trim()) && (category === 'all' || snippet.category === category)
    );
    // Stable sort: pinned snippets float, everything else keeps the store order
    // (built-ins first, then the operator's own snippets).
    return [...filtered].sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
  }, [snippets, query, category]);

  const closeEditor = () => setEditor(null);

  const handleDelete = async (snippet: Snippet) => {
    setError(null);
    if (snippet.isBuiltin || isBuiltinSnippetId(snippet.id)) {
      // Never a silent no-op: say why, then route the operator into the fork path.
      setNotice(BUILTIN_FORK_NOTICE);
      setEditor({ mode: 'fork', source: snippet });
      return;
    }
    setNotice(null);
    try {
      await store.deleteSnippet(snippet.id);
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete the snippet.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles and content..."
          className="max-w-sm bg-white"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as SnippetCategory | 'all')}
          aria-label="Filter by category"
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
        >
          <option value="all">All categories</option>
          {SNIPPET_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {visible.length} of {snippets.length} snippet{snippets.length === 1 ? '' : 's'}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            setNotice(null);
            setEditor({ mode: 'create', source: null });
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New snippet
        </Button>
      </div>

      {notice && (
        <p className="p-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900">{notice}</p>
      )}
      {error && <p className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-800">{error}</p>}

      {editor && (
        <SnippetEditor
          store={store}
          mode={editor.mode}
          source={editor.source}
          onClose={closeEditor}
          onSaved={async () => {
            closeEditor();
            setNotice(null);
            await onChanged();
          }}
        />
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">No snippets match this search.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((snippet) => {
            const builtin = snippet.isBuiltin || isBuiltinSnippetId(snippet.id);
            return (
              <li
                key={snippet.id}
                className="p-4 border rounded-lg bg-white shadow-sm flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{snippet.title}</h3>
                    {builtin && (
                      <span className="rounded bg-indigo-50 text-indigo-800 text-[10px] font-bold uppercase px-1.5 py-0.5">
                        Built-in · edit to fork
                      </span>
                    )}
                    {snippet.isPinned && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-700">
                        <Pin className="w-3 h-3" />
                        Pinned
                      </span>
                    )}
                    {snippet.forkedFromId && (
                      <span className="rounded bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0.5">
                        Fork of {snippet.forkedFromId}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {snippet.category} · updated {formatDate(snippet.updatedAt)} · used {snippet.usageCount}{' '}
                    time{snippet.usageCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{snippet.content}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNotice(null);
                      setEditor({ mode: builtin ? 'fork' : 'edit', source: snippet });
                    }}
                  >
                    {builtin ? <GitFork className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    {builtin ? 'Fork' : 'Edit'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={builtin ? 'Built-in snippets cannot be deleted' : 'Delete snippet'}
                    title={builtin ? STEERING_BUILTIN_DELETE_MESSAGE : 'Delete snippet'}
                    onClick={() => void handleDelete(snippet)}
                    className={builtin ? 'text-amber-600' : 'text-slate-400 hover:text-red-600'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SnippetIOButtons store={store} snippets={snippets} onImported={onChanged} />
    </div>
  );
}
