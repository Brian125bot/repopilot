# RepoPilot: Autonomous Agent Orchestrator & PR Audit Engine

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-15.3-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-36%20tests%20passing-brightgreen?style=flat-square&logo=vitest)](https://vitest.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-PR%20Audit%20Engine-8E75B2?style=flat-square&logo=google)](https://ai.google.dev/)
[![Jules](https://img.shields.io/badge/Google%20Jules-Async%20Cloud%20Agent-4285F4?style=flat-square&logo=googlecloud)](https://jules.google.com/)

**Decoupled Autonomous Agent Architecture with Mathematical Anti-Drift Boundary Enforcement and Closed-Loop Pull Request Remediation**

</div>

---

## Executive Summary

**RepoPilot** solves the fundamental flaw of agentic software engineering: **scope drift, ungrounded hallucinations, and fragile synchronous streaming**. Naive AI coding tools stream diffs over synchronous web connections, frequently edit out-of-scope files, alter root dependency manifests, and leave humans with unverified, broken pull requests.

RepoPilot introduces a **strictly decoupled two-stage lifecycle**:

1. **Stage 1: Intent, Scope & Jules Cloud Dispatch**: Developers formulate crisp acceptance criteria and declared file boundary globs. RepoPilot compiles an anti-drift markdown contract (with embedded cryptographic blueprint metadata) and dispatches asynchronously to Google Jules Cloud Agents.
2. **Stage 2: Gemini PR Audit & Autonomous Remediation**: Upon PR creation, RepoPilot fetches the diff, sanitizes lockfiles and build noise, reconstitutes criteria from embedded PR comments, and executes an automated audit using Gemini structured outputs. If blockers exist, developers can **1-click auto-dispatch** an autonomous remediation prompt instructing Jules to checkout and commit fixes directly to the audited branch.

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
# Run the entire test suite (36 tests across 7 suites)
npm test

# Run tests in continuous watch mode during development
npm run test:watch
```

### Test Coverage Matrix

| Suite | File | Tests | Focus Area |
| :--- | :--- | :--- | :--- |
| **Prompt Compiler** | `prompt-compiler.test.ts` | 7 | Anti-drift markdown generation & blueprint comment embedding |
| **Diff Sanitizer** | `diff-sanitizer.test.ts` | 13 | Recursive glob matching (`**`), lockfile exclusion, hunk extraction |
| **Jules Dispatch** | `jules-dispatch.test.ts` | 4 | API route validation, dry-run simulation, startingBranch resolution |
| **Remediation Loop** | `remediation-workflow.test.ts`| 2 | Audited branch targeting, blocker compilation & evidence preservation |
| **Audit Engine** | `audit-engine.test.ts` | 4 | Diff ingestion, error boundaries, evaluation payload validation |
| **Scoring Logic** | `gemini-scoring.test.ts` | 3 | Score algorithms, scope violation penalties, blast radius ratings |
| **Blueprint Vault** | `blueprint-vault.test.ts` | 3 | Local storage serialization, recovery & deduplication |

---

## Quickstart & Installation

### Prerequisites
- Node.js 20+
- npm or yarn

### Setup Instructions

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/example/repopilot.git
cd repopilot
npm install

# 2. (Optional) Configure environment variables in .env.local
cp .env.example .env.local

# 3. Start development server on port 3000
npm run dev

# 4. Run test suite to verify installation
npm test
```

Open [http://localhost:3000](http://localhost:3000) to view the RepoPilot application.

---

## Environment Variables

| Variable | Description | Required | Default |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API key for PR audit evaluation | Optional (can enter in UI) | Server-side only |
| `JULES_API_KEY` | Google Jules API key for asynchronous cloud agent dispatch | Optional (dry-run available) | Client or Server |
| `GITHUB_PAT` | GitHub Personal Access Token for private repository diffs | Optional (public repos work without PAT) | Optional |

> **Note on Security:** Credentials can be saved in the client's local storage via the in-app Credentials modal. When configured, keys are sent in secure custom request headers (`x-jules-api-key`, `x-gemini-api-key`, `x-github-token`) and are never written to server logs.

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

### `POST /api/audit/fetch-diff`
Fetches a GitHub pull request diff, parses commit hunks, and applies noise-reduction filters.

### `POST /api/audit/evaluate`
Audits the sanitized pull request diff against declared acceptance criteria and returns a structured scorecard.

---

## License & Attribution

Designed and maintained for mission-critical autonomous agent workflows.
Built with Next.js, Tailwind CSS, Lucide Icons, Vitest, and Google Gemini.
