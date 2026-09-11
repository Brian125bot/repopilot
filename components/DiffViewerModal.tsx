'use client';

import * as React from 'react';
import { FileCode, Layers, Copy, Check, Filter } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { SanitizedDiffResult } from '@/types';

interface DiffViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sanitizedResult: SanitizedDiffResult | null;
}

export function DiffViewerModal({ open, onOpenChange, sanitizedResult }: DiffViewerModalProps) {
  const [copied, setCopied] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);

  if (!sanitizedResult) return null;

  const handleCopyDiff = () => {
    navigator.clipboard.writeText(sanitizedResult.sanitizedDiff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { files, stats } = sanitizedResult;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader onClose={() => onOpenChange(false)}>
        <DialogTitle className="flex items-center gap-2">
          <FileCode className="h-5 w-5 text-indigo-600" />
          Sanitized Unified Diff Inspector
        </DialogTitle>
        <DialogDescription>
          Excluded binary files, lockfiles, and bundles stripped; {stats.linesAdded} additions (+), {stats.linesRemoved} deletions (-).
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        {/* Files summary chips */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            Touched Files ({files.length}):
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-slate-50 rounded-lg border border-slate-200">
            {files.map((f) => (
              <button
                key={f.filename}
                type="button"
                onClick={() => setSelectedFile(selectedFile === f.filename ? null : f.filename)}
                className={`text-[11px] font-mono px-2 py-1 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  f.isExcluded
                    ? 'bg-slate-100 text-slate-400 border-slate-200 line-through'
                    : !f.isAuthorized
                    ? 'bg-red-50 text-red-700 border-red-200 font-semibold'
                    : selectedFile === f.filename
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                }`}
              >
                <span>{f.filename}</span>
                <span className="text-[10px] opacity-75">
                  +{f.additions} -{f.deletions}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Diff Content */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Sanitized Unified Diff Stream:
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              {sanitizedResult.sanitizedDiffLength.toLocaleString()} characters
            </span>
          </div>
          <pre className="p-4 bg-slate-950 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto max-h-[50vh] whitespace-pre-wrap leading-relaxed border border-slate-800">
            {sanitizedResult.sanitizedDiff || '(Diff is empty)'}
          </pre>
        </div>
      </DialogContent>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button size="sm" onClick={handleCopyDiff} className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800">
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied Diff' : 'Copy Sanitized Diff'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
