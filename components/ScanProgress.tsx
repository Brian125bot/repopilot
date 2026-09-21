'use client';

import * as React from 'react';
import { Button } from './ui/button';
import { Loader2, XCircle } from 'lucide-react';

interface ScanProgressProps {
  stage: string;
  message: string;
  onCancel: () => void;
}

export function ScanProgress({ stage, message, onCancel }: ScanProgressProps) {
  return (
    <div className="p-4 border rounded-lg bg-slate-50 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          Scanning...
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-red-600 hover:text-red-700 hover:bg-red-50">
          <XCircle className="w-4 h-4 mr-1" />
          Cancel Scan
        </Button>
      </div>

      <div className="text-xs text-slate-500 font-mono">
        Stage: <span className="text-slate-700 font-semibold">{stage}</span>
      </div>
      <div className="text-sm text-slate-600">
        {message}
      </div>
    </div>
  );
}
