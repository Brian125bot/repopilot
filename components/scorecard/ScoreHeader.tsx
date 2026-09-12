'use client';

import * as React from 'react';
import { Check, Copy, Database, ExternalLink, GitPullRequest } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import type { AuditGrade, Blueprint, GeminiAuditReport, PRMetadata } from '@/types';
import { nextDecisionSentence } from '@/lib/scoring';

export interface VerdictStyle {
  badge: 'success' | 'warning' | 'destructive';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  bg: string;
  textColor: string;
  ringColor: string;
  progressColor: string;
}

interface ScoreHeaderProps {
  report: GeminiAuditReport;
  prMetadata?: PRMetadata | null;
  blueprint?: Blueprint | null;
  hydrationSource?: string | null;
  grade: AuditGrade;
  auditedBranch: string;
  verdictStyle: VerdictStyle;
  copiedSummary: boolean;
  onCopySummary: () => void;
}

export function ScoreHeader({
  report,
  prMetadata,
  blueprint,
  hydrationSource,
  grade,
  auditedBranch,
  verdictStyle,
  copiedSummary,
  onCopySummary,
}: ScoreHeaderProps) {
  const VerdictIcon = verdictStyle.icon as React.ComponentType<{ className?: string }>;
  const score = grade.overallScore;

  return (
    <Card className={`border overflow-hidden shadow-sm ${verdictStyle.bg}`}>
      <div className="p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={verdictStyle.badge}
                className="px-3 py-1 text-xs font-bold tracking-wide gap-1.5 uppercase shadow-xs"
              >
                <VerdictIcon className="h-4 w-4" />
                {verdictStyle.label}
              </Badge>
              {prMetadata?.number ? (
                <a
                  href={prMetadata.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-slate-700 hover:text-indigo-600 underline underline-offset-2"
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                  PR #{prMetadata.number}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>

            <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">
              {prMetadata?.title || report.prTitle || 'Pull Request Evaluation'}
            </h2>

            <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
              <span>
                Author:{' '}
                <strong className="text-slate-900">
                  @{prMetadata?.author || report.prAuthor || 'jules-agent'}
                </strong>
              </span>
              <span>•</span>
              <span>
                Evaluated:{' '}
                <strong className="text-slate-900">
                  {report.evaluatedAt
                    ? new Date(report.evaluatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Recently'}
                </strong>
              </span>
              {prMetadata?.headBranch && (
                <>
                  <span>•</span>
                  <span className="font-mono bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                    {prMetadata.baseBranch} ← {prMetadata.headBranch}
                  </span>
                </>
              )}
            </div>

            {blueprint && (
              <div className="flex items-center gap-2 text-xs bg-white/95 border border-indigo-200/90 text-slate-800 px-3 py-1.5 rounded-lg shadow-2xs font-mono flex-wrap mt-1">
                <Database className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                <span className="text-slate-500 font-sans text-xs font-medium">
                  Evaluated Contract:
                </span>
                <strong className="text-indigo-950 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 font-bold">
                  {blueprint.blueprintId}
                </strong>
                <span className="text-slate-300">•</span>
                <span className="text-indigo-700 font-sans text-[11px] font-semibold">
                  {hydrationSource === 'LOCAL_VAULT'
                    ? 'Hydrated from Vault Cache'
                    : hydrationSource === 'EMBEDDED_COMMENT'
                      ? 'Extracted from PR <!-- AUDIT_BLUEPRINT -->'
                      : hydrationSource === 'DEMO'
                        ? 'Sample Demo Specification'
                        : 'Custom / Ad-Hoc Specification'}
                </span>
                {blueprint.repo && (
                  <>
                    <span className="text-slate-300 hidden sm:inline">•</span>
                    <span className="text-slate-600 font-sans text-[11px] hidden sm:inline">
                      Target: <strong className="text-slate-800">{blueprint.repo}</strong> (
                      {blueprint.branchName})
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-5 bg-white/90 rounded-2xl p-4 border border-slate-200/80 shadow-xs shrink-0 self-start md:self-auto">
            <div className="relative flex items-center justify-center">
              <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                <path
                  className="text-slate-100"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={verdictStyle.textColor}
                  strokeDasharray={`${score}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-slate-900 tracking-tight leading-none">
                  {score}
                </span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                  / 100
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-900">Merge Readiness Score</div>
              <div className="text-[11px] text-slate-600 leading-snug max-w-[14rem]">
                {grade.why[0] || nextDecisionSentence(grade.nextDecision, auditedBranch)}
              </div>
              <div className="text-[11px] font-mono text-slate-500 pt-0.5">
                {grade.scoreParts.criteria} criteria − {grade.scoreParts.scope} scope ={' '}
                {grade.overallScore}
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCopySummary}
                  className="h-6 px-2 text-[11px] text-slate-600 hover:bg-slate-100"
                >
                  {copiedSummary ? (
                    <Check className="h-3 w-3 text-emerald-600 mr-1" />
                  ) : (
                    <Copy className="h-3 w-3 mr-1" />
                  )}
                  {copiedSummary ? 'Copied' : 'Share Score'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-4 flex flex-wrap gap-2" aria-label="Criteria counts">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
          MET {grade.met}
        </span>
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
          PARTIAL {grade.partial}
        </span>
        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
          UNMET {grade.unmet}
        </span>
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
          of {grade.total}
        </span>
      </div>

      <div className="h-1.5 w-full bg-slate-200/50">
        <div
          className={`h-full ${verdictStyle.progressColor} transition-all duration-700`}
          style={{ width: `${score}%` }}
        />
      </div>
    </Card>
  );
}
