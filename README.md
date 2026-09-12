# RepoPilot: Autonomous Agent Orchestrator & PR Audit Engine

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-15.3-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-1.0.0-brightgreen?style=flat-square&logo=vitest)](https://vitest.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-PR%20Audit%20Engine-8E75B2?style=flat-square&logo=google)](https://ai.google.dev/)
[![Jules](https://img.shields.io/badge/Google%20Jules-Async%20Cloud%20Agent-4285F4?style=flat-square&logo=googlecloud)](https://jules.google.com/)

**Decoupled Autonomous Agent Architecture with Mathematical Anti-Drift Boundary Enforcement and Closed-Loop Pull Request Remediation**

</div>

---

## 📚 Documentation Hub

RepoPilot **1.0.0** documentation:

- 🚀 **[Golden path (6 steps)](./docs/GOLDEN_PATH.md)**: Settings keys → connected repo → dispatch → wait/audit PR → evaluate → same-branch fix.
- 📖 **[Google Jules User Guide & Automation Playbook](./docs/USER_GUIDE_JULES_AUTOMATION.md)**: How RepoPilot organizes task contracts and the review loop with Jules.
- ⚙️ **[Technical Systems Specification](./docs/TECHNICAL_SPECIFICATION.md)**: Architecture, diff parsing, glob compilation, hydration, Gemini schema, threat model.
- 🧪 **[Testing Strategy & CI/CD Guide](./docs/TESTING_STRATEGY.md)**: Vitest conventions. CI runs `npm test`, `tsc`, `eslint`, and `next build`.
- 📐 **[System Architecture](./ARCHITECTURE.md)**: Sequence flows and anti-drift rules.
- 🔐 **[SECURITY.md](./SECURITY.md)**: Browser localStorage keys; the server persists nothing.
- 📄 **[LICENSE](./LICENSE)**: MIT.

---

## Executive Summary: Precision Control Plane for Google Jules

**Google Jules** is Google's cloud-native asynchronous coding agent designed to autonomously tackle engineering tasks directly on GitHub repositories. While Jules provides remarkable raw capabilities, running autonomous agents without guardrails introduces severe challenges:

- **Scope Drift & Hallucinations**: Agents frequently edit out-of-scope files, alter root dependency manifests (`package.json`), and modify build configurations.
- **High Review Friction**: Human reviewers must manually inspect sprawling diffs across dozens of files to verify if all acceptance criteria were met.
- **Rogue Multi-Turn Branches**: Re-prompting Jules manually often creates new divergent branches rather than committing directly to the active pull request.

**RepoPilot** is the **precision control plane and automated quality assurance layer** for Google Jules, introducing a strictly decoupled two-stage lifecycle:

1. **Stage 1: Intent, Scope & Jules Cloud Dispatch**: Developers formulate crisp acceptance criteria and declared file boundary globs. RepoPilot compiles an anti-drift markdown contract (with embedded blueprint metadata) and dispatches asynchronously to Google Jules Cloud Agents with fail-closed error handling.
2. **Stage 2: Gemini PR Audit & Autonomous Remediation**: Upon PR creation, RepoPilot fetches the diff, sanitizes lockfiles and build noise, reconstitutes criteria from embedded PR comments, and executes an automated audit using Gemini structured outputs reconciled with deterministic scoring algorithms. If blockers exist, developers can **1-click auto-dispatch** an autonomous remediation prompt instructing Jules to checkout and commit fixes directly to the audited branch.

---

## Why Use RepoPilot with Google Jules?

| Challenge with Raw Jules Prompts | How RepoPilot Solves It | Functional Guarantee |
| :--- | :--- | :--- |
| **Agent touches unrelated files** | Strict glob boundaries (`src/middleware/**`, `tests/**/*.test.ts`) parsed via regex without false prefix matches | Deterministic rejection of out-of-scope file modifications |
| **Vague acceptance criteria** | Structures requirements into atomic criteria across functional, security, and performance categories | Every criterion receives explicit evidence and status (`MET`, `PARTIALLY_MET`, `UNMET`) |
| **Manual PR review bottleneck** | Automated Gemini evaluation produces per-criterion verdicts with exact line citations | Structured audit report with actionable recommendations and blocker breakdown |
| **Remediation creates rogue branches** | Auto-Remediation strictly preserves `startingBranch: prMetadata.headBranch` | Commits directly to active PR branch with fail-closed API dispatch |
| **Lockfiles blow out token context** | Automatically strips `package-lock.json`, `pnpm-lock.yaml`, and minified assets from diff payloads | Zero lockfile tokens forwarded to LLM evaluation context |

---

## Architectural Blueprint

```
+----------------------------------------------------------------------------------------+
|                                    STAGE 1: INTAKE & DISPATCH                          |
|                                                                                        |
|   +---------------------+        +-----------------------+      +------------------+   |
|   |  Task Objective &   | -----> | Anti-Drift Compiler   | ---> | Google Jules API |   |
|   |  Acceptance Criteria|        | - Strict Boundary Reg |      | (Async Agent)    |   |
|   |  - Target Globs     |        | - Blueprint Comment   |      | sessions.create  |   |
|   +---------------------+        +-----------------------+      +------------------+   |
+---------------------------------------------------------------------------|------------+
                                                                            |
                                                     Async GitHub PR Opened |
                                                                            v
+----------------------------------------------------------------------------------------+
|                                    STAGE 2: AUDIT & REMEDIATION                        |
|                                                                            v           |
|   +---------------------+        +-----------------------+      +------------------+   |
|   | GitHub Pull Request | -----> | Diff Sanitizer Engine | ---> | Gemini Evaluator |   |
|   | - Commits & Diff    |        | - Strips lockfiles    |      | - Criteria tests |   |
|   | - Blueprint comment |        | - Bounds verification |      | - Blast radius   |   |
|   +---------------------+        +-----------------------+      +------------------+   |
|                                                                            |           |
|                                                                            v           |
|   +------------------------------------+                         +------------------+  |
|   | Closed-Loop Remediation Dispatch   | <---------------------- | Merge Readiness  |  |
|   | Targets: PR audited branch directly|                         | Scorecard (0-100)|  |
|   +------------------------------------+                         +------------------+  |
+----------------------------------------------------------------------------------------+
```

---

## Key Capabilities

### 1. Mathematical Anti-Drift Boundary Enforcement
- Enforces strict file boundary globs (e.g. `src/middleware/**`, `tests/**/*.test.ts`).
- Detects unauthorized file touches (e.g. lockfiles, root build configs, unrelated modules).
- Automatically sanitizes noise, package-lock diffs, and generated artifacts to protect token budgets.

### 2. Google Jules Cloud Agent Integration
- Native REST integration with `https://jules.googleapis.com/v1alpha/sessions`.
- Built-in GitHub organization repository authorization checker (`/api/jules/sources`).
- Local dry-run simulation mode when developing offline or without an API key.

### 3. Gemini Structured Output PR Audit
- Automated evaluation using strict JSON schema validation.
- Per-criterion verification (`MET`, `PARTIALLY_MET`, `UNMET`) with specific line-number evidence.
- Blast radius rating (`LOW`, `MEDIUM`, `HIGH`) and actionable agent directives.

### 4. 1-Click Autonomous Remediation Loop
- If the PR needs revision or is blocked, RepoPilot constructs a specialized remediation prompt.
- **Audited Branch Preservation**: Explicitly targets `startingBranch` so Jules commits fixes directly to the active PR branch instead of creating rogue branches.

---

## Test Suite & Quality Assurance

RepoPilot includes an enterprise-grade test suite built on **Vitest**. All test files reside in `/__tests__/` and run without external dependencies via isolated API mocks and pure-logic verifications.

```bash
# Run the test suite (164 tests across 19 files)
npm test

# Run tests in continuous watch mode during development
npm run test:watch
```

### Test Coverage Matrix

| Suite | File | Tests | Focus Area |
| :--- | :--- | :--- | :--- |
| **Prompt Compiler** | `prompt-compiler.test.ts` | 7 | Anti-drift markdown generation & blueprint comment embedding |
| **Diff Sanitizer** | `diff-sanitizer.test.ts` | 14 | Recursive glob matching (`**`, `*`), prefix rejection, lockfile exclusion |
| **Jules Dispatch** | `jules-dispatch.test.ts` | 36 | API validation, fail-closed 401/404 handling, startingBranch resolution, source binding, automationMode |
| **Jules Session** | `jules-session.test.ts` | 7 | Session poll route, `harvestPullRequest`/`getJulesSession` harvest |
| **Jules Message** | `jules-message.test.ts` | 8 | Follow-up `:sendMessage` lib + route, fail-closed 401/400/404 |
| **GitHub Status** | `github-status.test.ts` | 7 | PAT validation, scopes extraction, rate limits, fail-closed auth handling |
| **Remediation Loop** | `remediation-workflow.test.ts`| 2 | Audited branch targeting, blocker compilation & evidence preservation |
| **Audit Engine** | `audit-engine.test.ts` | 13 | Diff ingestion, branch→PR lookup, evaluate timeout retry |
| **Scoring Logic** | `gemini-scoring.test.ts` | 8 | Score algorithms, scope violation penalties, blast radius ratings, forced scope |
| **Blueprint Vault** | `blueprint-vault.test.ts` | 4 | Local storage serialization, recovery, deduplication & Refresh patch |
| **Outcome Memory** | `outcome-memory.test.ts` | 11 | FailureBrief build + continuation prompt caps |
| **Outcome Log** | `outcome-log.test.ts` | 9 | Append/cap-50/turns/update/export, no aggregates |
| **PR lookup** | `github-pr-lookup.test.ts` | 5 | PR URL / branch ingest parsers, pulls-by-head |
| **Session poll** | `session-poll.test.ts` | 6 | Tab-visible 15s/20min poll stop conditions |
| **Stage handoff** | `stage-handoff.test.ts` | 5 | Prefill real PR URL, vault match |
| **Sample contract** | `sample-contract.test.ts` | 3 | Empty Stage 1 defaults, Load sample rate-limiter |
| **Job status** | `job-status.test.ts` | 5 | idle / watching / PR ready / last verdict |
| **Evaluate timeout** | `evaluate-timeout.test.ts` | 3 | Timeout → retry payload, maxDuration |
| **1.0 release** | `v1-release.test.ts` | 3 | Version, LICENSE, SECURITY, CI, no credential logs |

---

## Quickstart & Installation

### Prerequisites
- Node.js 20+
- npm or yarn

### Setup Instructions

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/Brian125bot/repopilot.git
cd repopilot
npm ci

# 2. (Optional) Configure environment variables in .env.local
cp .env.example .env.local

# 3. Start development server on port 3000
npm run dev

# 4. Run test suite to verify installation
npm test
```

Open [http://localhost:3000](http://localhost:3000) to view the RepoPilot application.

### After 1.0

Not in this release: GitHub Action CI gating, auto-merge, webhooks/Cron, accounts/teams, multi-agent arbitration, auto-evaluate when a PR appears.

### Hosted Use (Vercel, no server setup)

RepoPilot runs fully hosted with **zero environment variables**. Each user brings their own keys in the browser:

1. Deploy with the Vercel Next.js preset (`npm ci` → `npm run build`). No env vars required.
2. Open the deployed URL. A welcome banner offers **Configure API keys** — Jules, Gemini, and GitHub PAT are entered in the in-app Settings modal, stored only in that browser's `localStorage`, and sent per-request via `x-jules-api-key`, `x-gemini-api-key`, `x-github-pat` headers. The server persists nothing, so one deployment serves many users.
3. No Jules key yet? Tick **Dry-run (no Jules key needed)** on the Stage 1 dispatch card to simulate a dispatch locally, or use **Load Demo PR** in Stage 2.

---

## Environment Variables

All optional. On a hosted deployment you can skip this section entirely and enter keys in the app's Settings modal instead.

| Variable | Description | Required | Default |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API key for PR audit evaluation | Optional (can enter in UI) | Server-side only |
| `JULES_API_KEY` | Google Jules API key for asynchronous cloud agent dispatch | Optional (dry-run available) | Client or Server |
| `GITHUB_PAT` | GitHub Personal Access Token for private repository diffs | Optional (public repos work without PAT) | Optional |

> **Note on Security:** Credentials can be saved in the client's local storage via the in-app Credentials modal. When configured, keys are sent in secure custom request headers (`x-jules-api-key`, `x-gemini-api-key`, `x-github-pat`) and are never written to server logs.

---

## API Reference

### `POST /api/jules/dispatch`
Dispatches a new coding session to Google Jules or saves a local dry-run blueprint.

**Payload:**
```json
{
  "repo": "acme-corp/api-gateway",
  "baseBranch": "main",
  "branchName": "jules/rate-limiter",
  "startingBranch": "jules/rate-limiter",
  "fileBoundaries": ["src/middleware/**", "tests/**"],
  "objective": "Implement Redis sliding window rate limiter",
  "criteria": [
    { "id": "1", "text": "Extracts client IP", "category": "functional" }
  ],
  "isRemediation": false,
  "dryRun": false
}
```

### `GET /api/jules/sources`
Lists authorized GitHub repositories connected to your Google Jules cloud account.

### `GET /api/jules/session?id=sessions/xxx`
Reads a Jules session back (`getJulesSession`), returning `sessionId`, `sessionUrl`, `state`, and harvested `prUrl/prTitle`. Fail-closed `401` without a key, `400` without an id. Use from the Stage-1 confirmation **Refresh session** button after dispatch.

### `GET /api/github/status`
Validates a GitHub Personal Access Token (PAT) supplied via `x-github-pat` header or server environment, returning authenticated user identity, scopes, and hourly rate limit consumption.

### `POST /api/audit/fetch-diff`
Fetches a GitHub pull request diff, parses commit hunks, and applies noise-reduction filters.

### `POST /api/audit/evaluate`
Audits the sanitized pull request diff against declared acceptance criteria and returns a structured scorecard. Accepts `unauthorizedPaths: string[]` from the sanitizer — any entry forces `scopeIntegrity.strictlyInScope=false` via `forceScopeIntegrity` (empty = clean, omitted = unverified).

---

## License & Attribution

Designed and maintained for mission-critical autonomous agent workflows.
Built with Next.js, Tailwind CSS, Lucide Icons, Vitest, and Google Gemini.
