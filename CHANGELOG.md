# Changelog

## Unreleased — grounded audit grade

Server single truth for merge readiness: `report.grade` computed in `/api/audit/evaluate` via `attachAuditGrade()` (UI renders it, recomputes only for old cached reports).

- Headline math unchanged (`criteria − scope = total`, flat −35, `READY` only in-scope + all MET + ≥85) but owned once by `computeScorecardMetrics()`.
- Granularity: `satisfiedAspects` / `remainingWork` per criterion, normalized category join (`CRIT-1`/`01`/`1`), category rollup, `MET/PARTIAL/UNMET of total` chips, decision-first ordering (UNMET → PARTIAL → MET).
- Accuracy: sanitizer-outranks-model scope union (`unionUnauthorizedPaths`), `path:lines` validation (`unverifiedReferences` = “cited, not in diff”), truncation contract (sanitizer 100k / evaluate 80k, `diffFacts.truncated/shownChars` + UI warning).
- Relevance: severity-grounded change risk (critical files → `HIGH`, non-critical drift → `MEDIUM`, volume bands otherwise), `Why this grade[≤3]` + `Next: merge/revert_scope/remediate/blocked`, enriched remediation prompt (`Score`, `Next`, `Change Risk`, `Remaining`/`Satisfied`/`Category`), grade-aware `FailureBrief` and outcome log.
- UI split: `MergeScorecard` orchestrates new `components/scorecard/{ScoreHeader,WhyNextCard,ScopeRiskCoverageGrid,CriteriaMatrix}`.
- Tests: `audit-grade` (34) + `audit-server-grade` (8) cover normalization, severity boundaries (149/150/500/501), validation, truncation, and grade→brief→prompt wiring. Full suite 227+ tests green with `tsc`, `eslint`, `next build`.

## 1.0.0

First curated release of the Jules → audit loop.

- Stage 1 starts empty; **Load sample** restores the rate-limiter contract. Dry-run and Load Demo PR are labeled as simulation.
- Navbar job chrome: idle / watching / PR ready / last verdict.
- Operator copy: dispatch, wait for PR, audit, fix. Two stages remain.
- Session watch (15s, 20 min, tab-visible) and GitHub PR lookup by head branch.
- Gemini User-Agent `RepoPilot/1.0`. Evaluate route `maxDuration` 60s with retryable timeout.
- CI: `npm test`, `tsc --noEmit`, `eslint .`, `next build`.
- LICENSE (MIT), SECURITY.md, [golden path](./docs/GOLDEN_PATH.md).
