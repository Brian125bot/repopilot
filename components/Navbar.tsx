'use client';

import * as React from 'react';
import { Compass, Key, FolderArchive, BookOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { GitHubStatusIndicator } from './GitHubStatusIndicator';
import { deriveJobStatus, jobChromeTone, jobStatusDetail, type JobStatusLabel } from '@/lib/job-status';
import { Blueprint } from '@/types';

interface NavbarProps {
  currentStage: 'stage1' | 'stage2';
  setCurrentStage: (stage: 'stage1' | 'stage2') => void;
  onOpenSettings: () => void;
  onOpenVault: () => void;
  onOpenDocs: () => void;
  hasCredentials: boolean;
  blueprintsCount: number;
  githubPat?: string;
  activeBlueprint?: Blueprint | null;
}

export function Navbar({
  currentStage,
  setCurrentStage,
  onOpenSettings,
  onOpenVault,
  onOpenDocs,
  hasCredentials,
  blueprintsCount,
  githubPat = '',
  activeBlueprint = null,
}: NavbarProps) {
  const jobLabel: JobStatusLabel = deriveJobStatus(activeBlueprint);
  const jobDetail = jobStatusDetail(activeBlueprint);
  const chromeTone = jobChromeTone(activeBlueprint);
  const jobTone =
    chromeTone === 'positive'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : chromeTone === 'caution' || chromeTone === 'watching'
        ? 'bg-amber-50 text-amber-900 border-amber-200'
        : chromeTone === 'danger'
          ? 'bg-red-50 text-red-800 border-red-200'
          : 'bg-slate-50 text-slate-600 border-slate-200';

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-900 to-indigo-900 text-white shadow-sm ring-1 ring-slate-900/10">
            <Compass className="h-5 w-5 text-indigo-300 animate-spin-slow" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 tracking-tight text-lg">RepoPilot</span>
              <Badge variant="indigo" className="text-[10px] px-1.5 py-0 font-medium">
                1.0.0
              </Badge>
            </div>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Dispatch, wait for PR, audit, fix
            </span>
          </div>
        </div>

        {/* Center: Stage Switcher Tabs */}
        <nav className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-inner">
          <button
            type="button"
            onClick={() => setCurrentStage('stage1')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              currentStage === 'stage1'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-800">
              1
            </span>
            <span>Intake & Dispatch</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentStage('stage2')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              currentStage === 'stage2'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">
              2
            </span>
            <span>Audit & Evaluation</span>
          </button>
        </nav>

        {/* Right: Actions & Vault */}
        <div className="flex items-center gap-2">
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${jobTone}`}
            title={jobDetail}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                jobLabel === 'watching'
                  ? 'bg-amber-500 animate-pulse'
                  : chromeTone === 'danger'
                    ? 'bg-red-500'
                    : chromeTone === 'caution'
                      ? 'bg-amber-500'
                      : jobLabel === 'idle'
                        ? 'bg-slate-400'
                        : 'bg-emerald-500'
              }`}
            />
            {jobLabel}
            {jobLabel === 'last verdict' ? (
              <span className="normal-case font-mono font-medium">· {jobDetail}</span>
            ) : null}
          </span>
          {/* Real-time GitHub Connection Status Indicator */}
          <GitHubStatusIndicator githubPat={githubPat} onOpenSettings={onOpenSettings} />

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenDocs}
            className="hidden lg:flex items-center gap-1.5 text-xs border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-50 cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            <span>Docs</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenVault}
            className="hidden md:flex items-center gap-1.5 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FolderArchive className="h-3.5 w-3.5 text-slate-500" />
            <span>Vault</span>
            {blueprintsCount > 0 && (
              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-700">
                {blueprintsCount}
              </span>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 text-xs border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Key className="h-3.5 w-3.5 text-indigo-600" />
            <span className="hidden sm:inline">Credentials</span>
            <span
              className={`h-2 w-2 rounded-full ${
                hasCredentials ? 'bg-emerald-500 ring-2 ring-emerald-100' : 'bg-amber-400 ring-2 ring-amber-100'
              }`}
              title={hasCredentials ? 'Credentials Active' : 'Configure Custom Credentials'}
            />
          </Button>
        </div>
      </div>
    </header>
  );
}
