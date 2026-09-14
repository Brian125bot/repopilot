# Changelog

## Unreleased

- Added security headers (`Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`) via `vercel.json` and `next.config.ts` for hosted hybrid Vercel deployments.
- Documented public empty-environment contract across `.env.example` and `SECURITY.md`: public Vercel projects MUST leave `JULES_API_KEY`, `GEMINI_API_KEY`, and `GITHUB_PAT` unset to ensure multi-user credential isolation.

## 1.0.1 — 2026-09-14

First tagged update to the frozen two-stage loop. Everything below shipped between the `v1.0.0` tag and this release: operator-in-the-loop Continue-with-brief remediation, first-pass intake quality gates, grounded server-side grading, and a dual-runtime vault with grounded PR verification.

### Continue-with-brief remediation (operator-in-the-loop)

- 1.0.0 froze the two-stage loop and the Outcome Memory libraries (`buildFailureBrief`, `compileContinuationPrompt`, outcome log turns).
- Continue-with-brief wired as the primary blocked-audit action: **Continue Jules session** (`POST /api/jules/message` + FailureBrief) with **New session with brief** fallback (remediation dispatch, same brief, same PR branch, `automationMode` omitted). Operator stays in the loop; Evaluate is still a click.
- `lastBrief` persisted across Stage 2 hydration and vault round-trips so remediation resumes without re-audit; fallback paths documented in the user guide.

### First-pass intake gates & deep repo grounding

- Contract lint and a pre-dispatch gate with grounded prompts, category coverage, and a definition-of-done self-check; always-strict criteria.
- Deep repo inspection: recursive tree, test-command detection, and framework detection feed boundary generation; criteria are validated against the real tree.
- First-pass analytics recorded in the outcome log.
- Verification contract is local-only: `npm ci && npm test && npx tsc --noEmit`. GitHub Actions is intentionally omitted; historical failed checks on older commits are obsolete.

### Grounded server grade & decision-first scorecard

- Server is the single truth for merge readiness: `report.grade` computed in `/api/audit/evaluate` via `attachAuditGrade()` (the UI renders it, recomputing only for old cached reports).
- Headline math unchanged (`criteria − scope = total`, flat −35, `READY` only in-scope + all MET + ≥85) but owned once by `computeScorecardMetrics()`.
- Granularity: `satisfiedAspects` / `remainingWork` per criterion, normalized category join (`CRIT-1`/`01`/`1`), category rollup, `MET/PARTIAL/UNMET of total` chips, decision-first ordering (UNMET → PARTIAL → MET).
- Accuracy: sanitizer-outranks-model scope union (`unionUnauthorizedPaths`), `path:lines` validation (`unverifiedReferences` = “cited, not in diff”), truncation contract (sanitizer 100k / evaluate 80k, `diffFacts.truncated/shownChars` + UI warning).
- Relevance: severity-grounded change risk (critical files → `HIGH`, non-critical drift → `MEDIUM`, volume bands otherwise), `Why this grade[≤3]` + `Next: merge/revert_scope/remediate/blocked`, enriched remediation prompt (`Score`, `Next`, `Change Risk`, `Remaining`/`Satisfied`/`Category`), grade-aware `FailureBrief` and outcome log.
- UI split: `MergeScorecard` orchestrates new `components/scorecard/{ScoreHeader,WhyNextCard,ScopeRiskCoverageGrid,CriteriaMatrix}`.

### Grounded verification & dual-runtime vault

- **Grounded mergeability**: PR ingestion reads GitHub check runs + `mergeable` state (`githubStatus`); conflicts or failing checks cap `READY_TO_MERGE` at `NEEDS_REVISION` with named reasons and a Checks & Branch Health widget.
- **Tree-grounded boundaries**: generation validates suggested globs against the real git tree, rejects hallucinations (`rejectedGlobs`), falls back to real top-level dirs.
- **Unified diff budget**: one shared 90k-char budget with reserved per-file allocation, hunk-aware cuts, and omission headers; secondary model-side slicing removed.
- **Dual-runtime vault**: `GET`/`POST`/`DELETE /api/vault` backed by local `.repopilot/vault.json` or Upstash REST; server-first hydration with localStorage fallback.
- **Resilient polling**: tiered 15s → 30s → 60s backoff (25-min cap), instant refresh on tab-visible, Check Session Status button, PR-detected handoff toast, harvest-to-vault recovery.
- Remediation now requires the audited PR head (400 otherwise — no `main` fallback); live dispatches persist only real Jules session ids (`dry_` ids for dry runs, 502 when Jules returns none).

### Tests

- 38 files / 361 tests green under the local gate (`npm ci && npm test && npx tsc --noEmit`), including `audit-grade` (34), `audit-server-grade` (8), `remediation-prompt-quality` (27), `contract-lint` (12), and `merge-readiness` (12).

## 1.0.0

First curated release of the Jules → audit loop.

- Outcome Memory libraries (`buildFailureBrief`, `compileContinuationPrompt`, outcome log turns), deterministic scoring (`computeScorecardMetrics`, scope-forced reconciliation), and fail-closed dispatching (key/source/branch validation, no fabricated session ids).
- Stage 1 starts empty; **Load sample** restores the rate-limiter contract. Dry-run and Load Demo PR are labeled as simulation.
- Navbar job chrome: idle / watching / PR ready / last verdict.
- Operator copy: dispatch, wait for PR, audit, fix. Two stages remain.
- Session watch (15s, 20 min, tab-visible) and GitHub PR lookup by head branch.
- Gemini User-Agent `RepoPilot/1.0`. Evaluate route `maxDuration` 60s with retryable timeout.
- Local gate: `npm ci && npm test && npx tsc --noEmit`.
- LICENSE (MIT), SECURITY.md, [golden path](./docs/GOLDEN_PATH.md).
