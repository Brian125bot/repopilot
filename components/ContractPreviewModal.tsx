'use client';

import * as React from 'react';
import { FileCode, Copy, Check } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

interface ContractPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractMarkdown: string;
}

export function ContractPreviewModal({ open, onOpenChange, contractMarkdown }: ContractPreviewModalProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(contractMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader onClose={() => onOpenChange(false)}>
        <DialogTitle className="flex items-center gap-2">
          <FileCode className="h-5 w-5 text-indigo-600" />
          Compiled Jules Agent Contract (Markdown)
        </DialogTitle>
        <DialogDescription>
          This is the strict anti-drift specification and embedded blueprint comment dispatched to Google Jules.
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <div className="relative">
          <pre className="p-4 bg-slate-950 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto max-h-[60vh] whitespace-pre-wrap leading-relaxed border border-slate-800">
            {contractMarkdown}
          </pre>
        </div>
      </DialogContent>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button size="sm" onClick={handleCopy} className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800">
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied Contract!' : 'Copy Contract Markdown'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
