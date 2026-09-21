'use client';

import * as React from 'react';
import { Button } from './ui/button';
import { Loader2, XCircle } from 'lucide-react';
import { ScanStage } from '@/lib/repo-profile/types';

interface ScanProgressProps {
  stage: ScanStage | string;
  message: string;
  onCancel: () => void;
}

const STAGE_LABELS: Record<string, { step: number; title: string }> = {
  metadata: { step: 1, title: 'Repository Metadata' },
  manifest: { step: 2, title: 'Package Manifest' },
  commits: { step: 3, title: 'Commit Guidelines' },
  config: { step: 4, title: 'Lint & Format Tooling' },
};

export function ScanProgress({ stage, message, onCancel }: ScanProgressProps) {
  const stageInfo = STAGE_LABELS[stage] || { step: 1, title: stage };

  return (
    <div className="p-4 border rounded-lg bg-slate-50 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          Scanning... (Step {stageInfo.step} of 4: {stageInfo.title})
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-red-600 hover:text-red-700 hover:bg-red-50">
          <XCircle className="w-4 h-4 mr-1" />
          Cancel Scan
        </Button>
      </div>

      <div className="text-sm text-slate-600">
        {message}
      </div>
    </div>
  );
}
