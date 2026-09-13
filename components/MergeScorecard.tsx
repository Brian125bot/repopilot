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
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { AuditDiffFacts, CriterionCategory, GeminiAuditReport, GitHubStatusSummary, PRMetadata, Blueprint } from '@/types';
import { applyMergeReadinessCap } from '@/lib/github';
import { compileRemediationPrompt } from '@/lib/prompt-compiler';
import {
  buildAuditGrade,
  formatScorecardSummary,
  sortCriteriaForDecision,
} from '@/lib/scoring';
import { ScoreHeader } from './scorecard/ScoreHeader';
import { WhyNextCard } from './scorecard/WhyNextCard';
import { ScopeRiskCoverageGrid } from './scorecard/ScopeRiskCoverageGrid';
import { CriteriaMatrix } from './scorecard/CriteriaMatrix';
import {
  buildFailureBrief,
  buildOutcomeRow,
  compileContinuationPrompt,
  recordOutcomeRow,
  resolveContinueSessionId,
  shouldOfferContinueSession,
} from '@/lib/outcome-memory';
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
  diffFacts?: AuditDiffFacts | null;
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
  diffFacts = null,
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

  const { criteriaResults, scopeIntegrity, mergeVerdict } = report;

  // Server single truth: render report.grade when the evaluate route attached
  // it. Recompute client-side only for old cached reports without a grade.
  const grade = React.useMemo(
    () =>
      report.grade ??
      buildAuditGrade(report, {
        criteria: blueprint?.criteria,
        diffFacts: diffFacts || report.diffFacts,
        touchedPaths: (diffFacts || report.diffFacts)?.touchedPaths,
        unauthorizedPaths: (diffFacts || report.diffFacts)?.unauthorizedPaths,
      }),
    [report, blueprint?.criteria, diffFacts]
  );

  const rankedCriteria = React.useMemo(
    () => sortCriteriaForDecision(criteriaResults || []),
    [criteriaResults]
  );

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

  // Formatted complete remediation prompt explicitly directing Jules to make changes on the audited branch.
  // When a stored brief exists, continue from it instead of rebuilding from the raw report.
  const defaultRemediationPrompt = React.useMemo(() => {
    if (blueprint?.lastBrief) {
      return compileContinuationPrompt({ blueprint, brief: blueprint.lastBrief });
    }
    return compileRemediationPrompt({
      targetBranch: auditedBranch,
      baseBranch: prMetadata?.baseBranch || 'main',
      prNumber: prMetadata?.number,
      prUrl: copyableUrl,
      report,
      fileBoundaries,
    });
  }, [blueprint, copyableUrl, auditedBranch, prMetadata, report, fileBoundaries]);

  // Follow-up messaging on an existing session (continuation turn)
  const [followUpText, setFollowUpText] = React.useState('');
  const [isSendingFollowUp, setIsSendingFollowUp] = React.useState(false);
  const [followUpResult, setFollowUpResult] = React.useState<{
    success: boolean;
    sessionId?: string;
    sessionUrl?: string | null;
    error?: string;
  } | null>(null);
  const followUpSessionId = dispatchResult?.sessionId || blueprint?.sessionId || null;

  // Continue-with-brief: primary blocked-audit action (POST /api/jules/message only).
  const [isContinuing, setIsContinuing] = React.useState(false);
  const [continueResult, setContinueResult] = React.useState<{
    success: boolean;
    sessionId?: string;
    sessionUrl?: string | null;
    error?: string;
  } | null>(null);

  // Physical merge readiness demotes (never promotes) the semantic verdict:
  // conflicts, red checks, or boundary breaches cap READY_TO_MERGE at NEEDS_REVISION.
  const mergeCap = React.useMemo(
    () =>
      applyMergeReadinessCap(
        grade.verdict,
        prMetadata?.githubStatus ?? null,
        scopeIntegrity.unauthorizedFiles.length
      ),
    [grade.verdict, prMetadata, scopeIntegrity]
  );
  const displayGrade = React.useMemo(
    () => ({
      ...grade,
      verdict: mergeCap.verdict,
      why: [...grade.why, ...mergeCap.reasons].slice(0, 4),
    }),
    [grade, mergeCap]
  );
  const githubStatus: GitHubStatusSummary | null = prMetadata?.githubStatus ?? null;

  const verdictForGate = displayGrade.verdict;
  const recentSessionId = dispatchResult?.sessionId || null;
  const canOfferContinue = Boolean(
    blueprint && shouldOfferContinueSession(verdictForGate, blueprint, recentSessionId)
  );
  const continueSessionId = blueprint
    ? resolveContinueSessionId(blueprint, recentSessionId)
    : null;
  const continueFailed = Boolean(continueResult && !continueResult.success);
  // Blocked audit without any session to continue: the only Jules action is a
  // fresh brief-backed session (same continuation prompt via existing dispatch).
  const showNewSessionStandalone = Boolean(
    blueprint && verdictForGate !== 'READY_TO_MERGE' && !canOfferContinue
  );

  const continueBrief = React.useMemo(() => {
    if (!blueprint) return null;
    if (blueprint.lastBrief) return blueprint.lastBrief;
    return buildFailureBrief(report, blueprint, report.scopeIntegrity?.unauthorizedFiles || []);
  }, [blueprint, report]);

  const continuePrompt = React.useMemo(() => {
    if (!blueprint || !continueBrief) return '';
    return compileContinuationPrompt({ blueprint, brief: continueBrief });
  }, [blueprint, continueBrief]);

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

  const handleSendFollowUp = async () => {
    if (verdictForGate === 'READY_TO_MERGE') return;
    if (!followUpSessionId || !followUpText.trim()) return;
    setIsSendingFollowUp(true);
    setFollowUpResult(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (julesKey) headers['x-jules-api-key'] = julesKey;
      const res = await fetch('/api/jules/message', {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: followUpSessionId, prompt: followUpText.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Failed to send follow-up message to Jules.');
      }
      setFollowUpResult({ success: true, sessionId: data.sessionId, sessionUrl: data.sessionUrl });
      setFollowUpText('');
      if (blueprint) {
        recordOutcomeRow(
          buildOutcomeRow({
            blueprint: { ...blueprint, sessionId: data.sessionId || followUpSessionId },
            turn: 'continuation',
            usedPriorSession: true,
          })
        );
      }
    } catch (err) {
      // Fail-closed fallback: show the brief, do not auto-dispatch anything.
      setFollowUpResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown follow-up error.',
      });
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  const handleContinueJulesSession = async () => {
    if (verdictForGate === 'READY_TO_MERGE') return;
    if (!blueprint || !continueSessionId || !continuePrompt) return;
    setIsContinuing(true);
    setContinueResult(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (julesKey) headers['x-jules-api-key'] = julesKey;
      const res = await fetch('/api/jules/message', {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: continueSessionId, prompt: continuePrompt }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Failed to continue Jules session.');
      }
      setContinueResult({ success: true, sessionId: data.sessionId, sessionUrl: data.sessionUrl });
      recordOutcomeRow(
        buildOutcomeRow({
          blueprint: { ...blueprint, sessionId: data.sessionId || continueSessionId },
          turn: 'continuation',
          usedPriorSession: true,
        })
      );
    } catch (err) {
      // Fail-closed: show error only. Never auto-create a session here.
      setContinueResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error continuing Jules session.',
      });
    } finally {
      setIsContinuing(false);
    }
  };

  const handleDispatchRemediationToJules = async (promptOverride?: string) => {
    if (verdictForGate === 'READY_TO_MERGE') return;
    setIsDispatching(true);
    setDispatchResult(null);

    try {
      const promptToSend =
        (promptOverride !== undefined ? promptOverride : customPromptText).trim() ||
        defaultRemediationPrompt;

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
            category: c.category || 'functional',
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

      // Outcome log: a brief-backed remediation opens a new session from memory.
      if (blueprint && data.sessionId) {
        recordOutcomeRow(
          buildOutcomeRow({
            blueprint: { ...blueprint, sessionId: data.sessionId },
            turn: 'new-from-brief',
            usedPriorSession: true,
          })
        );
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

  const handleNewSessionWithBrief = async () => {
    if (verdictForGate === 'READY_TO_MERGE') return;
    if (!continuePrompt) return;
    await handleDispatchRemediationToJules(continuePrompt);
  };

  const getVerdictStyle = (status: string): {
    badge: 'success' | 'warning' | 'destructive';
    label: string;
    icon: typeof CheckCircle2;
    bg: string;
    textColor: string;
    ringColor: string;
    progressColor: string;
  } => {
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

  const verdictStyle = getVerdictStyle(displayGrade.verdict);

  const handleCopyScorecardSummary = () => {
    navigator.clipboard.writeText(formatScorecardSummary(displayGrade, report));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const categoryBadgeClass = (category?: CriterionCategory) =>
    category === 'security'
      ? 'bg-red-50 text-red-800 border-red-200'
      : category === 'testing'
        ? 'bg-sky-50 text-sky-800 border-sky-200'
        : category === 'constraint'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-slate-50 text-slate-700 border-slate-200';

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <ScoreHeader
        report={report}
        prMetadata={prMetadata}
        blueprint={blueprint}
        hydrationSource={hydrationSource}
        grade={displayGrade}
        auditedBranch={auditedBranch}
        verdictStyle={verdictStyle}
        copiedSummary={copiedSummary}
        onCopySummary={handleCopyScorecardSummary}
      />
      <WhyNextCard grade={displayGrade} auditedBranch={auditedBranch} />

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

      <ScopeRiskCoverageGrid
        report={report}
        grade={grade}
        categoryBadgeClass={categoryBadgeClass}
      />

      {/* GitHub Checks & Branch Health (physical merge readiness, separate from semantic grade) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <GitPullRequest className="h-4 w-4 text-slate-500" />
            GitHub Checks & Branch Health
          </span>
          {!githubStatus ? (
            <Badge variant="secondary" className="text-[10px]">
              Unavailable
            </Badge>
          ) : githubStatus.checksState === 'FAILURE' ||
            githubStatus.mergeable === false ||
            githubStatus.mergeableState === 'dirty' ? (
            <Badge variant="destructive" className="text-[10px] font-bold">
              NOT MERGEABLE
            </Badge>
          ) : githubStatus.checksState === 'PENDING' || githubStatus.mergeable === null ? (
            <Badge variant="warning" className="text-[10px] font-bold">
              PENDING
            </Badge>
          ) : (
            <Badge variant="success" className="text-[10px] font-bold">
              MERGEABLE
            </Badge>
          )}
        </div>
        {!githubStatus ? (
          <p className="text-[11px] text-slate-500">
            Branch health unavailable for manual diffs — ingest a GitHub PR to check CI status and conflicts.
          </p>
        ) : (
          <div className="space-y-1.5 text-xs text-slate-700">
            <p className="leading-relaxed">
              Checks:{' '}
              <strong>
                {githubStatus.checksState === 'SUCCESS'
                  ? 'passing'
                  : githubStatus.checksState === 'FAILURE'
                    ? 'failing'
                    : 'pending'}
              </strong>
              {' · '}Mergeable state:{' '}
              <span className="font-mono text-[11px]">{githubStatus.mergeableState}</span>
            </p>
            {githubStatus.failedChecks.length > 0 && (
              <ul className="list-disc list-inside space-y-0.5">
                {githubStatus.failedChecks.map((check) => {
                  const detailsUrl = (githubStatus.checkRunUrls || []).find((r) => r.name === check)?.detailsUrl;
                  return (
                    <li key={check} className="text-red-700">
                      {detailsUrl ? (
                        <a
                          href={detailsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 hover:text-red-900"
                        >
                          {check}
                          <ExternalLink className="ml-1 inline h-3 w-3" />
                        </a>
                      ) : (
                        check
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {mergeCap.reasons.length > 0 && (
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Capping semantic verdict at NEEDS_REVISION: {mergeCap.reasons.join('; ')}.
              </p>
            )}
          </div>
        )}
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

      <CriteriaMatrix
        rankedCriteria={rankedCriteria}
        grade={grade}
        categoryBadgeClass={categoryBadgeClass}
      />

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

              {verdictForGate !== 'READY_TO_MERGE' && (
              <Button
                size="sm"
                onClick={() => handleDispatchRemediationToJules()}
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
              )}
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

                {verdictForGate === 'READY_TO_MERGE' ? null : canOfferContinue ? (
                  <>
                    <Button
                      onClick={handleContinueJulesSession}
                      disabled={isContinuing || !continueSessionId || !continuePrompt}
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs h-9 px-5 gap-2 shadow-md transition-all active:scale-95"
                    >
                      {isContinuing ? (
                        <>
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                          <span>Continuing Jules session...</span>
                        </>
                      ) : (
                        <>
                          <Send className="h-3.5 w-3.5 fill-current" />
                          <span>Continue Jules session</span>
                        </>
                      )}
                    </Button>
                    {(continueFailed || showNewSessionStandalone) && (
                      <Button
                        onClick={handleNewSessionWithBrief}
                        disabled={isDispatching || !continuePrompt}
                        className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs h-9 px-4 gap-2 border border-white/20 transition-all"
                      >
                        {isDispatching ? (
                          <>
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span>Creating new session...</span>
                          </>
                        ) : (
                          <>
                            <Send className="h-3.5 w-3.5" />
                            <span>New session with brief</span>
                          </>
                        )}
                      </Button>
                    )}
                  </>
                ) : showNewSessionStandalone ? (
                  <Button
                    onClick={handleNewSessionWithBrief}
                    disabled={isDispatching || !continuePrompt}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs h-9 px-5 gap-2 shadow-md transition-all active:scale-95"
                  >
                    {isDispatching ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                        <span>Creating new session...</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5 fill-current" />
                        <span>New session with brief</span>
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleDispatchRemediationToJules()}
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
                )}
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

            {continueResult && (
              <div
                className={`rounded-lg p-3.5 border transition-all ${
                  continueResult.success
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100'
                    : 'bg-rose-950/80 border-rose-500 text-rose-100'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    {continueResult.success ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5">
                      <span className="font-bold text-xs text-white">
                        {continueResult.success
                          ? 'Continued Jules session with brief!'
                          : 'Continue failed — no new session was created.'}
                      </span>
                      {continueResult.sessionId && (
                        <span className="ml-2 text-[10px] font-mono bg-black/40 px-2 py-0.5 rounded border border-white/10 text-slate-300">
                          ID: {continueResult.sessionId}
                        </span>
                      )}
                      {!continueResult.success && continueResult.error && (
                        <p className="text-[11px] text-white/80 leading-relaxed font-mono break-all">
                          {continueResult.error}
                        </p>
                      )}
                      {continueResult.success && continueResult.sessionUrl && (
                        <a
                          href={continueResult.sessionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-[11px] underline text-emerald-200"
                        >
                          open session
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {followUpSessionId && (
              <div className="rounded-lg p-3.5 border border-slate-700 bg-slate-900/60 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-indigo-400 shrink-0" />
                  <span className="font-bold text-xs text-white">
                    Follow up on session{' '}
                    <code className="font-mono text-[11px] text-slate-300">{followUpSessionId}</code>
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={followUpText}
                  onChange={(e) => setFollowUpText(e.target.value)}
                  placeholder="Message the existing Jules session (no new session is created)…"
                  className="w-full rounded-md bg-black/40 border border-white/10 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSendFollowUp}
                    disabled={isSendingFollowUp || !followUpText.trim()}
                    className="h-8 text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {isSendingFollowUp ? 'Sending…' : 'Send follow-up'}
                  </Button>
                  {followUpResult?.success && (
                    <span className="text-[11px] text-emerald-300">
                      Delivered{ followUpResult.sessionUrl ? ' — ' : '' }
                      {followUpResult.sessionUrl && (
                        <a href={followUpResult.sessionUrl} target="_blank" rel="noreferrer" className="underline">
                          open session
                        </a>
                      )}
                    </span>
                  )}
                </div>
                {followUpResult && !followUpResult.success && (
                  <div className="rounded-md border border-rose-500/40 bg-rose-950/50 p-2.5 text-[11px] text-rose-100 leading-relaxed">
                    <p className="font-mono break-all">{followUpResult.error}</p>
                    {blueprint?.lastBrief && (
                      <p className="pt-1.5 text-rose-200/90">
                        No automatic retry was sent. Brief holds {blueprint.lastBrief.requiredFixes.length} open fix
                        {blueprint.lastBrief.requiredFixes.length === 1 ? '' : 'es'} at score {blueprint.lastBrief.score}
                        {blueprint.lastBrief.unauthorizedPaths.length > 0 &&
                          ` (${blueprint.lastBrief.unauthorizedPaths.length} path(s) to revert)`}
                        {' '}— dispatch a fresh remediation above instead.
                      </p>
                    )}
                  </div>
                )}
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
