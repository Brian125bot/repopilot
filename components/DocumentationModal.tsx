'use client';

import * as React from 'react';
import {
  BookOpen,
  X,
  ShieldAlert,
  Terminal,
  Cpu,
  GitPullRequest,
  CheckCircle2,
  Code2,
  Workflow,
  Copy,
  Check,
  Zap,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

interface DocumentationModalProps {
  open: boolean;
  onClose: () => void;
}

type DocTab = 'overview' | 'architecture' | 'antidrift' | 'jules' | 'audit' | 'testing' | 'api';

export function DocumentationModal({ open, onClose }: DocumentationModalProps) {
  const [activeTab, setActiveTab] = React.useState<DocTab>('overview');
  const [copiedSnippet, setCopiedSnippet] = React.useState<string | null>(null);

  if (!open) return null;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const navItems: { id: DocTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Overview & Quickstart', icon: BookOpen },
    { id: 'jules', label: 'Google Jules Automation', icon: Cpu },
    { id: 'architecture', label: 'Decoupled Architecture', icon: Workflow },
    { id: 'antidrift', label: 'Anti-Drift Compiler', icon: ShieldAlert },
    { id: 'audit', label: 'Gemini PR Audit & Scorecard', icon: GitPullRequest },
    { id: 'testing', label: 'Test Suite & CI (Vitest)', icon: Terminal },
    { id: 'api', label: 'API Reference', icon: Code2 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-sm animate-in fade-in-50">
      <div className="relative w-full max-w-5xl h-[88vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <BookOpen className="h-4 w-4 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  RepoPilot Documentation & Architecture Guide
                </h2>
                <Badge variant="indigo" className="text-[10px] px-1.5 py-0 font-medium">
                  v1.0 Production
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Complete architectural specifications, anti-drift protocols, test suite guides, and API documentation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Modal Body with Sidebar and Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation Sidebar */}
          <aside className="w-64 border-r border-slate-200 bg-slate-50/50 p-4 flex flex-col gap-1 overflow-y-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1">
              Documentation Chapters
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-xl transition-all text-left cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="mt-auto pt-4 border-t border-slate-200/80">
              <div className="rounded-xl bg-indigo-50/80 border border-indigo-100 p-3 text-[11px] text-indigo-900 space-y-1">
                <div className="font-semibold flex items-center gap-1 text-indigo-950">
                  <Zap className="h-3 w-3 text-indigo-600" />
                  <span>Vitest Suite Status</span>
                </div>
                <div className="text-slate-600">
                  36 unit & integration tests passing with 100% coverage across core libraries.
                </div>
              </div>
            </div>
          </aside>

          {/* Right Content Area */}
          <main className="flex-1 p-6 overflow-y-auto bg-white space-y-6">
            {/* TAB: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">RepoPilot Overview</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    RepoPilot is a precision-engineered developer platform that decouples autonomous AI code generation from Pull Request evaluation. Rather than holding synchronous connections or suffering silent agent scope drift, RepoPilot enforces rigorous mathematical contracts, strict file boundaries, and automated remediation feedback loops.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-indigo-100 bg-indigo-50/30 shadow-none">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">1</span>
                        <CardTitle className="text-sm font-semibold text-slate-900">Stage 1: Intake & Jules Dispatch</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="text-xs text-slate-600 space-y-2">
                      <p>Developer inputs task requirements, file boundaries, and acceptance criteria.</p>
                      <p>Compiles an anti-drift markdown contract with embedded metadata and dispatches directly to an asynchronous Google Jules session.</p>
                    </CardContent>
                  </Card>

                  <Card className="border-emerald-100 bg-emerald-50/30 shadow-none">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">2</span>
                        <CardTitle className="text-sm font-semibold text-slate-900">Stage 2: Gemini Audit & Remediation</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="text-xs text-slate-600 space-y-2">
                      <p>Ingests the PR diff and reconstitutes criteria from embedded PR comments or local vault.</p>
                      <p>Gemini audits the diff against criteria, calculates blast radius, and provides 1-click automated re-dispatch to Jules on the audited branch.</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Quickstart Workflow</h4>
                  <ol className="list-decimal list-inside text-xs text-slate-600 space-y-2 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <li><strong>Configure API Keys (Optional):</strong> Set <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">GEMINI_API_KEY</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">JULES_API_KEY</code>, and <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">GITHUB_PAT</code> in the Credentials modal or in <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">.env.local</code>.</li>
                    <li><strong>Inspect or Load Demo PR (simulation):</strong> Switch to Stage 2 and click &quot;Load Demo PR (simulation)&quot; to test diff sanitization, criteria verification, and the scorecard without a live Jules job.</li>
                    <li><strong>Automate Jules Remediation:</strong> In the scorecard, review the actionable remediation prompt and click &quot;Auto-Dispatch to Jules Session&quot; to instruct Jules to commit fixes directly to the audited branch.</li>
                  </ol>
                </div>
              </div>
            )}

            {/* TAB: ARCHITECTURE */}
            {activeTab === 'architecture' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Decoupled Operating Architecture</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    Unlike naive code generation interfaces that stream edits in real time over fragile HTTP sessions, RepoPilot adopts a <strong>stateless request-response lifecycle</strong>.
                  </p>
                </div>

                {/* Architecture Flow Diagram */}
                <div className="bg-slate-950 rounded-xl p-5 text-slate-100 font-mono text-xs overflow-x-auto shadow-inner space-y-2 border border-slate-800">
                  <div className="text-indigo-400 font-bold mb-2">{'// REPOPILOT DECOUPLED LIFECYCLE FLOW'}</div>
                  <pre className="leading-relaxed">
{`+-----------------------+           +-----------------------------+
| 1. Objective & Scope  |  compile  |  Anti-Drift Contract        |
| - Target Boundaries   | --------> |  - Zero-tolerance bounds   |
| - Acceptance Criteria |           |  - AUDIT_BLUEPRINT comment  |
+-----------------------+           +-----------------------------+
                                                   |
                                                   v  POST /api/jules/dispatch
                                    +-----------------------------+
                                    |  Google Jules Cloud Session |
                                    |  (Asynchronous Agent Work)  |
                                    +-----------------------------+
                                                   |
                                                   v  Opens Pull Request
                                    +-----------------------------+
                                    |  GitHub Pull Request        |
                                    |  with <!-- AUDIT_BLUEPRINT -->|
                                    +-----------------------------+
                                                   |
                                                   v  Stage 2 Ingestion
                                    +-----------------------------+
                                    |  Diff Sanitizer & Parser    |
                                    |  - Token protection         |
                                    |  - Out-of-scope detection   |
                                    +-----------------------------+
                                                   |
                                                   v  POST /api/audit/evaluate
                                    +-----------------------------+
                                    |  Gemini PR Audit & Scorecard|
                                    |  - Metric breakdown         |
                                    |  - Actionable feedback      |
                                    +-----------------------------+
                                                   |
                                                   v  One-click Auto-Dispatch
                                    +-----------------------------+
                                    |  Jules Remediation Session  |
                                    |  (Targets audited branch)   |
                                    +-----------------------------+`}
                  </pre>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Key Architectural Safeguards</h4>
                  <ul className="space-y-2 text-xs text-slate-600">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Asynchronous Cloud Decoupling:</strong> Jules works independently in Google Cloud. If your browser closes or network drops, Jules completes work uninterrupted.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>State Hydration via PR Comment:</strong> Criteria are embedded in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">&lt;!-- AUDIT_BLUEPRINT --&gt;</code>, allowing Stage 2 to hydrate criteria directly from GitHub even if local storage is cleared.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Branch Targeting Precision:</strong> Remediation explicitly mandates <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">startingBranch</code> so fixes land on the existing PR branch rather than spawning duplicate branches.</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* TAB: ANTI-DRIFT COMPILER */}
            {activeTab === 'antidrift' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Anti-Drift Compiler & Boundary Defense</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    Autonomous agents frequently introduce unwanted changes: touching dependency lockfiles, reformatting unrelated code, or modifying core infrastructure files. RepoPilot eliminates this through multi-tiered boundary enforcement.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">The Anti-Drift Contract Rules</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
                      <div className="p-3 bg-white rounded-lg border border-slate-200">
                        <div className="font-semibold text-slate-900">1. Strict File Boundaries</div>
                        <div className="text-[11px] text-slate-500 mt-1">Agent is explicitly forbidden from modifying files outside declared path globs (e.g. <code className="font-mono">src/middleware/**</code>).</div>
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-slate-200">
                        <div className="font-semibold text-slate-900">2. Dependency Manifest Freeze</div>
                        <div className="text-[11px] text-slate-500 mt-1">Zero modifications to <code className="font-mono">package.json</code>, lockfiles, or build configs unless explicitly mandated.</div>
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-slate-200">
                        <div className="font-semibold text-slate-900">3. No Tangential Refactoring</div>
                        <div className="text-[11px] text-slate-500 mt-1">Prohibits unsolicited code cleanup, cosmetic whitespace changes, or renaming existing public APIs.</div>
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-slate-200">
                        <div className="font-semibold text-slate-900">4. Minimal Diff Principle</div>
                        <div className="text-[11px] text-slate-500 mt-1">Directs the agent to produce surgical, readable, and highly focused git commits.</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-900">Diff Sanitization Rules</h4>
                    <p className="text-xs text-slate-600">
                      Before the pull request diff is sent to the Gemini audit model, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">lib/diff-sanitizer.ts</code> filters out noise:
                    </p>
                    <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                      <li>Lockfiles (<code className="font-mono">package-lock.json</code>, <code className="font-mono">yarn.lock</code>, <code className="font-mono">bun.lockb</code>) are excluded from the prompt to conserve token budget.</li>
                      <li>Binary assets (images, fonts, archives) are ignored.</li>
                      <li>Build output (<code className="font-mono">dist/</code>, <code className="font-mono">.next/</code>, <code className="font-mono">coverage/</code>) is scrubbed.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: JULES INTEGRATION */}
            {activeTab === 'jules' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      User Guide & Precision Playbook
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500 font-mono">/docs/USER_GUIDE_JULES_AUTOMATION.md</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">
                    Google Jules Automation & Accuracy Control Plane
                  </h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    <strong>Google Jules</strong> is Google&apos;s cloud-native asynchronous coding agent that executes tasks directly in repository sandboxes. RepoPilot serves as the <strong>precision control plane and automated quality assurance layer</strong>, converting open-ended requests into mathematically bounded, verified outcomes.
                  </p>
                </div>

                {/* How the loop actually works (operator-true, no measured rates) */}
                <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/70 via-slate-50/50 to-white p-4 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-indigo-600" />
                      How Review Works Here
                    </span>
                  </div>
                  <ul className="text-xs text-slate-700 leading-relaxed list-disc list-inside space-y-1">
                    <li>Two stages: dispatch contract → wait for PR → evaluate → continue or new session with brief.</li>
                    <li>Sanitizer outranks the model: unauthorizedPaths nonempty → −35 and never READY_TO_MERGE.</li>
                    <li>Continue Jules session posts FailureBrief to the same session; New session with brief omits automationMode and locks startingBranch to the PR head.</li>
                    <li>READY sends nothing. Every send is a click.</li>
                    <li>Local gate: npm test && npx tsc --noEmit.</li>
                  </ul>
                </div>

                {/* The 4-Step Accuracy Control Plane */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    The 4-Step Jules Accuracy Lifecycle
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700">
                    <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        <span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px]">1</span>
                        Anti-Drift Prompt Compilation
                      </div>
                      <p className="text-slate-600 leading-relaxed">
                        Declares strict POSIX boundary globs (<code className="font-mono text-[11px]">src/middleware/**</code>) and embeds machine-readable <code className="font-mono text-[11px]">&lt;!-- AUDIT_BLUEPRINT --&gt;</code> metadata that travels with the PR.
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        <span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px]">2</span>
                        Asynchronous Cloud Dispatch
                      </div>
                      <p className="text-slate-600 leading-relaxed">
                        Calls <code className="font-mono text-[11px]">https://jules.googleapis.com/v1alpha/sessions</code> to run in Google&apos;s cloud sandbox without blocking your machine or risking dropped network streams.
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        <span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px]">3</span>
                        Gemini PR Diff Audit
                      </div>
                      <p className="text-slate-600 leading-relaxed">
                        Strips lockfiles and build noise, evaluates the resulting PR against each criterion, extracts line citations, and calculates a 0-100 Merge Scorecard.
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        <span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px]">4</span>
                        Closed-Loop Auto-Remediation
                      </div>
                      <p className="text-slate-600 leading-relaxed">
                        If score &lt; 80, 1-click auto-dispatch instructs Jules to checkout the active PR branch (<code className="font-mono text-[11px]">startingBranch: headBranch</code>) and commit fixes directly.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Jules Prompting Playbook */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Jules Prompt Engineering Golden Rules
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-600">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Single Responsibility:</strong> Scope Jules tasks to one cohesive concern (e.g. &quot;Add Redis rate limiting to auth route&quot; rather than &quot;Redesign auth and database&quot;).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Explicit Boundary Globs:</strong> Always provide at least one source pattern (<code className="font-mono">src/services/**</code>) and one test pattern (<code className="font-mono">tests/services/**</code>).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Verifiable Criteria:</strong> Write criteria that can be verified by a unit test or line of code rather than subjective quality claims.</span>
                    </li>
                  </ul>
                </div>

                {/* Prerequisites & Diagnostic Tool */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Prerequisites & Diagnostic Tool</h4>
                  <ol className="list-decimal list-inside text-xs text-slate-600 space-y-1.5">
                    <li>
                      <strong>Google Jules API Key:</strong> Visit <a href="https://jules.google.com/settings" target="_blank" rel="noreferrer" className="text-indigo-600 underline font-medium">jules.google.com/settings</a>.
                    </li>
                    <li>
                      <strong>Authorize GitHub Repositories:</strong> Connect your repository in <a href="https://jules.google.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline font-medium">jules.google.com</a>.
                    </li>
                    <li>
                      <strong>Built-in Troubleshooting:</strong> If dispatch returns 401 or 403, click <strong>&quot;Troubleshoot Jules&quot;</strong> in Stage 1 to inspect authorized GitHub sources retrieved via <code className="font-mono text-xs">/api/jules/sources</code>.
                    </li>
                  </ol>
                </div>
              </div>
            )}

            {/* TAB: AUDIT & SCORECARD */}
            {activeTab === 'audit' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Gemini PR Audit & Merge Readiness Scorecard</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    The audit engine analyzes sanitized PR diffs against the declared acceptance criteria using Gemini with strict JSON schema validation. The model authors prose and per-criterion gaps; the server computes the official <strong>grade</strong> (`criteria − scope = total`) and the UI renders it.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-950">
                    <div className="font-bold text-xs">READY TO MERGE</div>
                    <div className="text-[11px] text-emerald-800 mt-1">In-scope, no UNMET, no PARTIAL, score ≥ 85</div>
                    <div className="text-[11px] text-emerald-700 mt-1">Headline score is criteria fulfillment minus a flat −35 if any unauthorized path. Change risk is shown beside the score, not inside it.</div>
                  </div>
                  <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-950">
                    <div className="font-bold text-xs">NEEDS REVISION</div>
                    <div className="text-[11px] text-amber-800 mt-1">Open criteria, PARTIAL work, or out-of-scope files with score ≥ 40</div>
                    <div className="text-[11px] text-amber-700 mt-1">Next step is usually revert out-of-scope files, then remediate remaining criteria on the audited branch.</div>
                  </div>
                  <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-950">
                    <div className="font-bold text-xs">BLOCKED</div>
                    <div className="text-[11px] text-red-800 mt-1">Score &lt; 40 when out-of-scope or any UNMET</div>
                    <div className="text-[11px] text-red-700 mt-1">Do not merge. Address blockers before another dispatch. One unauthorized file is enough to prevent READY.</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900">How to read the grade</h4>
                  <ul className="text-xs text-slate-600 leading-relaxed list-disc list-inside space-y-1">
                    <li><strong>Score:</strong> <span className="font-mono">criteria − scope = total</span> (PARTIAL counts half, out-of-scope costs −35).</li>
                    <li><strong>Change risk:</strong> severity-grounded — critical files (<span className="font-mono">package.json</span>, lockfiles, <span className="font-mono">Dockerfile</span>, <span className="font-mono">.env</span>, configs, migrations, auth/security) force HIGH; non-critical drift is MEDIUM; otherwise volume bands 150/500. <span className="font-mono">· model</span> means line stats were unavailable.</li>
                    <li><strong>Why / Next:</strong> up to 3 reasons plus <span className="font-mono">merge / revert_scope / remediate / blocked</span> with the audited branch.</li>
                    <li><strong>Criteria:</strong> decision order UNMET → PARTIAL → MET, categories joined from Stage 1 (<span className="font-mono">CRIT-1/01/1</span> normalize). <span className="font-mono">· unverified</span> refs were cited but absent from the diff.</li>
                    <li><strong>Truncated:</strong> diffs cut for token budget warn “risk may be understated” — fetch the full diff before merging a borderline score.</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900">Automated Remediation Loop</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    When issues are found, the scorecard constructs an actionable markdown remediation contract containing line-by-line code evidence, <strong>Remaining</strong> gaps (and <strong>Satisfied</strong> progress for PARTIAL), list of files to revert, change-risk context, and explicit branch directives. The user can edit the prompt or click <strong>Auto-Dispatch to Jules Session</strong> to dispatch the fix immediately.
                  </p>
                </div>
              </div>
            )}

            {/* TAB: TEST SUITE & CI */}
            {activeTab === 'testing' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Comprehensive Test Suite & CI Guide</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    RepoPilot includes a comprehensive, high-speed test suite powered by <strong>Vitest</strong>. It covers 100% of the core compiler, diff parser, sanitization rules, and API routes.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl p-4 text-slate-100 font-mono text-xs space-y-3">
                  <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                    <span>CLI Commands</span>
                    <button
                      onClick={() => copyToClipboard('npm test', 'npm-test')}
                      className="flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
                    >
                      {copiedSnippet === 'npm-test' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      <span>Copy</span>
                    </button>
                  </div>
                  <pre className="text-emerald-400"># Run full test suite once</pre>
                  <pre>npm test</pre>
                  <pre className="text-emerald-400 mt-2"># Run tests in watch mode during development</pre>
                  <pre>npm run test:watch</pre>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Test File Coverage</h4>
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs text-slate-700">
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/prompt-compiler.test.ts</span>
                      <span className="text-slate-500">7 tests · Anti-drift contract generation & blueprint parsing</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/diff-sanitizer.test.ts</span>
                      <span className="text-slate-500">13 tests · Lockfile exclusions, glob matching, hunk parsing</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/jules-dispatch.test.ts</span>
                      <span className="text-slate-500">4 tests · Dispatch validation, dry runs, startingBranch logic</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/remediation-workflow.test.ts</span>
                      <span className="text-slate-500">2 tests · Audited branch preservation & remediation contracts</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/audit-engine.test.ts</span>
                      <span className="text-slate-500">4 tests · Diff ingestion & evaluation validation</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/gemini-scoring.test.ts</span>
                      <span className="text-slate-500">3 tests · Score calculation, penalty weights, blast radius</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="font-mono text-indigo-700">__tests__/blueprint-vault.test.ts</span>
                      <span className="text-slate-500">3 tests · Blueprint serialization & deduplication</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: API REFERENCE */}
            {activeTab === 'api' && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">API Endpoint Reference</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    Internal Next.js server-side API routes powering the RepoPilot engine.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="indigo">POST</Badge>
                      <span className="font-mono text-xs font-bold text-slate-900">/api/jules/dispatch</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Dispatches an autonomous coding session to Google Jules or creates a simulated local dry-run blueprint.
                    </p>
                    <div className="text-[11px] font-mono text-slate-500 bg-white p-2.5 rounded border border-slate-200">
                      Request: &#123; repo, baseBranch, branchName, startingBranch, fileBoundaries, objective, criteria, isRemediation, customPrompt, dryRun &#125;
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="indigo">GET</Badge>
                      <span className="font-mono text-xs font-bold text-slate-900">/api/jules/sources</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Inspects authorized GitHub repositories in the authenticated Google Jules cloud account.
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="success">POST</Badge>
                      <span className="font-mono text-xs font-bold text-slate-900">/api/audit/fetch-diff</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Fetches diffs from GitHub Pull Requests (or accepts raw text), strips noise, and sanitizes out-of-scope files.
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="success">POST</Badge>
                      <span className="font-mono text-xs font-bold text-slate-900">/api/audit/evaluate</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Evaluates sanitized diff against acceptance criteria using Gemini with strict JSON schema outputs.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50/80 text-xs text-slate-500">
          <span>RepoPilot Autonomous Agent Platform</span>
          <Button size="sm" onClick={onClose} className="bg-slate-900 hover:bg-slate-800 text-white cursor-pointer">
            Close Guide
          </Button>
        </div>
      </div>
    </div>
  );
}
