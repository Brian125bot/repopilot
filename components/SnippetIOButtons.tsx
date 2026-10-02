'use client';

import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SNIPPET_EXPORT_FILE_PREFIX,
  exportSnippets,
  importSnippets,
  isSnippetImportError,
  resolveImportConflicts,
  type ImportConflictMode,
} from '@/lib/snippets/import-export';
import { isBuiltinSnippetId } from '@/lib/snippets/builtin-loader';
import type { Snippet } from '@/lib/types/steering';
import type { SteeringStore } from '@/lib/vault/steering-store';
import { Download, Upload } from 'lucide-react';

const CONFLICT_MODES: Array<{ value: ImportConflictMode; label: string; hint: string }> = [
  {
    value: 'replace',
    label: 'Replace matching titles',
    hint: 'A snippet with the same title in this library is overwritten by the imported one.',
  },
  {
    value: 'merge',
    label: 'Merge (keep both)',
    hint: 'Nothing is removed. A same-title import is saved as a separate copy with a new id.',
  },
  {
    value: 'skip',
    label: 'Skip duplicate titles',
    hint: 'Imports whose title already exists here are dropped; the rest are added.',
  },
];

export interface SnippetIOButtonsProps {
  store: SteeringStore;
  snippets: Snippet[];
  onImported: () => void | Promise<void>;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Encrypted snippet transfer, browser-side only.
 *
 * The export passphrase is operator-supplied and independent of the vault
 * passphrase, so a bundle can be decrypted in a fresh browser without transferring
 * the vault key. Nothing is written to the vault until Import is clicked.
 */
export function SnippetIOButtons({ store, snippets, onImported }: SnippetIOButtonsProps) {
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [mode, setMode] = useState<ImportConflictMode>('skip');
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customCount = snippets.filter((snippet) => !snippet.isBuiltin && !isBuiltinSnippetId(snippet.id)).length;

  const handleExport = async () => {
    if (busy) return;
    setBusy('export');
    setNotice(null);
    setError(null);
    try {
      const json = await exportSnippets(snippets, exportPassphrase);
      downloadJson(json, `${SNIPPET_EXPORT_FILE_PREFIX}-${todayStamp()}.json`);
      setExportPassphrase('');
      setNotice('Encrypted bundle downloaded. Keep the export passphrase — the bundle cannot be read without it.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy('import');
    setNotice(null);
    setError(null);
    try {
      const incoming = await importSnippets(await file.text(), importPassphrase);
      const current = (await store.listSnippets()).filter(
        (snippet) => !snippet.isBuiltin && !isBuiltinSnippetId(snippet.id)
      );
      const resolved = resolveImportConflicts(current, incoming, mode);
      const currentIds = new Set(current.map((snippet) => snippet.id));
      const resolvedIds = new Set(resolved.map((snippet) => snippet.id));
      const added = resolved.filter((snippet) => !currentIds.has(snippet.id));
      const removed = current.filter((snippet) => !resolvedIds.has(snippet.id));
      for (const snippet of added) {
        await store.saveSnippet(snippet);
      }
      for (const snippet of removed) {
        await store.deleteSnippet(snippet.id);
      }
      await onImported();
      setImportPassphrase('');
      setNotice(
        `Imported ${added.length} snippet${added.length === 1 ? '' : 's'}` +
          (removed.length > 0 ? `, removed ${removed.length} replaced snippet${removed.length === 1 ? '' : 's'}.` : '.') +
          ' Built-ins are untouched.',
      );
    } catch (err: unknown) {
      if (isSnippetImportError(err)) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Import failed.');
      }
    } finally {
      setBusy(null);
    }
  };

  const selectedMode = CONFLICT_MODES.find((option) => option.value === mode);

  return (
    <div className="p-4 border rounded-lg bg-white space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Encrypted import &amp; export</h3>
        <p className="text-xs text-slate-500 mt-1">
          The bundle is encrypted with the export passphrase you choose below — not your vault passphrase — so
          you can restore it in a different browser. Snippets can contain repository conventions or pasted
          credentials, so treat the downloaded file as sensitive.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800">Export</h4>
          <p className="text-xs text-slate-500">
            {customCount > 0
              ? `${customCount} custom snippet${customCount === 1 ? '' : 's'} will be written. Built-ins are not exported.`
              : 'No custom snippets to export yet — built-ins ship with the app.'}
          </p>
          <Input
            type="password"
            value={exportPassphrase}
            onChange={(event) => setExportPassphrase(event.target.value)}
            placeholder="Export passphrase..."
            className="bg-white"
          />
          <Button
            onClick={handleExport}
            disabled={busy !== null || customCount === 0 || exportPassphrase.trim().length === 0}
            size="sm"
          >
            <Download className="w-3.5 h-3.5" />
            {busy === 'export' ? 'Exporting…' : 'Export encrypted bundle'}
          </Button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800">Import</h4>
          <Input
            type="password"
            value={importPassphrase}
            onChange={(event) => setImportPassphrase(event.target.value)}
            placeholder="Export passphrase..."
            className="bg-white"
          />
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="snippet-conflict-mode">
              When a title already exists
            </label>
            <select
              id="snippet-conflict-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as ImportConflictMode)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            >
              {CONFLICT_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {selectedMode && <p className="text-xs text-slate-500">{selectedMode.hint}</p>}
          </div>
          <label className="inline-flex">
            <span className="sr-only">Snippet bundle file</span>
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy !== null || importPassphrase.trim().length === 0}
              onChange={(event) => {
                void handleImportFile(event.target.files?.[0]);
                event.target.value = '';
              }}
              className="text-xs text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700"
            />
          </label>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <Upload className="w-3 h-3" />
            {busy === 'import' ? 'Importing…' : 'Nothing is written to the vault until you choose a bundle.'}
          </p>
        </div>
      </div>

      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
