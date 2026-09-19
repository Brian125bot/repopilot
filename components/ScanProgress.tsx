'use client';

import * as React from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { ScanProgressInfo } from '@/lib/repo-profile/scan';

interface ScanProgressProps {
  progress: ScanProgressInfo | null;
  incomplete?: boolean;
  errors?: string[];
  isScanning: boolean;
  onCancel: () => void;
}

export function ScanProgress({
  progress,
  incomplete,
  errors = [],
  isScanning,
  onCancel,
}: ScanProgressProps) {
  if (!progress && !isScanning && errors.length === 0) {
    return null;
  }

  const completed = progress?.completedSteps ?? 0;
  const total = progress?.totalSteps ?? 4;
  const percent = Math.min(100, Math.round((completed / total) * 100));

  return (
    <div className="w-full space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isScanning ? (
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          ) : incomplete ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          )}
          <h3 className="font-semibold text-slate-900 text-sm">
            {isScanning
              ? 'Scanning Repository...'
              : incomplete
              ? 'Scan Completed (Incomplete Profile)'
              : 'Scan Complete'}
          </h3>
        </div>

        {isScanning && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="text-xs border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Cancel Scan
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs font-medium text-slate-600">
          <span>{progress?.message || 'Processing...'}</span>
          <span>{percent}%</span>
        </div>
        <Progress value={percent} className="h-2" />
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive" className="py-2.5 px-3 text-xs">
          <AlertTitle className="text-xs font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Scan Notices / Errors ({errors.length})
          </AlertTitle>
          <AlertDescription className="mt-1 text-[11px] space-y-0.5">
            {errors.map((err, idx) => (
              <div key={idx} className="font-mono text-slate-700">
                • {err}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
