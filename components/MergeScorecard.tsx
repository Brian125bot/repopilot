'use client';

import * as React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  AlertTriangle,
  Copy,
  Check,
  GitPullRequest,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Flame,
  FileCode2,
  GitCommit,
  ArrowUpRight,
  Code,
  Terminal,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { GeminiAuditReport, PRMetadata } from '@/types';

interface MergeScorecardProps {
  report: GeminiAuditReport;
  prMetadata?: PRMetadata | null;
  onViewDiff?: () => void;
}

export function MergeScorecard({ report, prMetadata, onViewDiff }: MergeScorecardProps) {
  const [copiedPrompt, setCopiedPrompt] = React.useState(false);
  const [copiedSummary, setCopiedSummary] = React.useState(false);

  const { criteriaResults, scopeIntegrity, blastRadius, mergeVerdict } = report;

  const getVerdictStyle = (status: string) => {
    switch (status) {
      case 'READY_TO_MERGE':
        return {
          badge: 'success',
          label: 'READY TO MERGE',
          icon: CheckCircle2,
          bg: 'bg-emerald-50 border-emerald-200 text-emerald-950',
          textColor: 'text-emerald-700',
          ringColor: 'text-emerald-600',
          progressColor: 'bg-emerald-500',
        };
      case 'NEEDS_REVISION':
        return {
          badge: 'warning',
          label: 'NEEDS REVISION',
          icon: AlertTriangle,
          bg: 'bg-amber-50 border-amber-200 text-amber-950',
          textColor: 'text-amber-700',
          ringColor: 'text-amber-600',
          progressColor: 'bg-amber-500',
        };
      case 'BLOCKED':
      default:
        return {
          badge: 'destructive',
          label: 'MERGE BLOCKED',
          icon: XCircle,
          bg: 'bg-red-50 border-red-200 text-red-950',
          textColor: 'text-red-700',
          ringColor: 'text-red-600',
          progressColor: 'bg-red-500',
        };
    }
  };

  const verdictStyle = getVerdictStyle(mergeVerdict.status);
  const VerdictIcon = verdictStyle.icon;

  const handleCopyRemediationPrompt = () => {
    const formattedPrompt = `### RepoPilot Automated Audit Remediation Feedback
**Verdict:** ${mergeVerdict.status} (Score: ${mergeVerdict.overallScore}/100)

#### Key Blockers Identified:
${mergeVerdict.keyBlockers.map((b) => `- ${b}`).join('\n')}

#### Unmet / Partially Met Criteria:
${criteriaResults
  .filter((c) => c.status !== 'MET')
  .map((c) => `- [${c.status}] Criterion ${c.id}: ${c.criterion}\n  Evidence: ${c.evidence}`)
  .join('\n')}

#### Required Actionable Changes for Agent:
${mergeVerdict.actionableFeedbackForAgent}

Please address the exact issues above and update the pull request. Strictly respect declared file boundaries.`;

    navigator.clipboard.writeText(formattedPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleCopyScorecardSummary = () => {
    const summary = `RepoPilot Scorecard: ${mergeVerdict.status} (${mergeVerdict.overallScore}/100)
Criteria Met: ${criteriaResults.filter((c) => c.status === 'MET').length}/${criteriaResults.length}
Scope Integrity: ${scopeIntegrity.strictlyInScope ? 'In Scope' : 'Violated'}
Blast Radius: ${blastRadius.rating} (${blastRadius.explanation})`;
    navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* 1. High Visibility Scorecard Header */}
      <Card className={`border overflow-hidden shadow-sm ${verdictStyle.bg}`}>
        <div className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            {/* Left: PR Context & Verdict */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={verdictStyle.badge as any}
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
                  Author: <strong className="text-slate-900">@{prMetadata?.author || report.prAuthor || 'jules-agent'}</strong>
                </span>
                <span>•</span>
                <span>
                  Evaluated:{' '}
                  <strong className="text-slate-900">
                    {new Date(report.evaluatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
            </div>

            {/* Right: Radial / Circular Score Gauge */}
            <div className="flex items-center gap-5 bg-white/90 rounded-2xl p-4 border border-slate-200/80 shadow-xs shrink-0 self-start md:self-auto">
              <div className="relative flex items-center justify-center">
                <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-slate-100"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className={verdictStyle.textColor}
                    strokeDasharray={`${mergeVerdict.overallScore}, 100`}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-slate-900 tracking-tight leading-none">
                    {mergeVerdict.overallScore}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">/ 100</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">Merge Readiness Score</div>
                <div className="text-[11px] text-slate-500">
                  {mergeVerdict.overallScore >= 90
                    ? 'Exemplary compliance'
                    : mergeVerdict.overallScore >= 60
                    ? 'Requires minor corrections'
                    : 'Critical violations detected'}
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyScorecardSummary}
                    className="h-6 px-2 text-[11px] text-slate-600 hover:bg-slate-100"
                  >
                    {copiedSummary ? <Check className="h-3 w-3 text-emerald-600 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                    {copiedSummary ? 'Copied' : 'Share Score'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Linear progress bar baseline */}
        <div className="h-1.5 w-full bg-slate-200/50">
          <div
            className={`h-full ${verdictStyle.progressColor} transition-all duration-700`}
            style={{ width: `${mergeVerdict.overallScore}%` }}
          />
        </div>
      </Card>

      {/* Scope Drift Warning Callout */}
      {!scopeIntegrity.strictlyInScope && (
        <Alert variant="destructive" className="border-red-300 bg-red-50 text-red-950">
          <ShieldAlert className="h-5 w-5 text-red-600" />
          <AlertTitle className="text-sm font-bold text-red-900 flex items-center gap-2">
            Scope Drift Violation Detected ({scopeIntegrity.unauthorizedFiles.length} Unauthorized Files)
          </AlertTitle>
          <AlertDescription className="text-xs text-red-800 space-y-2">
            <p>{scopeIntegrity.explanation}</p>
            <div className="bg-white/80 p-2.5 rounded-lg border border-red-200 font-mono text-xs">
              <span className="font-semibold text-red-900 block mb-1">Unauthorized Touched Files:</span>
              <ul className="list-disc list-inside space-y-0.5">
                {scopeIntegrity.unauthorizedFiles.map((f) => (
                  <li key={f} className="text-red-700">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Blast Radius & Scope Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Scope Integrity Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              {scopeIntegrity.strictlyInScope ? (
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-red-600" />
              )}
              Scope Integrity
            </span>
            <Badge variant={scopeIntegrity.strictlyInScope ? 'success' : 'destructive'} className="text-[10px]">
              {scopeIntegrity.strictlyInScope ? 'Zero Boundary Violations' : 'Anti-Drift Tripped'}
            </Badge>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{scopeIntegrity.explanation}</p>
        </div>

        {/* Blast Radius Risk Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-amber-500" />
              Blast Radius Rating
            </span>
            <Badge
              variant={
                blastRadius.rating === 'LOW'
                  ? 'success'
                  : blastRadius.rating === 'MEDIUM'
                  ? 'warning'
                  : 'destructive'
              }
              className="text-[10px] font-bold"
            >
              {blastRadius.rating} RISK
            </Badge>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{blastRadius.explanation}</p>
        </div>
      </div>

      {/* Key Blockers Callout if any */}
      {mergeVerdict.keyBlockers.length > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader className="py-4 px-6 border-b border-red-100">
            <CardTitle className="text-sm font-bold text-red-900 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              Key Blockers to Resolution ({mergeVerdict.keyBlockers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <ul className="space-y-1.5">
              {mergeVerdict.keyBlockers.map((blocker, i) => (
                <li key={i} className="text-xs text-red-800 flex items-start gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 2. Acceptance Criteria Validation Table */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 py-4 px-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900">
                Criteria Validation Matrix
              </CardTitle>
              <CardDescription className="text-xs">
                Audited against unified code diff using Gemini structured evaluation.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                <strong className="text-emerald-700">
                  {criteriaResults.filter((c) => c.status === 'MET').length}
                </strong>{' '}
                of {criteriaResults.length} Met
              </span>
            </div>
          </div>
        </CardHeader>

        <div className="divide-y divide-slate-100">
          {criteriaResults.map((result, idx) => {
            const statusConfig = {
              MET: {
                badge: 'success',
                label: 'MET',
                icon: CheckCircle2,
                rowBg: 'hover:bg-emerald-50/20',
              },
              PARTIALLY_MET: {
                badge: 'warning',
                label: 'PARTIAL',
                icon: AlertTriangle,
                rowBg: 'hover:bg-amber-50/20',
              },
              UNMET: {
                badge: 'destructive',
                label: 'UNMET',
                icon: XCircle,
                rowBg: 'hover:bg-red-50/20',
              },
            }[result.status] || {
              badge: 'secondary',
              label: result.status,
              icon: AlertCircle,
              rowBg: '',
            };

            const StatusIcon = statusConfig.icon;

            return (
              <div key={result.id || idx} className={`p-4 sm:p-5 transition-colors ${statusConfig.rowBg}`}>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  {/* Left Column: ID, Criterion, Evidence */}
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-700 font-mono">
                        {idx + 1}
                      </span>
                      <p className="text-xs font-semibold text-slate-900">{result.criterion}</p>
                    </div>

                    {/* Evidence Quote */}
                    <div className="pl-7">
                      <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/80 text-xs text-slate-700 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Audit Evidence & Rationale:
                        </span>
                        <p className="leading-relaxed">{result.evidence}</p>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Status Badge & Line References */}
                  <div className="sm:text-right shrink-0 pl-7 sm:pl-0 space-y-2">
                    <Badge
                      variant={statusConfig.badge as any}
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
                          {result.lineReferences.map((ref, rIdx) => (
                            <span
                              key={rIdx}
                              className="font-mono text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded"
                            >
                              {ref}
                            </span>
                          ))}
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

      {/* 3. Actionable Agent Remediation Prompt Section */}
      <Card className="border-indigo-200 bg-indigo-50/20 shadow-sm">
        <CardHeader className="py-4 px-6 border-b border-indigo-100/80">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-indigo-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Actionable Agent Remediation Prompt
              </CardTitle>
            </div>
            <Button
              size="sm"
              onClick={handleCopyRemediationPrompt}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 gap-1.5 shadow-xs"
            >
              {copiedPrompt ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedPrompt ? 'Copied to Clipboard!' : 'Copy Remediation Prompt'}
            </Button>
          </div>
          <CardDescription className="text-xs text-slate-600">
            Pre-baked follow-up instruction ready to paste directly into GitHub PR review comments or the Jules agent interface.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6">
          <div className="relative">
            <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono whitespace-pre-wrap leading-relaxed border border-slate-800 max-h-60 overflow-y-auto">
              {mergeVerdict.actionableFeedbackForAgent}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
