'use client';

import * as React from 'react';
import {
  Send,
  Plus,
  Trash2,
  FileCode,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  GitBranch,
  Shield,
  Layers,
  ArrowRight,
  RefreshCw,
  CheckSquare,
  Cpu,
  FolderGit2,
  ChevronDown,
  ChevronUp,
  Wrench,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { ContractPreviewModal } from './ContractPreviewModal';
import { JulesTroubleshootModal, JulesSourceSummary } from './JulesTroubleshootModal';
import { compileJulesPrompt } from '@/lib/prompt-compiler';
import { Blueprint, AcceptanceCriterion, RepoInspectionResult, GeneratedCriteriaResponse } from '@/types';

interface IntakeDispatchStageProps {
  julesKey: string;
  geminiKey: string;
  githubPat: string;
  onDispatchSuccess: (blueprint: Blueprint) => void;
  onNavigateToStage2: (blueprint?: Blueprint) => void;
  onOpenSettings: () => void;
}

export function IntakeDispatchStage({
  julesKey,
  geminiKey,
  githubPat,
  onDispatchSuccess,
  onNavigateToStage2,
  onOpenSettings,
}: IntakeDispatchStageProps) {
  // 1. Primary Inputs (Repo Target & Objective FIRST)
  const [repo, setRepo] = React.useState('acme-corp/api-gateway');
  const [objective, setObjective] = React.useState(
    'Implement an IP-based sliding window rate limiter middleware backed by Redis. Return HTTP 429 with standard RateLimit-* headers when threshold (60 req/min) is exceeded.'
  );

  // 2. Acceptance Criteria & AI Generation State
  const [criteria, setCriteria] = React.useState<AcceptanceCriterion[]>([
    { id: '1', text: 'Middleware extracts client IP correctly with support for X-Forwarded-For', category: 'functional', rationale: 'Required for reverse-proxy routing' },
    { id: '2', text: 'Sliding window algorithm enforces 60 requests per minute ceiling', category: 'functional', rationale: 'Prevents burst window exploitation' },
    { id: '3', text: 'Returns HTTP 429 Too Many Requests with RateLimit-Limit, RateLimit-Remaining, and Retry-After headers', category: 'functional', rationale: 'Standard IETF rate-limit header compliance' },
    { id: '4', text: 'Unit tests cover under-limit, burst limit, and window expiry states', category: 'testing', rationale: 'Ensures algorithmic reliability under concurrency' },
    { id: '5', text: 'Zero modifications to package.json dependencies or existing unrelated route handlers', category: 'constraint', rationale: 'Strict anti-drift boundary compliance' },
  ]);

  const [aiMode, setAiMode] = React.useState<'standard' | 'security' | 'testing' | 'strict'>('standard');
  const [autoApplyBoundaries, setAutoApplyBoundaries] = React.useState(true);
  const [isGeneratingCriteria, setIsGeneratingCriteria] = React.useState(false);
  const [aiRationaleSummary, setAiRationaleSummary] = React.useState<string | null>(null);
  const [detectedArch, setDetectedArch] = React.useState<string | null>(null);

  // 3. Scope & Branch Parameters
  const [baseBranch, setBaseBranch] = React.useState('main');
  const [branchName, setBranchName] = React.useState('jules/rate-limiter-redis');
  const [fileBoundaries, setFileBoundaries] = React.useState(
    'src/middleware/rate-limiter.ts, src/config/redis.ts, tests/rate-limiter.test.ts'
  );

  // 4. Repo State Inspection
  const [repoInspection, setRepoInspection] = React.useState<RepoInspectionResult | null>(null);
  const [isInspectingRepo, setIsInspectingRepo] = React.useState(false);
  const [showRepoDetails, setShowRepoDetails] = React.useState(false);

  // Criteria manual addition state
  const [newCriterionText, setNewCriterionText] = React.useState('');
  const [newCriterionCategory, setNewCriterionCategory] = React.useState<'functional' | 'security' | 'testing' | 'constraint'>('functional');

  // Dispatch state
  const [isDispatching, setIsDispatching] = React.useState(false);
  const [dispatchError, setDispatchError] = React.useState<string | null>(null);
  const [dryRun, setDryRun] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewMarkdown, setPreviewMarkdown] = React.useState('');

  // Confirmation state
  const [confirmedBlueprint, setConfirmedBlueprint] = React.useState<Blueprint | null>(null);
  const [confirmedSessionId, setConfirmedSessionId] = React.useState<string | null>(null);
  const [confirmedSessionUrl, setConfirmedSessionUrl] = React.useState<string | null>(null);
  const [confirmedSessionState, setConfirmedSessionState] = React.useState<string | null>(null);
  const [apiStatus, setApiStatus] = React.useState<string | null>(null);
  const [warningMessage, setWarningMessage] = React.useState<string | null>(null);
  const [copiedBlueprint, setCopiedBlueprint] = React.useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  // Server Jules configuration check and connected sources
  const [hasServerJules, setHasServerJules] = React.useState<boolean | null>(null);
  const [julesSources, setJulesSources] = React.useState<JulesSourceSummary[]>([]);
  const [julesSourcesLoading, setJulesSourcesLoading] = React.useState(false);
  const [troubleshootOpen, setTroubleshootOpen] = React.useState(false);

  React.useEffect(() => {
    let isCancelled = false;
    const headers: Record<string, string> = {};
    if (julesKey) headers['x-jules-api-key'] = julesKey;

    fetch('/api/jules/sources', { headers })
      .then((res) => res.json())
      .then((data) => {
        if (!isCancelled) {
          setHasServerJules(data.hasServerKey === true);
          if (data.valid && Array.isArray(data.sources)) {
            setJulesSources(data.sources);
          }
        }
      })
      .catch(() => {
        if (!isCancelled) setHasServerJules(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [julesKey]);

  const cleanCurrentRepo = React.useMemo(() => {
    return repo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
  }, [repo]);

  const matchedJulesSource = React.useMemo(() => {
    if (!cleanCurrentRepo) return null;
    const lower = cleanCurrentRepo.toLowerCase();
    return julesSources.find((s) => {
      const sourceId = (s.id || s.name || '').toLowerCase();
      const repoFullName = s.githubRepo
        ? `${s.githubRepo.owner}/${s.githubRepo.repo}`.toLowerCase()
        : '';
      return (
        sourceId === `github/${lower}` ||
        sourceId === `sources/github/${lower}` ||
        repoFullName === lower
      );
    });
  }, [cleanCurrentRepo, julesSources]);

  // Trigger repository inspection
  const handleInspectRepo = React.useCallback(async (targetRepo: string) => {
    if (!targetRepo || !targetRepo.includes('/')) return;
    setIsInspectingRepo(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (githubPat) headers['x-github-pat'] = githubPat;

      const res = await fetch('/api/repo/inspect', {
        method: 'POST',
        headers,
        body: JSON.stringify({ repo: targetRepo.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as RepoInspectionResult;
        setRepoInspection(data);
        if (data.defaultBranch && data.isReachable) {
          setBaseBranch(data.defaultBranch);
        }
      }
    } catch (err) {
      console.warn('Repo inspection note:', err);
    } finally {
      setIsInspectingRepo(false);
    }
  }, [githubPat]);

  // Debounced auto-inspection on repo input change
  React.useEffect(() => {
    if (!repo || !repo.includes('/') || repo.trim().length < 4) {
      return;
    }
    const timer = setTimeout(() => {
      handleInspectRepo(repo);
    }, 1000);
    return () => clearTimeout(timer);
  }, [repo, handleInspectRepo]);

  // AI Criteria Generation handler
  const handleAutoGenerateCriteria = async () => {
    setDispatchError(null);
    if (!repo || !repo.includes('/')) {
      setDispatchError('Please specify a valid repository in "owner/repo" format before generating criteria.');
      return;
    }
    if (!objective || objective.trim().length < 10) {
      setDispatchError('Please provide a descriptive task objective (at least 10 characters) so Gemini can formulate criteria.');
      return;
    }

    setIsGeneratingCriteria(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (geminiKey) headers['x-gemini-api-key'] = geminiKey;

      const res = await fetch('/api/criteria/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repo: repo.trim(),
          objective: objective.trim(),
          repoContext: repoInspection || undefined,
          mode: aiMode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate acceptance criteria via Gemini.');
      }

      const generated = data as GeneratedCriteriaResponse;

      if (generated.criteria && generated.criteria.length > 0) {
        setCriteria(generated.criteria);
      }

      if (autoApplyBoundaries) {
        if (generated.recommendedFileBoundaries?.length) {
          setFileBoundaries(generated.recommendedFileBoundaries.join(', '));
        }
        if (generated.suggestedBranchName) {
          setBranchName(generated.suggestedBranchName);
        }
      }

      setAiRationaleSummary(generated.summaryRationale || null);
      setDetectedArch(generated.detectedArchitecture || null);
    } catch (err: unknown) {
      console.error('Criteria generation error:', err);
      const message = err instanceof Error ? err.message : 'Failed to generate criteria with Gemini';
      setDispatchError(message);
    } finally {
      setIsGeneratingCriteria(false);
    }
  };

  const handleAddCriterion = () => {
    if (!newCriterionText.trim()) return;
    const nextId = String(Date.now()).slice(-4);
    setCriteria([
      ...criteria,
      {
        id: nextId,
        text: newCriterionText.trim(),
        category: newCriterionCategory,
      },
    ]);
    setNewCriterionText('');
  };

  const handleRemoveCriterion = (id: string) => {
    setCriteria(criteria.filter((c) => c.id !== id));
  };

  const handleOpenPreview = () => {
    const parsedBoundaries = fileBoundaries
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    const compiled = compileJulesPrompt(
      {
        repo: repo.trim(),
        baseBranch: baseBranch.trim(),
        branchName: branchName.trim() || 'jules/feature-branch',
        fileBoundaries: parsedBoundaries,
        objective: objective.trim(),
        criteria,
      },
      'bp_preview_contract'
    );
    setPreviewMarkdown(compiled);
    setPreviewOpen(true);
  };

  const handleDispatch = async () => {
    setDispatchError(null);
    if (!repo.includes('/')) {
      setDispatchError('Please specify repository in "owner/repo" format.');
      return;
    }
    if (!objective.trim()) {
      setDispatchError('Please provide an objective and task description.');
      return;
    }
    if (criteria.length === 0) {
      setDispatchError('Please establish at least one acceptance criterion before dispatching.');
      return;
    }

    setIsDispatching(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (julesKey) headers['x-jules-api-key'] = julesKey;
      if (githubPat) headers['x-github-pat'] = githubPat;

      const parsedBoundaries = fileBoundaries
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);

      const response = await fetch('/api/jules/dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repo: repo.trim(),
          baseBranch: baseBranch.trim(),
          branchName: branchName.trim(),
          fileBoundaries: parsedBoundaries,
          objective: objective.trim(),
          criteria,
          dryRun,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Failed to dispatch job to Jules API.');
      }

      const blueprint = data.blueprint as Blueprint;
      setConfirmedBlueprint(blueprint);
      setConfirmedSessionId(data.sessionId);
      setApiStatus(data.apiStatus);
      setWarningMessage(data.warningMessage);
      // Prefer the canonical session URL from the dispatch payload; fall back to
      // the raw Jules response, then to a constructed console URL.
      const sessionUrl =
        data.sessionUrl ||
        (blueprint as Blueprint)?.sessionUrl ||
        data.julesApiResponse?.url ||
        (data.sessionId ? `https://jules.google.com/session/${data.sessionId.replace(/^sessions\//, '')}` : null);
      setConfirmedSessionUrl(sessionUrl);
      setConfirmedSessionState(
        (blueprint as Blueprint)?.sessionState || data.sessionState || null
      );
      setRefreshError(null);

      // Save to client localStorage vault
      onDispatchSuccess(blueprint);
    } catch (err) {
      console.error('Dispatch error:', err);
      setDispatchError(err instanceof Error ? err.message : 'Unknown error during dispatch');
    } finally {
      setIsDispatching(false);
    }
  };

  const handleCopyBlueprintJson = () => {
    if (!confirmedBlueprint) return;
    navigator.clipboard.writeText(JSON.stringify(confirmedBlueprint, null, 2));
    setCopiedBlueprint(true);
    setTimeout(() => setCopiedBlueprint(false), 2000);
  };

  const handleResetForm = () => {
    setConfirmedBlueprint(null);
    setConfirmedSessionId(null);
    setConfirmedSessionUrl(null);
    setConfirmedSessionState(null);
    setApiStatus(null);
    setWarningMessage(null);
    setRefreshError(null);
  };

  const handleRefreshSession = async () => {
    if (!confirmedSessionId) return;
    setIsRefreshingSession(true);
    setRefreshError(null);
    try {
      const headers: Record<string, string> = {};
      if (julesKey) headers['x-jules-api-key'] = julesKey;
      const res = await fetch(
        `/api/jules/session?id=${encodeURIComponent(confirmedSessionId)}`,
        { headers }
      );
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Failed to refresh Jules session.');
      }
      const patched: Blueprint = {
        ...(confirmedBlueprint as Blueprint),
        sessionId: data.sessionId || confirmedSessionId,
        sessionUrl: data.sessionUrl || confirmedSessionUrl || undefined,
        sessionState: data.state || undefined,
        prUrl: data.prUrl || undefined,
        prTitle: data.prTitle || undefined,
      };
      setConfirmedBlueprint(patched);
      setConfirmedSessionId(patched.sessionId || confirmedSessionId);
      if (patched.sessionUrl) setConfirmedSessionUrl(patched.sessionUrl);
      if (patched.sessionState) setConfirmedSessionState(patched.sessionState);
      // Reuse the existing save path so page.tsx activeBlueprint stays in sync.
      onDispatchSuccess(patched);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Failed to refresh session.');
    } finally {
      setIsRefreshingSession(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Contract Preview Modal */}
      <ContractPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        contractMarkdown={previewMarkdown}
      />

      {/* Jules Troubleshooter Modal */}
      <JulesTroubleshootModal
        open={troubleshootOpen}
        onOpenChange={setTroubleshootOpen}
        targetRepo={repo}
        onSelectRepo={(selectedRepo, defaultBranch) => {
          setRepo(selectedRepo);
          if (defaultBranch) setBaseBranch(defaultBranch);
          handleInspectRepo(selectedRepo);
        }}
        julesKey={julesKey}
        baseBranch={baseBranch}
        onOpenSettings={onOpenSettings}
      />

      {/* Confirmation Screen if dispatched */}
      {confirmedBlueprint ? (
        <Card
          className={`overflow-hidden shadow-md transition-all ${
            apiStatus === 'DISPATCHED_TO_JULES'
              ? 'border-emerald-200 bg-emerald-50/30'
              : 'border-amber-200 bg-amber-50/20'
          }`}
        >
          <div
            className={`px-6 py-4 text-white flex items-center justify-between flex-wrap gap-3 ${
              apiStatus === 'DISPATCHED_TO_JULES' ? 'bg-emerald-600' : 'bg-amber-600'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {apiStatus === 'DISPATCHED_TO_JULES' ? (
                <CheckCircle2 className="h-6 w-6 text-white shrink-0" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-white shrink-0" />
              )}
              <div>
                <h3 className="font-bold text-base leading-tight">
                  {apiStatus === 'DISPATCHED_TO_JULES'
                    ? 'Stage 1 Job Dispatched to Google Jules Cloud'
                    : 'Dispatched with Local Contract Fallback (HTTP 404 / 401)'}
                </h3>
                <p className="text-white/90 text-xs">
                  {apiStatus === 'DISPATCHED_TO_JULES'
                    ? 'Autonomous agent session initialized at jules.googleapis.com. Jules is working on the target branch.'
                    : 'Google Jules API rejected direct session creation. Blueprint contract is safely recorded in your vault.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {apiStatus === 'DISPATCHED_TO_JULES' && confirmedSessionUrl && (
                <a
                  href={confirmedSessionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-800 hover:bg-emerald-50 rounded-md text-xs font-bold shadow transition-colors"
                >
                  Open Active Session in Jules Console <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {apiStatus === 'DISPATCHED_TO_JULES' && confirmedSessionId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshSession}
                  disabled={isRefreshingSession}
                  className="bg-white/10 border-white/40 text-white hover:bg-white/20 text-xs gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingSession ? 'animate-spin' : ''}`} />
                  {isRefreshingSession ? 'Refreshing…' : 'Refresh session'}
                </Button>
              )}
              {apiStatus !== 'DISPATCHED_TO_JULES' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTroubleshootOpen(true)}
                  className="bg-amber-700/80 border-amber-400 text-white hover:bg-amber-800 text-xs gap-1.5"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Troubleshoot Why Dispatch Failed
                </Button>
              )}
              <Badge
                variant="outline"
                className={`text-xs ${
                  apiStatus === 'DISPATCHED_TO_JULES'
                    ? 'bg-emerald-700/60 text-white border-emerald-400'
                    : 'bg-amber-700/60 text-white border-amber-400'
                }`}
              >
                {apiStatus === 'DISPATCHED_TO_JULES' ? 'Dispatched to Jules Cloud' : 'Stateless Contract Ready'}
              </Badge>
            </div>
          </div>

          <CardContent className="p-6 space-y-6">
            {warningMessage && (
              <Alert variant="warning" className="bg-amber-50 border-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-800 leading-relaxed">
                  {warningMessage}
                </AlertDescription>
              </Alert>
            )}
            {refreshError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{refreshError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Session ID
                </span>
                <p className="font-mono text-xs font-bold text-slate-800 break-all">
                  {confirmedSessionId}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Target Branch
                </span>
                <p className="font-mono text-xs font-bold text-indigo-700 break-all flex items-center gap-1">
                  <GitBranch className="h-3.5 w-3.5" />
                  {confirmedBlueprint.branchName}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Repository
                </span>
                <a
                  href={`https://github.com/${confirmedBlueprint.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs font-bold text-slate-800 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                >
                  {confirmedBlueprint.repo}
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                </a>
              </div>
            </div>

            {(confirmedSessionState || confirmedBlueprint.prUrl || confirmedBlueprint.sessionUrl) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {confirmedSessionState && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 font-mono text-slate-700 border border-slate-200">
                    State: <strong>{confirmedSessionState}</strong>
                  </span>
                )}
                {confirmedBlueprint.prUrl ? (
                  <a
                    href={confirmedBlueprint.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                  >
                    {confirmedBlueprint.prTitle || 'Open pull request'} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  apiStatus === 'DISPATCHED_TO_JULES' && (
                    <span className="text-[11px] text-slate-500">
                      No pull request harvested yet — use Refresh session after Jules opens one.
                    </span>
                  )
                )}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-indigo-600" />
                  <span className="font-semibold text-xs text-slate-800">
                    Stateless Hydration Contract Token
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyBlueprintJson}
                  className="h-7 text-xs gap-1"
                >
                  {copiedBlueprint ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  {copiedBlueprint ? 'Copied' : 'Copy Blueprint JSON'}
                </Button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                The agent is instructed to embed this exact blueprint inside the GitHub Pull Request description.
                When the PR is submitted, Stage 2 will automatically extract the criteria matrix for audit without needing any active database or connection.
              </p>

              <div className="bg-slate-900 text-slate-100 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                <code>&lt;!-- AUDIT_BLUEPRINT: {JSON.stringify(confirmedBlueprint)} --&gt;</code>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetForm}
                className="w-full sm:w-auto text-xs text-slate-600"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Dispatch Another Job
              </Button>

              <Button
                size="sm"
                onClick={() => onNavigateToStage2(confirmedBlueprint)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs gap-2 font-semibold shadow-md"
              >
                <span>Proceed to Stage 2: Evaluation & Audit</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Form Inputs */
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                    1
                  </span>
                  <CardTitle className="text-base font-bold text-slate-900">
                    Intake & Dispatch Engine
                  </CardTitle>
                </div>
                <CardDescription className="mt-1 text-xs text-slate-600">
                  Fill in your target repository and task objective first. Auto-establish acceptance criteria with Gemini, and dispatch an anti-drift contract to Google Jules.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            {dispatchError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Validation Notice</AlertTitle>
                <AlertDescription className="text-xs">{dispatchError}</AlertDescription>
              </Alert>
            )}

            {/* SECTION 1: REPO TARGET & OBJECTIVE (FIRST IN WORKFLOW) */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/20 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-600 text-[10px] font-bold text-white">
                    A
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                    Step 1: Repository Target & Task Objective
                  </h3>
                </div>
                <Badge variant="outline" className="text-[10px] text-indigo-700 border-indigo-200 bg-white">
                  Primary Context
                </Badge>
              </div>

              {/* Repo Input with Live State Inspector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <FolderGit2 className="h-3.5 w-3.5 text-indigo-600" />
                    Target GitHub Repository <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTroubleshootOpen(true)}
                      className="text-[11px] font-medium text-slate-600 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                    >
                      <Wrench className="h-3 w-3 text-indigo-600" />
                      Troubleshoot Jules
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInspectRepo(repo)}
                      disabled={isInspectingRepo}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${isInspectingRepo ? 'animate-spin' : ''}`} />
                      {isInspectingRepo ? 'Inspecting...' : 'Inspect Repo State'}
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Input
                    placeholder="owner/repo (e.g. Brian125bot/ai_smart_fill, facebook/react, acme-corp/api-gateway)"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    className="text-xs font-mono pl-9"
                  />
                  <FolderGit2 className="h-4 w-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                </div>

                {/* Jules Source Connection & Authorization Indicator */}
                {matchedJulesSource ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      Authorized in Google Jules &mdash; Ready for live agent dispatch (Branch: <code className="font-mono font-bold">{matchedJulesSource.githubRepo?.defaultBranch?.displayName || 'main'}</code>)
                    </span>
                    <button
                      type="button"
                      onClick={() => setTroubleshootOpen(true)}
                      className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2 shrink-0"
                    >
                      Diagnostics
                    </button>
                  </div>
                ) : julesSources.length > 0 ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50/90 border border-amber-200 text-xs text-amber-900">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <div className="leading-tight">
                        <span className="font-bold">Not installed in Google Jules:</span>{' '}
                        <span className="text-amber-800 text-[11px]">
                          &ldquo;{cleanCurrentRepo || repo}&rdquo; is not in your Jules allowlist. Dispatch will return HTTP 404.
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTroubleshootOpen(true)}
                      className="h-6 text-[11px] border-amber-300 bg-white text-amber-800 hover:bg-amber-100 shrink-0 gap-1"
                    >
                      <Wrench className="h-3 w-3" />
                      Fix / Pick ({julesSources.length})
                    </Button>
                  </div>
                ) : null}

                {/* Quick selector chips from user's connected Jules repositories */}
                {julesSources.length > 0 && (
                  <div className="pt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                      <FolderGit2 className="h-3 w-3 text-indigo-500" />
                      Connected in Jules:
                    </span>
                    {julesSources.slice(0, 4).map((source) => {
                      const name = source.githubRepo
                        ? `${source.githubRepo.owner}/${source.githubRepo.repo}`
                        : source.id.replace(/^github\//, '');
                      const isCurrent = cleanCurrentRepo.toLowerCase() === name.toLowerCase();
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setRepo(name);
                            const defBranch = source.githubRepo?.defaultBranch?.displayName;
                            if (defBranch) setBaseBranch(defBranch);
                            handleInspectRepo(name);
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                            isCurrent
                              ? 'bg-indigo-100 text-indigo-800 border-indigo-300 font-bold'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200'
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                    {julesSources.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setTroubleshootOpen(true)}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2 ml-0.5"
                      >
                        +{julesSources.length - 4} more
                      </button>
                    )}
                  </div>
                )}

                {/* Repo State Context Preview Card */}
                {repoInspection && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${repoInspection.isReachable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <span className="font-semibold text-slate-800 font-mono">{repoInspection.repo}</span>
                        <Badge variant={repoInspection.isReachable ? 'secondary' : 'outline'} className="text-[10px]">
                          {repoInspection.isReachable ? `${repoInspection.visibility || 'public'} repo` : 'Custom / Unreachable'}
                        </Badge>
                        {repoInspection.primaryLanguage && (
                          <Badge variant="indigo" className="text-[10px]">
                            {repoInspection.primaryLanguage}
                          </Badge>
                        )}
                        <span className="text-slate-400 text-[11px]">
                          branch: <code className="text-slate-700 font-mono font-bold">{repoInspection.defaultBranch}</code>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowRepoDetails(!showRepoDetails)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-0.5"
                      >
                        <span>{showRepoDetails ? 'Hide Tree' : 'View Detected Structure'}</span>
                        {showRepoDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    </div>

                    {repoInspection.description && (
                      <p className="text-[11px] text-slate-600 line-clamp-1">
                        {repoInspection.description}
                      </p>
                    )}

                    {repoInspection.keyFiles?.dependenciesSummary && repoInspection.keyFiles.dependenciesSummary.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <span className="text-[10px] text-slate-400 font-medium">Detected Stack:</span>
                        {repoInspection.keyFiles.dependenciesSummary.map((dep) => (
                          <span key={dep} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                            {dep}
                          </span>
                        ))}
                      </div>
                    )}

                    {showRepoDetails && repoInspection.treePreview && repoInspection.treePreview.length > 0 && (
                      <div className="pt-2 border-t border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                          Indexed Root Directory Paths:
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {repoInspection.treePreview.map((item) => (
                            <span key={item} className="rounded bg-slate-50 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {repoInspection.error && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                        Note: {repoInspection.error}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Task Objective */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Task Objective & Requirements <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {objective.length} characters
                  </span>
                </div>
                <Textarea
                  rows={4}
                  placeholder="Describe the exact feature, refactoring, or bugfix in detail. For example: 'Implement an IP-based sliding window rate limiter middleware backed by Redis. Return HTTP 429 with standard headers...'"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="text-xs leading-relaxed bg-white border-slate-200"
                />

                {/* Quick objective starters */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-slate-400 font-medium">Quick Directives:</span>
                  {[
                    '+ Add comprehensive unit tests',
                    '+ Return HTTP 429 with retry header',
                    '+ Ensure backward compatibility',
                    '+ No new external dependencies',
                  ].map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      onClick={() => setObjective((prev) => `${prev.trim()} ${phrase.replace('+ ', '')}.`)}
                      className="text-[10px] rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* SECTION 2: AI ACCEPTANCE CRITERIA ARCHITECT (NEW CAPABILITY) */}
            <div className="rounded-xl border-2 border-indigo-200/80 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-slate-50 p-4 sm:p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      Auto-Establish Acceptance Criteria with Gemini
                      <Badge variant="indigo" className="text-[9px] uppercase tracking-wider py-0">
                        AI Engine
                      </Badge>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Gemini will synthesize your task objective and the target repo state to construct a testable checklist and file boundaries.
                    </p>
                  </div>
                </div>

                {/* AI Generation Mode Select */}
                <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 self-start sm:self-auto">
                  {(
                    [
                      { key: 'standard', label: 'Balanced' },
                      { key: 'security', label: 'Security' },
                      { key: 'testing', label: 'Testing/TDD' },
                      { key: 'strict', label: 'Minimal Scope' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setAiMode(m.key)}
                      className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${
                        aiMode === m.key
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoApplyBoundaries}
                      onChange={(e) => setAutoApplyBoundaries(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                    />
                    <span className="text-[11px]">Auto-apply recommended file boundaries & semantic branch</span>
                  </label>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleAutoGenerateCriteria}
                  disabled={isGeneratingCriteria || !repo.trim() || !objective.trim()}
                  className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 gap-2 shadow-sm transition-all"
                >
                  {isGeneratingCriteria ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Synthesizing Criteria via Gemini...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                      <span>Establish Criteria Matrix via AI</span>
                    </>
                  )}
                </Button>
              </div>

              {/* AI Rationale Summary Banner */}
              {aiRationaleSummary && (
                <div className="rounded-lg border border-indigo-200 bg-white/90 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-950 flex items-center gap-1.5 text-[11px]">
                      <Cpu className="h-3.5 w-3.5 text-indigo-600" />
                      AI Criteria Architecture Rationale
                    </span>
                    {detectedArch && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {detectedArch}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-700 leading-relaxed">
                    {aiRationaleSummary}
                  </p>
                </div>
              )}
            </div>

            {/* SECTION 3: ACCEPTANCE CRITERIA MATRIX (REVIEW & CUSTOMIZE) */}
            <div className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/50 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckSquare className="h-3.5 w-3.5 text-indigo-600" />
                    Acceptance Criteria Matrix ({criteria.length})
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    These criteria are locked into the contract and evaluated strictly by Gemini during Stage 2 PR evaluation.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] text-slate-500">
                    {criteria.filter((c) => c.category === 'functional').length} Functional
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-slate-500">
                    {criteria.filter((c) => c.category === 'testing').length} Testing
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-slate-500">
                    {criteria.filter((c) => c.category === 'security').length} Security
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-slate-500">
                    {criteria.filter((c) => c.category === 'constraint').length} Constraints
                  </Badge>
                </div>
              </div>

              {/* Criteria List */}
              <div className="space-y-2">
                {criteria.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-2xs transition-all hover:border-slate-300"
                  >
                    <div className="flex items-start gap-2.5 pt-0.5 flex-1">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-700 font-mono">
                        {idx + 1}
                      </span>
                      <div className="space-y-1 flex-1">
                        <p className="text-xs text-slate-800 font-medium leading-snug">{item.text}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={
                              item.category === 'security'
                                ? 'destructive'
                                : item.category === 'testing'
                                ? 'indigo'
                                : item.category === 'constraint'
                                ? 'warning'
                                : 'secondary'
                            }
                            className="text-[9px] uppercase tracking-wider font-semibold py-0"
                          >
                            {item.category || 'functional'}
                          </Badge>
                          {item.rationale && (
                            <span className="text-[10px] text-slate-500 italic">
                              Why: {item.rationale}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveCriterion(item.id)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors shrink-0"
                      title="Remove criterion"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Custom Criterion Input */}
              <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-slate-200/60">
                <select
                  value={newCriterionCategory}
                  onChange={(e) => setNewCriterionCategory(e.target.value as any)}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 shrink-0 w-full sm:w-auto"
                >
                  <option value="functional">Functional</option>
                  <option value="security">Security</option>
                  <option value="testing">Testing</option>
                  <option value="constraint">Constraint</option>
                </select>

                <Input
                  placeholder="e.g. Must handle edge case when payload exceeds 1MB..."
                  value={newCriterionText}
                  onChange={(e) => setNewCriterionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCriterion();
                    }
                  }}
                  className="text-xs h-9 bg-white"
                />

                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddCriterion}
                  className="h-9 px-3 text-xs shrink-0 bg-slate-800 text-white hover:bg-slate-700 gap-1 w-full sm:w-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Criterion
                </Button>
              </div>
            </div>

            {/* SECTION 4: SCOPE BOUNDARIES & BRANCHING */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-indigo-600" />
                  Scope & File Boundaries (Anti-Drift Guardrails)
                </label>
                <Badge variant="outline" className="text-[10px] text-slate-500">
                  Comma-separated glob paths
                </Badge>
              </div>

              <Input
                placeholder="src/middleware/**, src/config/**, tests/**"
                value={fileBoundaries}
                onChange={(e) => setFileBoundaries(e.target.value)}
                className="text-xs font-mono"
              />
              <p className="text-[11px] text-slate-500">
                Any file modified outside these boundaries will be strictly flagged as an unauthorized blast radius violation during Stage 2 evaluation.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Base Branch</label>
                  <Input
                    placeholder="main"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="text-xs font-mono"
                  />
                  <span className="text-[11px] text-slate-400">Default branch Jules branches off from</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Target Branch Name</label>
                  <Input
                    placeholder="jules/feature-branch"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="text-xs font-mono"
                  />
                  <span className="text-[11px] text-slate-400">Branch Jules creates Pull Request from</span>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 p-4">
            <div className="flex items-center flex-wrap gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenPreview}
                className="text-xs gap-1.5 border-slate-200 text-slate-700 hover:bg-white"
              >
                <FileCode className="h-3.5 w-3.5 text-indigo-600" />
                Preview Agent Contract
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setTroubleshootOpen(true)}
                className="text-xs gap-1.5 border-indigo-200 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100/70"
              >
                <Wrench className="h-3.5 w-3.5 text-indigo-600" />
                Troubleshoot Jules Dispatch
              </Button>

              {/* Jules API Key Status Badge */}
              {julesKey || hasServerJules ? (
                <Badge variant="success" className="gap-1 text-[11px] py-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Jules API Key Active
                </Badge>
              ) : (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded-md transition-colors"
                >
                  <Cpu className="h-3 w-3 text-amber-600" />
                  <span>Set Jules API Key</span>
                </button>
              )}

              <button
                type="button"
                onClick={onOpenSettings}
                className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2 ml-1"
              >
                API Credentials
              </button>

              <label
                className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer ml-1"
                title="Simulate dispatch locally without calling Google Jules (no API key needed)"
              >
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Dry-run (no Jules key needed)</span>
              </label>
            </div>

            <Button
              size="sm"
              onClick={handleDispatch}
              disabled={isDispatching}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-5 gap-2 shadow-sm"
            >
              {isDispatching ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Compiling & Dispatching...</span>
                </>
              ) : dryRun ? (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Simulate Dispatch (Dry Run)</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Dispatch to Google Jules</span>
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

