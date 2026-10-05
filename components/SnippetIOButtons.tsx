'use client';

import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SNIPPET_EXPORT_FILE_PREFIX,
  SNIPPET_IMPORT_MAX_FILE_BYTES,
  exportSnippets,
  importSnippets,
  isImportFileSizeAllowed,
  isSnippetImportError,
  planImportWrites,
  resolveImportConflicts,
  type ImportConflictMode,
  type ImportWritePlan,
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
 * passphrase, so a bundle can be decrypted in a fresh browser without
 * transferring the vault. Picking a file only stages it: nothing is read,
 * decrypted or written until the operator clicks Import, and a replace that
 * would delete stored snippets asks once more before it writes.
 */
export function SnippetIOButtons({ store, snippets, onImported }: SnippetIOButtonsProps) {
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [mode, setMode] = useState<ImportConflictMode>('skip');
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPlan, setPendingPlan] = useState<ImportWritePlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customCount = snippets.filter((snippet) => !snippet.isBuiltin && !isBuiltinSnippetId(snippet.id)).length;

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  const handleFilePicked = (file: File | undefined) => {
    setPendingPlan(null);
    setNotice(null);
    setError(null);
    if (!file) {
      setPendingFile(null);
      return;
    }
    // Size is checked here, before the file is ever read into memory.
    if (!isImportFileSizeAllowed(file.size)) {
      setPendingFile(null);
      setError(
        `That file is ${formatBytes(file.size)}. A snippet bundle must be ${formatBytes(SNIPPET_IMPORT_MAX_FILE_BYTES)} or smaller.`,
      );
      return;
    }
    setPendingFile(file);
  };

  const applyPlan = async (plan: ImportWritePlan) => {
    for (const snippet of plan.upserts) {
      await store.saveSnippet(snippet);
    }
    for (const id of plan.deletions) {
      await store.deleteSnippet(id);
    }
    await onImported();
    setImportPassphrase('');
    setPendingFile(null);
    setPendingPlan(null);
    if (plan.upserts.length === 0 && plan.deletions.length === 0) {
      setNotice('Nothing to import — every snippet in the bundle is already in the library.');
      return;
    }
    setNotice(
      `Import complete: ${plan.upserts.length} snippet${plan.upserts.length === 1 ? '' : 's'} added or updated` +
        (plan.deletions.length > 0
          ? `, ${plan.deletions.length} replaced snippet${plan.deletions.length === 1 ? '' : 's'} removed.`
          : '.') +
        ' Built-ins are untouched.',
    );
  };

  const handleImportClick = async () => {
    if (busy || !pendingFile) return;
    if (!isImportFileSizeAllowed(pendingFile.size)) {
      setError(`That file is ${formatBytes(pendingFile.size)}. A snippet bundle must be ${formatBytes(SNIPPET_IMPORT_MAX_FILE_BYTES)} or smaller.`);
      setPendingFile(null);
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const incoming = await importSnippets(await pendingFile.text(), importPassphrase);
      const current = (await store.listSnippets()).filter(
        (snippet) => !snippet.isBuiltin && !isBuiltinSnippetId(snippet.id)
      );
      const resolved = resolveImportConflicts(current, incoming, mode);
      const plan = planImportWrites(current, resolved);
      // A replace that would delete stored snippets gets one explicit
      // confirmation before anything is written.
      if (plan.deletions.length > 0) {
        setPendingPlan(plan);
        return;
      }
      await applyPlan(plan);
    } catch (err: unknown) {
      if (isSnippetImportError(err)) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Import failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedMode = CONFLICT_MODES.find((option) => option.value === mode);
  const importReady = pendingFile !== null && importPassphrase.trim().length > 0 && !busy;

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
            disabled={busy || customCount === 0 || exportPassphrase.trim().length === 0}
            size="sm"
          >
            <Download className="w-3.5 h-3.5" />
            {busy ? 'Exporting…' : 'Export encrypted bundle'}
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
              disabled={busy}
              onChange={(event) => {
                handleFilePicked(event.target.files?.[0]);
                event.target.value = '';
              }}
              className="text-xs text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700"
            />
          </label>
          {pendingFile && (
            <p className="text-xs text-slate-600">
              Staged: {pendingFile.name} ({formatBytes(pendingFile.size)})
            </p>
          )}
          <Button onClick={handleImportClick} disabled={!importReady} size="sm">
            <Upload className="w-3.5 h-3.5" />
            {busy ? 'Importing…' : 'Import bundle'}
          </Button>
          <p className="text-xs text-slate-500">
            Nothing is read, decrypted or written to the vault until you click Import.
          </p>
        </div>
      </div>

      {pendingPlan && (
        <div className="p-3 rounded border border-amber-200 bg-amber-50 space-y-2">
          <p className="text-sm text-amber-900">
            This import will <strong>replace {pendingPlan.deletions.length}</strong> stored
            snippet{pendingPlan.deletions.length === 1 ? '' : 's'}
            {pendingPlan.upserts.length > 0 &&
              ` and add or update ${pendingPlan.upserts.length} more`}
            . Replaced snippets are deleted from the vault.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void applyPlan(pendingPlan)}>
              Confirm import
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingPlan(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
