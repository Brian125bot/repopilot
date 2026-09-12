'use client';

import * as React from 'react';
import {
  GitPullRequest,
  Search,
  Sparkles,
  Layers,
  FileCode,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Play,
  CheckCircle2,
  ExternalLink,
  Edit3,
  Plus,
  Trash2,
  Flame,
  ArrowRight,
  Database,
  RefreshCw,
  Copy,
  Check,
  Download,
  GitBranch,
  Calendar,
  Terminal,
  FolderArchive,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { DiffViewerModal } from './DiffViewerModal';
import { MergeScorecard } from './MergeScorecard';
import {
  exportOutcomeLog,
  loadOutcomeLog,
  updateStoredOutcomeRow,
} from '@/lib/outcome-memory';
import { Blueprint, AcceptanceCriterion, SanitizedDiffResult, PRMetadata, GeminiAuditReport } from '@/types';

interface AuditEvaluationStageProps {
  julesKey?: string;
  geminiKey: string;
  githubPat: string;
  activeBlueprint: Blueprint | null;
  blueprints: Blueprint[];
  onOpenSettings: () => void;
  onOpenVault: () => void;
  onSaveBlueprint?: (blueprint: Blueprint) => void;
  onSelectBlueprint?: (blueprint: Blueprint) => void;
}

// Pre-baked realistic sample PR unified diff with embedded blueprint comment
const DEMO_PR_DIFF = `diff --git a/src/middleware/rate-limiter.ts b/src/middleware/rate-limiter.ts
new file mode 100644
index 0000000..8a4e1d2
--- /dev/null
+++ b/src/middleware/rate-limiter.ts
@@ -0,0 +1,52 @@
+import { NextRequest, NextResponse } from 'next/server';
+import { getRedisClient } from '../config/redis';
+
+const WINDOW_SECONDS = 60;
+const MAX_REQUESTS = 60;
+
+export async function rateLimiterMiddleware(req: NextRequest) {
+  const forwardedFor = req.headers.get('x-forwarded-for');
+  const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : '127.0.0.1';
+  
+  const redis = getRedisClient();
+  const currentSecond = Math.floor(Date.now() / 1000);
+  const key = \`rate_limit:\${clientIp}:\${Math.floor(currentSecond / WINDOW_SECONDS)}\`;
+
+  const count = await redis.incr(key);
+  if (count === 1) {
+    await redis.expire(key, WINDOW_SECONDS);
+  }
+
+  const remaining = Math.max(0, MAX_REQUESTS - count);
+  const headers = new Headers();
+  headers.set('RateLimit-Limit', String(MAX_REQUESTS));
+  headers.set('RateLimit-Remaining', String(remaining));
+
+  if (count > MAX_REQUESTS) {
+    headers.set('Retry-After', String(WINDOW_SECONDS));
+    return new NextResponse(
+      JSON.stringify({ error: 'Too Many Requests', message: 'Rate limit ceiling exceeded.' }),
+      { status: 429, headers }
+    );
+  }
+
+  return null;
+}
diff --git a/src/config/redis.ts b/src/config/redis.ts
new file mode 100644
index 0000000..7c2b3f1
--- /dev/null
+++ b/src/config/redis.ts
@@ -0,0 +1,18 @@
+export interface RedisMockClient {
+  incr(key: string): Promise<number>;
+  expire(key: string, ttl: number): Promise<void>;
+}
+
+const memoryStore = new Map<string, number>();
+
+export function getRedisClient(): RedisMockClient {
+  return {
+    async incr(key: string): Promise<number> {
+      const current = memoryStore.get(key) || 0;
+      memoryStore.set(key, current + 1);
+      return current + 1;
+    },
+    async expire(): Promise<void> {},
+  };
+}
diff --git a/tests/rate-limiter.test.ts b/tests/rate-limiter.test.ts
new file mode 100644
index 0000000..1d8e9f4
--- /dev/null
+++ b/tests/rate-limiter.test.ts
@@ -0,0 +1,24 @@
+import { describe, it, expect } from 'vitest';
+import { rateLimiterMiddleware } from '../src/middleware/rate-limiter';
+import { NextRequest } from 'next/server';
+
+describe('rateLimiterMiddleware', () => {
+  it('extracts IP from x-forwarded-for header', async () => {
+    const req = new NextRequest('http://localhost/api/data', {
+      headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.1' },
+    });
+    const res = await rateLimiterMiddleware(req);
+    expect(res).toBeNull();
+  });
+
+  it('returns 429 after 60 requests in window', async () => {
+    const req = new NextRequest('http://localhost/api/data', {
+      headers: { 'x-forwarded-for': '203.0.113.195' },
+    });
+    for (let i = 0; i < 60; i++) {
+      await rateLimiterMiddleware(req);
+    }
+    const blockedRes = await rateLimiterMiddleware(req);
+    expect(blockedRes?.status).toBe(429);
+  });
+});`;

export function AuditEvaluationStage({
  julesKey,
  geminiKey,
  githubPat,
  activeBlueprint,
  blueprints,
  onOpenSettings,
  onOpenVault,
  onSaveBlueprint,
  onSelectBlueprint,
}: AuditEvaluationStageProps) {
  const [prInput, setPrInput] = React.useState('acme-corp/api-gateway/pull/42');
  const [isFetchingDiff, setIsFetchingDiff] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  // Ingested data
  const [prMetadata, setPrMetadata] = React.useState<PRMetadata | null>(null);
  const [sanitizedResult, setSanitizedResult] = React.useState<SanitizedDiffResult | null>(null);

  // Active hydrated blueprint contract tracking
  const [hydratedBlueprint, setHydratedBlueprint] = React.useState<Blueprint | null>(
    activeBlueprint || (blueprints.length > 0 ? blueprints[0] : null)
  );
  const [copiedBpId, setCopiedBpId] = React.useState(false);

  const [hydratedCriteria, setHydratedCriteria] = React.useState<AcceptanceCriterion[]>(
    activeBlueprint?.criteria || (blueprints.length > 0 ? blueprints[0]?.criteria || [] : [])
  );
  const [hydratedBoundaries, setHydratedBoundaries] = React.useState<string[]>(
    activeBlueprint?.fileBoundaries || (blueprints.length > 0 ? blueprints[0]?.fileBoundaries || [] : [])
  );
  const [hydratedObjective, setHydratedObjective] = React.useState<string>(
    activeBlueprint?.objective || (blueprints.length > 0 ? blueprints[0]?.objective || '' : '')
  );
  const [hydrationSource, setHydrationSource] = React.useState<
    'EMBEDDED_COMMENT' | 'LOCAL_VAULT' | 'MANUAL_EDIT' | 'DEMO' | null
  >(activeBlueprint || blueprints.length > 0 ? 'LOCAL_VAULT' : null);

  // Gemini audit evaluation
  const [isEvaluating, setIsEvaluating] = React.useState(false);
  const [auditError, setAuditError] = React.useState<string | null>(null);
  const [auditReport, setAuditReport] = React.useState<GeminiAuditReport | null>(null);

  // Modals
  const [diffModalOpen, setDiffModalOpen] = React.useState(false);

  // Extract clean repository name
  const extractedRepo = React.useMemo(() => {
    if (prMetadata?.htmlUrl) {
      const match = prMetadata.htmlUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
      if (match && match[1]) {
        return match[1].replace(/\/pull\/.*$/, '');
      }
    }
    const clean = prInput.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (clean.includes('/')) {
      const parts = clean.split('/');
      return `${parts[0]}/${parts[1]}`;
    }
    return 'acme-corp/api-gateway';
  }, [prMetadata, prInput]);

  // Update when activeBlueprint changes from vault or Stage 1
  React.useEffect(() => {
    if (activeBlueprint) {
      const timer = setTimeout(() => {
        setHydratedBlueprint(activeBlueprint);
        setHydratedCriteria(activeBlueprint.criteria || []);
        setHydratedBoundaries(activeBlueprint.fileBoundaries || []);
        setHydratedObjective(activeBlueprint.objective || '');
        setHydrationSource('LOCAL_VAULT');
        if (activeBlueprint.repo && activeBlueprint.branchName) {
          setPrInput(`${activeBlueprint.repo} (${activeBlueprint.branchName})`);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeBlueprint]);

  // If activeBlueprint is not passed but blueprints are present and unhydrated, hydrate first
  React.useEffect(() => {
    if (!activeBlueprint && blueprints.length > 0 && !hydratedBlueprint) {
      const timer = setTimeout(() => {
        const first = blueprints[0];
        setHydratedBlueprint(first);
        setHydratedCriteria(first.criteria || []);
        setHydratedBoundaries(first.fileBoundaries || []);
        setHydratedObjective(first.objective || '');
        setHydrationSource('LOCAL_VAULT');
        if (first.repo && first.branchName) {
          setPrInput(`${first.repo} (${first.branchName})`);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeBlueprint, blueprints, hydratedBlueprint]);

  // Handler to switch vault cache entry directly
  const handleSelectVaultEntry = (bp: Blueprint) => {
    setHydratedBlueprint(bp);
    setHydratedCriteria(bp.criteria || []);
    setHydratedBoundaries(bp.fileBoundaries || []);
    setHydratedObjective(bp.objective || '');
    setHydrationSource('LOCAL_VAULT');
    if (bp.repo && bp.branchName) {
      setPrInput(`${bp.repo} (${bp.branchName})`);
    } else if (bp.repo) {
      setPrInput(bp.repo);
    }
    onSelectBlueprint?.(bp);
  };

  // Load Demo PR
  const handleLoadDemo = async () => {
    setFetchError(null);
    setAuditReport(null);
    setIsFetchingDiff(true);

    try {
      const demoBlueprint: Blueprint = {
        blueprintId: 'bp_demo_rate_limiter',
        repo: 'acme-corp/api-gateway',
        baseBranch: 'main',
        branchName: 'jules/rate-limiter-redis',
        fileBoundaries: ['src/middleware/rate-limiter.ts', 'src/config/redis.ts', 'tests/rate-limiter.test.ts'],
        objective:
          'Implement an IP-based sliding window rate limiter middleware backed by Redis. Return HTTP 429 with standard RateLimit-* headers when threshold is exceeded.',
        criteria: [
          { id: '1', text: 'Middleware extracts client IP correctly with support for X-Forwarded-For', category: 'functional' },
          { id: '2', text: 'Sliding window algorithm enforces 60 requests per minute ceiling', category: 'functional' },
          { id: '3', text: 'Returns HTTP 429 with RateLimit-Limit, RateLimit-Remaining, and Retry-After headers', category: 'functional' },
          { id: '4', text: 'Unit tests cover under-limit, burst limit, and window expiry states', category: 'testing' },
          { id: '5', text: 'Zero modifications to out-of-scope files or root dependencies', category: 'constraint' },
        ],
        createdAt: new Date().toISOString(),
      };

      // Call fetch-diff with demo diff
      const res = await fetch('/api/audit/fetch-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawDiff: DEMO_PR_DIFF,
          fileBoundaries: demoBlueprint.fileBoundaries,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process demo diff');

      const meta: PRMetadata = {
        title: 'feat(rate-limiter): add sliding window redis rate limiter middleware',
        number: 42,
        author: 'jules-agent',
        htmlUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
        baseBranch: 'main',
        headBranch: 'jules/rate-limiter-redis',
        state: 'open',
        body: `<!-- AUDIT_BLUEPRINT: ${JSON.stringify(demoBlueprint)} -->`,
        embeddedBlueprint: demoBlueprint,
      };

      setSanitizedResult(data.sanitizedResult);
      setPrMetadata(meta);

      setHydratedBlueprint(demoBlueprint);
      setHydratedCriteria(demoBlueprint.criteria);
      setHydratedBoundaries(demoBlueprint.fileBoundaries);
      setHydratedObjective(demoBlueprint.objective);
      setHydrationSource('DEMO');
      setPrInput('https://github.com/acme-corp/api-gateway/pull/42');

      // Auto-populate audit report so the complete scorecard and remediation prompt appear immediately
      try {
        const auditHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (geminiKey) auditHeaders['x-gemini-api-key'] = geminiKey;

        const auditRes = await fetch('/api/audit/evaluate', {
          method: 'POST',
          headers: auditHeaders,
          body: JSON.stringify({
            diff: data.sanitizedResult.sanitizedDiff,
            criteria: demoBlueprint.criteria,
            objective: demoBlueprint.objective,
            fileBoundaries: demoBlueprint.fileBoundaries,
            unauthorizedPaths: data.sanitizedResult.stats?.unauthorizedPaths || [],
            prMetadata: meta,
          }),
        });

        if (auditRes.ok) {
          const auditData = await auditRes.json();
          if (auditData.report) {
            setAuditReport(auditData.report);
          }
        }
      } catch (auditErr) {
        console.warn('Initial demo auto-audit notice:', auditErr);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Error loading demo');
    } finally {
      setIsFetchingDiff(false);
    }
  };

  const handleFetchPR = async () => {
    setFetchError(null);
    setAuditReport(null);

    if (!prInput.trim()) {
      setFetchError('Please enter a GitHub PR URL (e.g. https://github.com/owner/repo/pull/123)');
      return;
    }

    setIsFetchingDiff(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (githubPat) headers['x-github-pat'] = githubPat;

      const res = await fetch('/api/audit/fetch-diff', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prUrl: prInput.trim(),
          fileBoundaries: hydratedBoundaries,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch PR diff from GitHub.');
      }

      setPrMetadata(data.pr);
      setSanitizedResult(data.sanitizedResult);

      // Hydration Check:
      // 1. Check embedded blueprint in PR body
      if (data.pr?.embeddedBlueprint) {
        const bp = data.pr.embeddedBlueprint as Blueprint;
        setHydratedBlueprint(bp);
        setHydratedCriteria(bp.criteria || []);
        setHydratedBoundaries(bp.fileBoundaries || []);
        setHydratedObjective(bp.objective || '');
        setHydrationSource('EMBEDDED_COMMENT');
      } else {
        // 2. Check localStorage blueprints matching repo & headBranch or active blueprint
        const matching = blueprints.find(
          (b) =>
            b.repo.toLowerCase() === prInput.toLowerCase() ||
            (data.pr?.headBranch && b.branchName === data.pr.headBranch) ||
            (activeBlueprint && b.blueprintId === activeBlueprint.blueprintId)
        );

        if (matching) {
          setHydratedBlueprint(matching);
          setHydratedCriteria(matching.criteria || []);
          setHydratedBoundaries(matching.fileBoundaries || []);
          setHydratedObjective(matching.objective || '');
          setHydrationSource('LOCAL_VAULT');
        } else if (hydratedBlueprint) {
          setHydrationSource('LOCAL_VAULT');
        } else if (hydratedCriteria.length === 0) {
          setHydrationSource('MANUAL_EDIT');
        }
      }
    } catch (err) {
      console.error('Diff fetch error:', err);
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch PR diff');
    } finally {
      setIsFetchingDiff(false);
    }
  };

  const handleRunAudit = async () => {
    setAuditError(null);
    if (!sanitizedResult || !sanitizedResult.sanitizedDiff) {
      setAuditError('No diff available to evaluate. Please fetch a PR first.');
      return;
    }
    if (hydratedCriteria.length === 0) {
      setAuditError('At least one acceptance criterion is required for Gemini audit.');
      return;
    }

    setIsEvaluating(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (geminiKey) headers['x-gemini-api-key'] = geminiKey;

      const res = await fetch('/api/audit/evaluate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          diff: sanitizedResult.sanitizedDiff,
          criteria: hydratedCriteria,
          objective: hydratedObjective,
          fileBoundaries: hydratedBoundaries,
          unauthorizedPaths: sanitizedResult.stats?.unauthorizedPaths || [],
          prMetadata,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gemini audit evaluation failed.');
      }

      setAuditReport(data.report);
      // Outcome log: complete the row for this blueprint with the audit outcome.
      if (hydratedBlueprint) {
        const completed = data.report as GeminiAuditReport;
        updateStoredOutcomeRow(
          { blueprintId: hydratedBlueprint.blueprintId, sessionId: hydratedBlueprint.sessionId },
          {
            verdict: completed.mergeVerdict.status,
            score: completed.mergeVerdict.overallScore,
            unauthorizedCount: sanitizedResult.stats?.unauthorizedPaths?.length ?? 0,
            unmetIds: (completed.criteriaResults || [])
              .filter((c) => c.status !== 'MET')
              .map((c) => c.id),
          }
        );
      }
    } catch (err) {
      console.error('Audit evaluation error:', err);
      setAuditError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleExportOutcomeLog = () => {
    const blob = new Blob([exportOutcomeLog(loadOutcomeLog())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'repopilot-outcome-log.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <DiffViewerModal
        open={diffModalOpen}
        onOpenChange={setDiffModalOpen}
        sanitizedResult={sanitizedResult}
      />

      {/* Ingestion & Hydration Header Card */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                  2
                </span>
                <CardTitle>Evaluation & Audit Engine</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Ingest pull request diff, hydrate Stage 1 criteria contract, and trigger Gemini automated audit.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadDemo}
                className="text-xs border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                <span>Load Demo PR</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onOpenVault}
                className="text-xs border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Database className="h-3.5 w-3.5 text-slate-500 mr-1" />
                Select Blueprint
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {fetchError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Ingestion Error</AlertTitle>
              <AlertDescription className="text-xs">{fetchError}</AlertDescription>
            </Alert>
          )}

          {/* Hydrated Vault Cache Entry Card - Prominent Active Specification Display */}
          {hydratedBlueprint ? (
            <div className="rounded-xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 via-slate-50/40 to-white p-4 sm:p-5 space-y-3.5 shadow-xs">
              {/* Header Status & Selector Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-indigo-100/90">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600"></span>
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Hydrated Vault Evaluation Contract
                  </span>

                  {hydrationSource === 'LOCAL_VAULT' && (
                    <Badge variant="indigo" className="text-[10px] gap-1 font-semibold shadow-2xs">
                      <Database className="h-3 w-3 text-indigo-600" />
                      Vault Cache Entry Active
                    </Badge>
                  )}
                  {hydrationSource === 'EMBEDDED_COMMENT' && (
                    <Badge variant="success" className="text-[10px] gap-1 font-semibold shadow-2xs">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      PR Markdown Contract Ingested
                    </Badge>
                  )}
                  {hydrationSource === 'DEMO' && (
                    <Badge variant="outline" className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border-indigo-200 shadow-2xs">
                      Sample Demo Contract Active
                    </Badge>
                  )}
                  {hydrationSource === 'MANUAL_EDIT' && (
                    <Badge variant="secondary" className="text-[10px] font-semibold">
                      Ad-Hoc / Custom Contract
                    </Badge>
                  )}
                </div>

                {/* Entry Switcher & Vault Button */}
                <div className="flex items-center gap-2 flex-wrap">
                  {blueprints.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500 hidden md:inline">Switch Entry:</span>
                      <select
                        value={hydratedBlueprint.blueprintId}
                        onChange={(e) => {
                          const found = blueprints.find((b) => b.blueprintId === e.target.value);
                          if (found) handleSelectVaultEntry(found);
                        }}
                        className="text-xs font-mono bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs max-w-[220px] truncate cursor-pointer hover:border-indigo-300 transition-colors"
                        title="Switch hydrated vault entry"
                      >
                        {blueprints.map((b) => (
                          <option key={b.blueprintId} value={b.blueprintId}>
                            {b.blueprintId === hydratedBlueprint.blueprintId ? '✓ ' : ''}
                            {b.blueprintId} ({b.repo.split('/')[1] || b.repo})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenVault}
                    className="text-xs h-7 gap-1 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs"
                  >
                    <FolderArchive className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Vault</span> ({blueprints.length})
                  </Button>
                </div>
              </div>

              {/* Identification Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Entry ID */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Vault Entry ID
                  </span>
                  <div className="flex items-center justify-between gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-indigo-100 shadow-2xs font-mono text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Database className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                      <span className="font-bold text-indigo-950 truncate">
                        {hydratedBlueprint.blueprintId}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(hydratedBlueprint.blueprintId);
                        setCopiedBpId(true);
                        setTimeout(() => setCopiedBpId(false), 1500);
                      }}
                      className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded hover:bg-slate-50 shrink-0"
                      title="Copy Blueprint ID"
                    >
                      {copiedBpId ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {/* Target Repo */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Target Repository
                  </span>
                  <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80 shadow-2xs text-xs font-semibold text-slate-900 truncate">
                    <GitPullRequest className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{hydratedBlueprint.repo}</span>
                  </div>
                </div>

                {/* Target Branch Contract */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Target Branch Contract
                  </span>
                  <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80 shadow-2xs text-xs font-mono text-slate-800 truncate">
                    <GitBranch className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                    <span className="font-bold text-indigo-700 truncate">{hydratedBlueprint.branchName}</span>
                    <span className="text-slate-400 text-[10px]">←</span>
                    <span className="text-slate-500 text-[11px] truncate">{hydratedBlueprint.baseBranch || 'main'}</span>
                  </div>
                </div>
              </div>

              {/* Objective Preview */}
              <div className="rounded-lg bg-white/95 p-3 border border-slate-200/80 text-xs text-slate-700 leading-relaxed shadow-2xs">
                <span className="font-bold text-slate-900">Task Objective: </span>
                <span className="text-slate-800 font-normal">
                  {hydratedBlueprint.objective || hydratedObjective || 'No explicit objective text provided.'}
                </span>
              </div>

              {/* Meta Tags & Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 border border-emerald-200/70 shadow-2xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <strong>{hydratedCriteria.length}</strong> Acceptance Criteria
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 border border-indigo-200/70 shadow-2xs">
                    <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
                    <strong>{hydratedBoundaries.length}</strong> Authorized Boundaries
                  </span>

                  {hydratedBlueprint.sessionId && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-mono text-slate-700 border border-slate-200/70 shadow-2xs">
                      <Terminal className="h-3 w-3 text-slate-500" />
                      Session: <span className="font-bold">{hydratedBlueprint.sessionId.slice(0, 16)}...</span>
                    </span>
                  )}

                  {hydratedBlueprint.createdAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Calendar className="h-3 w-3" />
                      {new Date(hydratedBlueprint.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>

                {/* Pre-fill Action */}
                {hydratedBlueprint.repo && (
                  <button
                    onClick={() => {
                      if (hydratedBlueprint.branchName) {
                        setPrInput(`${hydratedBlueprint.repo} (${hydratedBlueprint.branchName})`);
                      } else {
                        setPrInput(hydratedBlueprint.repo);
                      }
                    }}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium underline underline-offset-2 hover:bg-indigo-50/60 px-2 py-1 rounded transition-colors"
                  >
                    Use target in PR search &rarr;
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2.5 text-xs text-amber-900 shadow-2xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="font-bold text-amber-950">No Vault Cache Entry Hydrated</span>
              </div>
              <p className="text-amber-800/90 leading-relaxed">
                The Evaluation Engine compares incoming pull requests against a deterministic acceptance contract.
                {blueprints.length > 0
                  ? ` You have ${blueprints.length} cached blueprint${blueprints.length > 1 ? 's' : ''} in your Vault. Select an entry below to hydrate its contract:`
                  : ' Dispatch a task in Stage 1 to automatically populate the vault, load the demo PR, or enter a GitHub PR URL with an embedded contract comment.'}
              </p>

              {blueprints.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-[11px] font-semibold text-amber-950">Cached Entries:</span>
                  {blueprints.slice(0, 3).map((b) => (
                    <Button
                      key={b.blueprintId}
                      variant="outline"
                      size="sm"
                      onClick={() => handleSelectVaultEntry(b)}
                      className="text-xs h-7 bg-white hover:bg-amber-50 border-amber-200/90 text-amber-950 gap-1.5 shadow-2xs"
                    >
                      <Database className="h-3 w-3 text-indigo-600" />
                      <span className="font-mono font-bold">{b.blueprintId}:</span>
                      <span className="text-slate-600 truncate max-w-[140px]">{b.repo}</span>
                    </Button>
                  ))}
                  {blueprints.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onOpenVault}
                      className="text-xs h-7 text-amber-800 hover:text-amber-950"
                    >
                      +{blueprints.length - 3} more...
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search / Ingestion Bar */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <GitPullRequest className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="GitHub PR URL (e.g. https://github.com/owner/repo/pull/123)"
                value={prInput}
                onChange={(e) => setPrInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleFetchPR();
                  }
                }}
                className="pl-10 text-xs font-mono h-10"
              />
            </div>

            <Button
              size="sm"
              onClick={handleFetchPR}
              disabled={isFetchingDiff}
              className="h-10 px-5 text-xs bg-slate-900 hover:bg-slate-800 text-white gap-1.5 shrink-0 w-full sm:w-auto"
            >
              {isFetchingDiff ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Fetching Diff...</span>
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5" />
                  <span>Ingest PR & Extract Diff</span>
                </>
              )}
            </Button>
          </div>

          {/* Hydration Status Banner */}
          {sanitizedResult && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900 text-sm">
                    {prMetadata?.title || 'Pull Request Ingested'}
                  </span>
                  {prMetadata?.number ? (
                    <Badge variant="indigo" className="text-[10px]">
                      #{prMetadata.number}
                    </Badge>
                  ) : null}
                  {hydrationSource === 'EMBEDDED_COMMENT' && (
                    <Badge variant="success" className="text-[10px] gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Hydrated from PR &lt;!-- AUDIT_BLUEPRINT --&gt;
                    </Badge>
                  )}
                  {hydrationSource === 'LOCAL_VAULT' && (
                    <Badge variant="indigo" className="text-[10px] gap-1">
                      <Database className="h-3 w-3" />
                      Hydrated from Vault Cache
                    </Badge>
                  )}
                  {hydrationSource === 'DEMO' && (
                    <Badge variant="outline" className="text-[10px] text-indigo-700 bg-indigo-50 border-indigo-200">
                      Sample Jules PR Active
                    </Badge>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDiffModalOpen(true)}
                  className="text-xs h-7 gap-1 border-slate-200 text-slate-700 hover:bg-white"
                >
                  <FileCode className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Inspect Sanitized Diff</span>
                </Button>
              </div>

              {/* Dedicated Hydrated Vault Cache Entry Callout in Diff Banner */}
              <div className="rounded-lg bg-indigo-50/80 border border-indigo-200/90 p-3 space-y-1.5 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Database className="h-4 w-4 text-indigo-600 shrink-0" />
                    <span className="text-xs font-bold text-indigo-950">
                      Active Evaluation Contract:
                    </span>
                    <code className="font-mono text-xs font-bold bg-white text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
                      {hydratedBlueprint?.blueprintId || (hydrationSource === 'EMBEDDED_COMMENT' ? 'PR-EMBEDDED' : 'AD-HOC')}
                    </code>
                  </div>
                  <span className="text-[11px] text-indigo-800 font-medium">
                    {hydrationSource === 'LOCAL_VAULT' && `Source: Local Vault Cache (${blueprints.length} available)`}
                    {hydrationSource === 'EMBEDDED_COMMENT' && 'Source: PR Description Markdown Comment'}
                    {hydrationSource === 'DEMO' && 'Source: Sample Interactive Demo Specification'}
                    {hydrationSource === 'MANUAL_EDIT' && 'Source: Ad-Hoc Manual Parameters'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-indigo-900 flex-wrap pt-0.5">
                  <span>Target Repo: <strong>{hydratedBlueprint?.repo || extractedRepo}</strong></span>
                  <span>•</span>
                  <span>Branch: <strong className="font-mono">{hydratedBlueprint?.branchName || prMetadata?.headBranch || 'audited-branch'}</strong></span>
                  <span>•</span>
                  <span>Enforcing: <strong>{hydratedCriteria.length} criteria</strong></span>
                  <span>•</span>
                  <span>Boundaries: <strong>{hydratedBoundaries.length} authorized path glob(s)</strong></span>
                </div>
              </div>

              {/* Blast Radius Stats Pill Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Files Touched
                  </span>
                  <p className="font-bold text-slate-800 text-sm">{sanitizedResult.stats.totalFilesTouched}</p>
                </div>

                <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Lines Added (+)
                  </span>
                  <p className="font-bold text-emerald-600 text-sm">+{sanitizedResult.stats.linesAdded}</p>
                </div>

                <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Lines Removed (-)
                  </span>
                  <p className="font-bold text-red-600 text-sm">-{sanitizedResult.stats.linesRemoved}</p>
                </div>

                <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Scope Violations
                  </span>
                  <p
                    className={`font-bold text-sm ${
                      sanitizedResult.stats.unauthorizedPaths.length > 0 ? 'text-red-600' : 'text-emerald-600'
                    }`}
                  >
                    {sanitizedResult.stats.unauthorizedPaths.length} Out of Scope
                  </p>
                </div>
              </div>

              {/* Large Diff Truncation Warning */}
              {sanitizedResult.isTruncated && (
                <Alert variant="warning" className="bg-amber-50 border-amber-200 text-amber-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-xs font-semibold">Diff Truncation Notice</AlertTitle>
                  <AlertDescription className="text-xs">
                    {sanitizedResult.truncationNotice}
                  </AlertDescription>
                </Alert>
              )}

              {/* Active Acceptance Criteria Checklist */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <span>Active Criteria Matrix ({hydratedCriteria.length} criteria)</span>
                    {hydratedBlueprint && (
                      <span className="font-mono text-[10px] font-normal text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                        {hydratedBlueprint.blueprintId}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-slate-400">Ready for Gemini verification</span>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {hydratedCriteria.map((c, i) => (
                    <div
                      key={c.id || i}
                      className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 border border-slate-200/80 text-xs text-slate-800"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-700 font-mono">
                        {i + 1}
                      </span>
                      <span className="truncate">{c.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trigger Gemini Audit Button */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200">
                <div className="text-xs text-slate-500">
                  Model: <strong className="text-slate-800">gemini-3.8-flash</strong> (Structured Output Schema)
                </div>

                <Button
                  size="sm"
                  onClick={handleRunAudit}
                  disabled={isEvaluating}
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-6 py-2 gap-2 shadow-sm"
                >
                  {isEvaluating ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Auditing Diff with Gemini...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>Run Gemini Structured Audit</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {auditError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Audit Evaluation Error</AlertTitle>
              <AlertDescription className="text-xs">{auditError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Merge Readiness Scorecard */}
      {auditReport && (
        <MergeScorecard
          report={auditReport}
          prMetadata={prMetadata}
          repo={extractedRepo}
          fileBoundaries={hydratedBoundaries}
          blueprint={hydratedBlueprint}
          hydrationSource={hydrationSource}
          julesKey={julesKey}
          githubPat={githubPat}
          onViewDiff={() => setDiffModalOpen(true)}
          onOpenSettings={onOpenSettings}
          onSaveBlueprint={onSaveBlueprint}
        />
      )}

      {/* Outcome log export (raw JSON, no aggregates) */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExportOutcomeLog} className="text-xs gap-1.5">
          <Download className="h-3.5 w-3.5" />
          <span>Export outcome log (JSON)</span>
        </Button>
      </div>
    </div>
  );
}
