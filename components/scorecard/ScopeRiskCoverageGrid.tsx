'use client';

import * as React from 'react';
import { FileCode2, Flame, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import type { AuditGrade, CriterionCategory, GeminiAuditReport } from '@/types';

interface ScopeRiskCoverageGridProps {
  report: GeminiAuditReport;
  grade: AuditGrade;
  categoryBadgeClass: (category?: CriterionCategory) => string;
}

const COVERAGE_ORDER: CriterionCategory[] = ['functional', 'testing', 'security', 'constraint'];

export function ScopeRiskCoverageGrid({
  report,
  grade,
  categoryBadgeClass,
}: ScopeRiskCoverageGridProps) {
  const scopeIntegrity = report.scopeIntegrity;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            {scopeIntegrity.strictlyInScope ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-red-600" />
            )}
            Scope Integrity
          </span>
          <Badge
            variant={scopeIntegrity.strictlyInScope ? 'success' : 'destructive'}
            className="text-[10px]"
          >
            {scopeIntegrity.strictlyInScope
              ? 'In scope'
              : `${scopeIntegrity.unauthorizedFiles.length} unauthorized`}
          </Badge>
        </div>
        <p className="text-xs text-slate-700 leading-relaxed">{scopeIntegrity.explanation}</p>
        {grade.scopePenalty > 0 && (
          <p className="text-[11px] font-mono text-red-700">Score impact −{grade.scopePenalty}</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-amber-500" />
            Change risk
          </span>
          <Badge
            variant={
              grade.blast.rating === 'LOW'
                ? 'success'
                : grade.blast.rating === 'MEDIUM'
                  ? 'warning'
                  : 'destructive'
            }
            className="text-[10px] font-bold"
          >
            {grade.blast.rating} RISK
            {grade.blast.grounded ? '' : ' · model'}
          </Badge>
        </div>
        {grade.diffFacts ? (
          <p className="text-xs font-mono text-slate-800">
            {grade.diffFacts.filesTouched} files · +{grade.diffFacts.linesAdded}/−
            {grade.diffFacts.linesRemoved}
            {grade.diffFacts.truncated ? ' · truncated' : ''}
          </p>
        ) : (
          <p className="text-[11px] text-slate-500">
            Line/file stats unavailable — rating from model prose.
          </p>
        )}
        <p className="text-xs text-slate-700 leading-relaxed">{grade.blast.explanation}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <FileCode2 className="h-4 w-4 text-indigo-500" />
            Contract coverage
          </span>
        </div>
        <ul className="space-y-1">
          {COVERAGE_ORDER.map((key) => {
            const bucket = grade.categoryRollup[key];
            return (
              <li key={key} className="flex items-center justify-between gap-2 text-[11px]">
                <span
                  className={`capitalize rounded border px-1.5 py-0.5 ${categoryBadgeClass(key)}`}
                >
                  {key}
                </span>
                <span className="font-mono text-slate-700">
                  {bucket.met}/{bucket.total}
                  {bucket.partial ? ` · ${bucket.partial} partial` : ''}
                  {bucket.unmet ? ` · ${bucket.unmet} unmet` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
