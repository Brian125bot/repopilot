'use client';

import * as React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { AuditGrade, CriterionCategory, CriterionResult } from '@/types';

interface CriteriaMatrixProps {
  rankedCriteria: CriterionResult[];
  grade: AuditGrade;
  categoryBadgeClass: (category?: CriterionCategory) => string;
}

export function CriteriaMatrix({ rankedCriteria, grade, categoryBadgeClass }: CriteriaMatrixProps) {
  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="border-b border-slate-100 bg-slate-50/50 py-4 px-6">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">
              Criteria Validation Matrix
            </CardTitle>
            <CardDescription className="text-xs">
              Decision-first order: UNMET, then PARTIAL, then MET. Categories joined from the
              Stage 1 contract.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="text-[11px] font-semibold text-emerald-700">MET {grade.met}</span>
            <span className="text-[11px] text-slate-300">·</span>
            <span className="text-[11px] font-semibold text-amber-800">
              PARTIAL {grade.partial}
            </span>
            <span className="text-[11px] text-slate-300">·</span>
            <span className="text-[11px] font-semibold text-red-700">UNMET {grade.unmet}</span>
            <span className="text-[11px] text-slate-500">of {grade.total}</span>
          </div>
        </div>
      </CardHeader>

      <div className="divide-y divide-slate-100">
        {rankedCriteria.map((result, idx) => {
          const statusConfig = {
            MET: {
              badge: 'success' as const,
              label: 'MET',
              icon: CheckCircle2,
              rowBg: 'hover:bg-emerald-50/20',
            },
            PARTIALLY_MET: {
              badge: 'warning' as const,
              label: 'PARTIAL',
              icon: AlertTriangle,
              rowBg: 'hover:bg-amber-50/20',
            },
            UNMET: {
              badge: 'destructive' as const,
              label: 'UNMET',
              icon: XCircle,
              rowBg: 'hover:bg-red-50/20',
            },
          }[result.status] || {
            badge: 'secondary' as const,
            label: result.status,
            icon: AlertCircle,
            rowBg: '',
          };

          const StatusIcon = statusConfig.icon;
          const unverified = result.unverifiedReferences || [];

          return (
            <div
              key={result.id || idx}
              className={`p-4 sm:p-5 transition-colors ${statusConfig.rowBg}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex h-5 min-w-5 px-1 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-700 font-mono">
                      {result.id || idx + 1}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide rounded border px-1.5 py-0.5 ${categoryBadgeClass(result.category)}`}
                    >
                      {result.category || 'functional'}
                    </span>
                    <p className="text-xs font-semibold text-slate-900">{result.criterion}</p>
                  </div>

                  <div className="pl-7 space-y-2">
                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/80 text-xs text-slate-700 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Audit Evidence & Rationale:
                      </span>
                      <p className="leading-relaxed">
                        {result.evidence && result.evidence.trim()
                          ? result.evidence
                          : 'No diff evidence cited'}
                      </p>
                    </div>
                    {result.satisfiedAspects && result.satisfiedAspects.trim() ? (
                      <div className="rounded-lg bg-emerald-50/70 p-2.5 border border-emerald-100 text-xs text-emerald-900 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/80 block">
                          Already in place
                        </span>
                        <p className="leading-relaxed">{result.satisfiedAspects}</p>
                      </div>
                    ) : null}
                    {result.remainingWork && result.remainingWork.trim() ? (
                      <div className="rounded-lg bg-amber-50/80 p-2.5 border border-amber-100 text-xs text-amber-950 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800/80 block">
                          Remaining
                        </span>
                        <p className="leading-relaxed">{result.remainingWork}</p>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="sm:text-right shrink-0 pl-7 sm:pl-0 space-y-2">
                  <Badge
                    variant={statusConfig.badge}
                    className="gap-1 text-[11px] font-bold uppercase tracking-wider"
                  >
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </Badge>

                  {result.lineReferences && result.lineReferences.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 font-medium block">
                        Line References:
                      </span>
                      <div className="flex flex-col sm:items-end gap-1">
                        {result.lineReferences.map((ref, rIdx) => {
                          const isUnverified = unverified.includes(ref);
                          return (
                            <span
                              key={rIdx}
                              title={isUnverified ? 'Cited, not in diff' : undefined}
                              className={
                                isUnverified
                                  ? 'font-mono text-[10px] text-amber-900 bg-amber-50 border border-amber-200 border-dashed px-1.5 py-0.5 rounded'
                                  : 'font-mono text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded'
                              }
                            >
                              {ref}
                              {isUnverified ? ' · unverified' : ''}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
