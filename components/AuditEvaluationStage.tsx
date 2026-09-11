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
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { DiffViewerModal } from './DiffViewerModal';
import { MergeScorecard } from './MergeScorecard';
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
}: AuditEvaluationStageProps) {
  const [prInput, setPrInput] = React.useState('acme-corp/api-gateway/pull/42');
  const [isFetchingDiff, setIsFetchingDiff] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  // Ingested data
  const [prMetadata, setPrMetadata] = React.useState<PRMetadata | null>(null);
  const [sanitizedResult, setSanitizedResult] = React.useState<SanitizedDiffResult | null>(null);
  const [hydratedCriteria, setHydratedCriteria] = React.useState<AcceptanceCriterion[]>(
    activeBlueprint?.criteria || []
  );
  const [hydratedBoundaries, setHydratedBoundaries] = React.useState<string[]>(
    activeBlueprint?.fileBoundaries || []
  );
  const [hydratedObjective, setHydratedObjective] = React.useState<string>(
    activeBlueprint?.objective || ''
  );
  const [hydrationSource, setHydrationSource] = React.useState<
    'EMBEDDED_COMMENT' | 'LOCAL_VAULT' | 'MANUAL_EDIT' | 'DEMO' | null
  >(activeBlueprint ? 'LOCAL_VAULT' : null);

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
        setHydratedCriteria(bp.criteria || []);
        setHydratedBoundaries(bp.fileBoundaries || []);
        setHydratedObjective(bp.objective || '');
        setHydrationSource('EMBEDDED_COMMENT');
      } else {
        // 2. Check localStorage blueprints matching repo & headBranch
        const matching = blueprints.find(
          (b) =>
            b.repo.toLowerCase() === prInput.toLowerCase() ||
            (data.pr?.headBranch && b.branchName === data.pr.headBranch)
        );

        if (matching) {
          setHydratedCriteria(matching.criteria || []);
          setHydratedBoundaries(matching.fileBoundaries || []);
          setHydratedObjective(matching.objective || '');
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
          prMetadata,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gemini audit evaluation failed.');
      }

      setAuditReport(data.report);
    } catch (err) {
      console.error('Audit evaluation error:', err);
      setAuditError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setIsEvaluating(false);
    }
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
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Active Criteria Matrix ({hydratedCriteria.length} criteria)
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
          julesKey={julesKey}
          githubPat={githubPat}
          onViewDiff={() => setDiffModalOpen(true)}
          onOpenSettings={onOpenSettings}
          onSaveBlueprint={onSaveBlueprint}
        />
      )}
    </div>
  );
}
