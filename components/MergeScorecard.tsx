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
  Send,
  Sparkles,
  GitBranch,
  Wrench,
  Edit3,
  RotateCcw,
  FolderGit2,
  Database,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { GeminiAuditReport, PRMetadata, Blueprint } from '@/types';
import { compileRemediationPrompt } from '@/lib/prompt-compiler';
import { JulesTroubleshootModal } from './JulesTroubleshootModal';

interface MergeScorecardProps {
  report: GeminiAuditReport;
  prMetadata?: PRMetadata | null;
  repo?: string;
  fileBoundaries?: string[];
  blueprint?: Blueprint | null;
  hydrationSource?: string | null;
  julesKey?: string;
  githubPat?: string;
  onViewDiff?: () => void;
  onOpenSettings?: () => void;
  onSaveBlueprint?: (blueprint: Blueprint) => void;
}

export function MergeScorecard({
  report,
  prMetadata,
  repo,
  fileBoundaries,
  blueprint,
  hydrationSource,
  julesKey = '',
  githubPat = '',
  onViewDiff,
  onOpenSettings,
  onSaveBlueprint,
}: MergeScorecardProps) {
  const [copiedPrompt, setCopiedPrompt] = React.useState(false);
  const [copiedSummary, setCopiedSummary] = React.useState(false);
  const [copiedUrl, setCopiedUrl] = React.useState(false);

  // Remediation Dispatch State
  const [isDispatching, setIsDispatching] = React.useState(false);
  const [dispatchResult, setDispatchResult] = React.useState<{
    success: boolean;
    sessionId?: string;
    sessionUrl?: string | null;
    apiStatus?: string;
    warningMessage?: string;
    targetBranch?: string;
  } | null>(null);

  // Modal and Editor State
  const [troubleshootOpen, setTroubleshootOpen] = React.useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = React.useState(false);
  const [customPromptText, setCustomPromptText] = React.useState<string>('');

  const { criteriaResults, scopeIntegrity, blastRadius, mergeVerdict } = report;

  // Resolve target audited branch
  const auditedBranch = React.useMemo(() => {
    if (prMetadata?.headBranch && prMetadata.headBranch.trim()) {
      return prMetadata.headBranch.trim();
    }
    return 'main';
  }, [prMetadata]);

  // Resolve clean repo string
  const cleanRepo = React.useMemo(() => {
    if (repo && repo.includes('/')) {
      return repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    }
    if (prMetadata?.htmlUrl) {
      const match = prMetadata.htmlUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
      if (match && match[1]) {
        return match[1].replace(/\/pull\/.*$/, '');
      }
    }
    return 'acme-corp/api-gateway';
  }, [repo, prMetadata]);

  // Resolve canonical copyable PR URL
  const copyableUrl = React.useMemo(() => {
    if (prMetadata?.htmlUrl) return prMetadata.htmlUrl;
    if (cleanRepo && prMetadata?.number) {
      return `https://github.com/${cleanRepo}/pull/${prMetadata.number}`;
    }
    if (cleanRepo && auditedBranch) {
      return `https://github.com/${cleanRepo}/tree/${auditedBranch}`;
    }
    return 'https://github.com';
  }, [prMetadata, cleanRepo, auditedBranch]);

  // Formatted complete remediation prompt explicitly directing Jules to make changes on the audited branch
  const defaultRemediationPrompt = React.useMemo(() => {
    return compileRemediationPrompt({
      targetBranch: auditedBranch,
      baseBranch: prMetadata?.baseBranch || 'main',
      prNumber: prMetadata?.number,
      prUrl: copyableUrl,
      report,
      fileBoundaries,
    });
  }, [copyableUrl, auditedBranch, prMetadata, report, fileBoundaries]);

  // Active prompt in view or edit
  const activePrompt = isEditingPrompt ? customPromptText : customPromptText || defaultRemediationPrompt;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(copyableUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyRemediationPrompt = () => {
    navigator.clipboard.writeText(activePrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleDispatchRemediationToJules = async () => {
    setIsDispatching(true);
    setDispatchResult(null);

    try {
      const promptToSend = customPromptText.trim() || defaultRemediationPrompt;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (julesKey) headers['x-jules-api-key'] = julesKey;
      if (githubPat) headers['x-github-pat'] = githubPat;

      const res = await fetch('/api/jules/dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repo: cleanRepo,
          baseBranch: prMetadata?.baseBranch || 'main',
          branchName: auditedBranch,
          startingBranch: auditedBranch, // DIRECTS JULES JUST TO MAKE THE CHANGES ON THE AUDITED BRANCH
          isRemediation: true,
          prNumber: prMetadata?.number,
          prUrl: copyableUrl,
          customPrompt: promptToSend,
          objective: `Remediate PR #${prMetadata?.number || ''} on branch "${auditedBranch}": address audit blockers`,
          fileBoundaries: fileBoundaries || [],
          criteria: criteriaResults.map((c) => ({
            id: String(c.id),
            text: c.criterion,
            category: 'functional',
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch remediation session to Jules.');
      }

      const sessionUrl =
        data.julesApiResponse?.url ||
        (data.sessionId
          ? `https://jules.google.com/session/${data.sessionId.replace(/^sessions\//, '')}`
          : null);

      setDispatchResult({
        success: true,
        sessionId: data.sessionId,
        sessionUrl,
        apiStatus: data.apiStatus,
        warningMessage: data.warningMessage,
        targetBranch: data.targetBranch || auditedBranch,
      });

      if (onSaveBlueprint && data.blueprint) {
        onSaveBlueprint(data.blueprint);
      }
    } catch (err) {
      console.error('Remediation dispatch failed:', err);
      setDispatchResult({
        success: false,
        warningMessage: err instanceof Error ? err.message : 'Unknown error dispatching to Jules.',
        targetBranch: auditedBranch,
      });
    } finally {
      setIsDispatching(false);
    }
  };

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
                    {report.evaluatedAt
                      ? new Date(report.evaluatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
                  <span className="text-slate-500 font-sans text-xs font-medium">Evaluated Contract:</span>
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
                        Target: <strong className="text-slate-800">{blueprint.repo}</strong> ({blueprint.branchName})
                      </span>
                    </>
                  )}
                </div>
              )}
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

      {/* 3. Actionable Agent Remediation Prompt Section with Automated Jules Dispatch */}
      <Card className="border-indigo-200 bg-indigo-50/20 shadow-sm overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-indigo-100/80 bg-white">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold text-slate-900">
                  Actionable Agent Remediation Prompt & Automated Dispatch
                </CardTitle>
                <CardDescription className="text-xs text-slate-600">
                  Directs Google Jules to apply fixes directly on the audited branch without drift.
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!isEditingPrompt && !customPromptText) {
                    setCustomPromptText(defaultRemediationPrompt);
                  }
                  setIsEditingPrompt(!isEditingPrompt);
                }}
                className="text-xs h-8 gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="h-3.5 w-3.5 text-slate-500" />
                <span>{isEditingPrompt ? 'View Formatted' : 'Customize Prompt'}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyRemediationPrompt}
                className="text-xs h-8 gap-1.5 border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100"
              >
                {copiedPrompt ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedPrompt ? 'Prompt Copied!' : 'Copy Prompt'}</span>
              </Button>

              <Button
                size="sm"
                onClick={handleDispatchRemediationToJules}
                disabled={isDispatching}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 px-4 gap-2 shadow-xs transition-colors"
              >
                {isDispatching ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Dispatching...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5 fill-current" />
                    <span>Auto-Dispatch to Jules</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-5">
          {/* Section 1: Copyable URL & Audited Branch Directive */}
          <div className="rounded-xl border border-indigo-200/90 bg-white p-4 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100/70 pb-2.5">
              <div className="flex items-center gap-2">
                <GitPullRequest className="h-4 w-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  Target Pull Request & Audited Branch Directive
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="indigo" className="text-[11px] font-mono gap-1.5 py-0.5">
                  <GitBranch className="h-3 w-3 text-indigo-600" />
                  Audited Branch: <span className="font-bold text-indigo-900">{auditedBranch}</span>
                </Badge>
              </div>
            </div>

            {/* Copyable URL Input Bar */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Target Pull Request URL (Copyable Reference)
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    readOnly
                    value={copyableUrl}
                    className="w-full h-9 px-3 text-xs font-mono bg-slate-50 text-slate-800 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 select-all"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyUrl}
                    className="h-9 px-3 text-xs gap-1.5 border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 transition-colors"
                  >
                    {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-indigo-600" />}
                    <span>{copiedUrl ? 'URL Copied!' : 'Copy PR URL'}</span>
                  </Button>

                  {copyableUrl.startsWith('http') && (
                    <a
                      href={copyableUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors"
                    >
                      <span>Open PR</span>
                      <ExternalLink className="h-3 w-3 text-slate-400" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Explanatory Target Branch Callout */}
            <div className="flex items-start gap-2.5 text-xs text-slate-700 bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900 leading-tight">
                  Audited Branch Enforcement: <code className="font-mono text-indigo-800 bg-white px-1.5 py-0.5 rounded border border-indigo-200">{auditedBranch}</code>
                </p>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  The automated dispatch below passes <code className="font-mono text-slate-800">startingBranch: &quot;{auditedBranch}&quot;</code> directly into the Google Jules API. Jules will checkout and commit remediation fixes exclusively on this audited branch so the pull request automatically updates.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Automated Dispatch Action Panel */}
          <div className="rounded-xl border border-indigo-300/80 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-4 sm:p-5 text-white shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    Automated Jules Remediation Dispatch
                  </h4>
                  <Badge variant="outline" className="text-[10px] text-indigo-200 border-indigo-400/40 bg-indigo-900/60 font-mono">
                    Branch: {auditedBranch}
                  </Badge>
                </div>
                <p className="text-xs text-indigo-200/90 leading-relaxed">
                  Triggers an autonomous Google Jules agent session to resolve the {criteriaResults.filter(c => c.status !== 'MET').length} unmet criteria and {mergeVerdict.keyBlockers.length} blockers on repository <span className="font-mono font-bold text-white">{cleanRepo}</span>.
                </p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTroubleshootOpen(true)}
                  className="h-9 px-3 text-xs gap-1.5 border-indigo-400/40 bg-white/10 text-white hover:bg-white/20"
                >
                  <Wrench className="h-3.5 w-3.5 text-indigo-300" />
                  <span>Troubleshoot Jules</span>
                </Button>

                <Button
                  onClick={handleDispatchRemediationToJules}
                  disabled={isDispatching}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs h-9 px-5 gap-2 shadow-md transition-all active:scale-95"
                >
                  {isDispatching ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                      <span>Creating Jules Session on {auditedBranch}...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5 fill-current" />
                      <span>Auto-Dispatch Remediation to Jules</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Dispatched Live Status Feedback Notification */}
            {dispatchResult && (
              <div
                className={`rounded-lg p-3.5 border transition-all ${
                  dispatchResult.apiStatus === 'DISPATCHED_TO_JULES'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100'
                    : 'bg-amber-950/80 border-amber-500 text-amber-100'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    {dispatchResult.apiStatus === 'DISPATCHED_TO_JULES' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs text-white">
                          {dispatchResult.apiStatus === 'DISPATCHED_TO_JULES'
                            ? 'Remediation Session Dispatched to Google Jules Cloud!'
                            : 'Remediation Contract Saved to Vault (Cloud Fallback)'}
                        </span>
                        {dispatchResult.sessionId && (
                          <span className="text-[10px] font-mono bg-black/40 px-2 py-0.5 rounded border border-white/10 text-slate-300">
                            ID: {dispatchResult.sessionId}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/80 leading-relaxed">
                        {dispatchResult.apiStatus === 'DISPATCHED_TO_JULES'
                          ? `Jules autonomous agent has checked out branch "${dispatchResult.targetBranch || auditedBranch}" and is working autonomously to address the audit blockers.`
                          : dispatchResult.warningMessage || 'Jules rejected direct session dispatch. Blueprint contract is safely stored in your vault.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {dispatchResult.sessionUrl && dispatchResult.apiStatus === 'DISPATCHED_TO_JULES' && (
                      <a
                        href={dispatchResult.sessionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold rounded-md text-xs shadow transition-colors"
                      >
                        <span>Open Session in Jules Console</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {dispatchResult.apiStatus !== 'DISPATCHED_TO_JULES' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTroubleshootOpen(true)}
                        className="h-8 text-xs border-amber-400 text-white bg-amber-900/60 hover:bg-amber-800 gap-1.5"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Diagnose Jules Error
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Prompt Text Display & Customizer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {isEditingPrompt ? 'Customized Remediation Contract' : 'Compiled Remediation Contract'}
              </span>
              <div className="flex items-center gap-2">
                {isEditingPrompt && (
                  <button
                    type="button"
                    onClick={() => setCustomPromptText(defaultRemediationPrompt)}
                    className="text-[11px] text-slate-500 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset to Default
                  </button>
                )}
                <span className="text-[11px] text-slate-400 font-mono">
                  {activePrompt.length} chars
                </span>
              </div>
            </div>

            {isEditingPrompt ? (
              <textarea
                value={customPromptText}
                onChange={(e) => setCustomPromptText(e.target.value)}
                rows={12}
                className="w-full p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono leading-relaxed border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
              />
            ) : (
              <div className="relative group">
                <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono whitespace-pre-wrap leading-relaxed border border-slate-800 max-h-72 overflow-y-auto shadow-inner">
                  {activePrompt}
                </pre>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Embedded Jules Troubleshooting Modal */}
      <JulesTroubleshootModal
        open={troubleshootOpen}
        onOpenChange={setTroubleshootOpen}
        targetRepo={cleanRepo}
        onSelectRepo={() => {}}
        julesKey={julesKey}
        baseBranch={auditedBranch}
        onOpenSettings={onOpenSettings || (() => {})}
      />
    </div>
  );
}
