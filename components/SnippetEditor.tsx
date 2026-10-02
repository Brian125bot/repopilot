'use client';

import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createSnippet, forkSnippet } from '@/lib/snippets/fork';
import { SnippetCategorySchema, parseSnippet, type Snippet, type SnippetCategory } from '@/lib/types/steering';
import type { SteeringStore } from '@/lib/vault/steering-store';
import { X } from 'lucide-react';

const SNIPPET_CATEGORIES = SnippetCategorySchema.options;

export type SnippetEditorMode = 'create' | 'edit' | 'fork';

export interface SnippetEditorProps {
  store: SteeringStore;
  mode: SnippetEditorMode;
  /** The snippet being edited, or the built-in being forked. Null when creating. */
  source: Snippet | null;
  onClose: () => void;
  onSaved: (snippet: Snippet) => void;
}

function isBuiltinSource(mode: SnippetEditorMode, source: Snippet | null): boolean {
  return mode === 'fork' || Boolean(source?.isBuiltin) || Boolean(source?.id.startsWith('builtin-'));
}

/**
 * Create / edit / fork form. Saving only ever happens on an explicit click.
 *
 * Editing a built-in never writes the built-in id: the save mints a fork with
 * `forkedFromId` set to the original, because the vault refuses `builtin-` ids.
 */
export function SnippetEditor({ store, mode, source, onClose, onSaved }: SnippetEditorProps) {
  const [title, setTitle] = useState(source?.title ?? '');
  const [content, setContent] = useState(source?.content ?? '');
  const [category, setCategory] = useState<SnippetCategory>(source?.category ?? 'general');
  const [isPinned, setIsPinned] = useState(source?.isPinned ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const forking = isBuiltinSource(mode, source);
  const heading = forking ? 'Fork built-in snippet' : mode === 'edit' ? 'Edit snippet' : 'New snippet';

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      let record: Snippet;
      if (forking && source) {
        const forked = forkSnippet(source, now);
        record = parseSnippet({
          ...forked,
          title,
          content,
          category,
          isPinned,
          updatedAt: now,
        });
      } else if (source) {
        record = parseSnippet({
          ...source,
          title,
          content,
          category,
          isPinned,
          updatedAt: now,
        });
      } else {
        record = createSnippet({ title, content, category, isPinned, now });
      }
      await store.saveSnippet(record);
      onSaved(record);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save the snippet.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm space-y-4" role="dialog" aria-label={heading}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{heading}</h3>
          <p className="text-xs text-slate-500 mt-1">
            {forking
              ? 'Built-in snippets cannot be edited in place. Saving creates your own copy; the built-in stays unchanged.'
              : 'Nothing is saved until you click Save.'}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close editor">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700" htmlFor="snippet-title">
          Title
        </label>
        <Input
          id="snippet-title"
          value={title}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Check the change for scope creep"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700" htmlFor="snippet-content">
          Content
        </label>
        <Textarea
          id="snippet-content"
          value={content}
          maxLength={8000}
          rows={6}
          onChange={(event) => setContent(event.target.value)}
          placeholder="List every file in scope and flag anything unintended."
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="snippet-category">
            Category
          </label>
          <select
            id="snippet-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as SnippetCategory)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
          >
            {SNIPPET_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 pt-6">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(event) => setIsPinned(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Pin to the top of the library
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : forking ? 'Save as fork' : 'Save'}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
