# Google Jules Task Automation & Accuracy Playbook
### *How RepoPilot Transforms Google Jules into a High-Precision, Zero-Drift Cloud Coding Machine*

---

## Executive Summary

**Google Jules** is Google's cloud-native asynchronous coding agent designed to autonomously tackle engineering tasks directly on GitHub repositories. While Jules provides remarkable raw capabilities, running autonomous agents without guardrails introduces severe challenges:

- **Scope Creep & Drift**: Agents often touch unrelated configuration files, alter root dependency trees, or refactor files beyond the assigned feature scope.
- **Vague Acceptance Verification**: Human engineers must manually inspect dozens of changed files to determine whether all requirements were satisfied.
- **Fragmented Review Cycles**: If an agent misses a requirement, re-prompting manually often creates rogue branches or overwrites good progress.

**RepoPilot** is the dedicated **precision control plane and automated quality assurance layer** for Google Jules. By pairing mathematical boundary enforcement with automated post-PR Gemini evaluation, RepoPilot guarantees high accuracy, tight blast radii, and completely automated closed-loop remediation.

```
       +--------------------------------------------------------------------------------+
       |                     REPOPILOT PRECISION CONTROL PLANE                         |
       |                                                                                |
       |   1. TASK & SCOPE FORMULATION        2. ANTI-DRIFT COMPILER                    |
       |   +----------------------------+     +-----------------------------------+     |
       |   | - Objective Statement      | --> | - File Boundary Globs (POSIX)     |     |
       |   | - Testable Criteria (1..N) |     | - Auto-Excludes Lockfiles & Noise |     |
       |   | - Target Branch Invariants |     | - Embeds Cryptographic Blueprint  |     |
       |   +----------------------------+     +-----------------------------------+     |
       +---------------------------------------------------|----------------------------+
                                                           |
                                  3. Async Cloud Dispatch  |  POST /v1alpha/sessions
                                                           v
       +--------------------------------------------------------------------------------+
       |                           GOOGLE JULES CLOUD AGENT                             |
       |                                                                                |
       |   - Clones target GitHub repository in cloud sandbox                           |
       |   - Adheres strictly to boundaries defined in compiled prompt                  |
       |   - Generates code, runs lints, and opens GitHub Pull Request                  |
       +---------------------------------------------------|----------------------------+
                                                           |
                                      PR Created on GitHub |  Contains Blueprint Comment
                                                           v
       +--------------------------------------------------------------------------------+
       |                    REPOPILOT AUTOMATED VERIFICATION ENGINE                     |
       |                                                                                |
       |   4. DIFF SANITIZATION ENGINE        5. GEMINI STRUCTURED AUDIT                |
       |   +----------------------------+     +-----------------------------------+     |
       |   | - Parses git diff hunks    | --> | - Tests diff against each criterion|    |
       |   | - Flags out-of-scope files |     | - 0-100 Merge Readiness Scorecard |     |
       |   | - Calculates blast radius  |     | - Line-number evidence extraction |     |
       |   +----------------------------+     +-----------------------------------+     |
       |                                                           |                    |
       |                                    If Score < 80 (Blocked)|                    |
       |                                                           v                    |
       |   6. 1-CLICK AUTONOMOUS REMEDIATION                                            |
       |   - Targets active PR branch directly (`startingBranch`)                       |
       |   - Auto-dispatches fix session to Jules with code evidence & revert commands  |
       +--------------------------------------------------------------------------------+
```

---

## Why Use RepoPilot with Google Jules?

| Challenge with Raw Jules Prompts | How RepoPilot Solves It | Functional Guarantee |
| :--- | :--- | :--- |
| **Agent wanders into other modules** (e.g. touches `package.json` or modifies `tsconfig.json`) | Enforces strict path globs (e.g. `src/features/billing/**`) and flags unauthorized file touches | Deterministic rejection of out-of-scope file modifications |
| **Vague, untestable instructions** ("make the auth module secure") | Structures requirements into atomic criteria with testable categories (`functional`, `security`, `performance`) | Every criterion receives explicit evidence and status |
| **Manual PR review overhead** (engineers must read 400 lines of diff to verify 3 requirements) | Gemini automatically audits diff hunks against each criterion, producing pass/fail verdicts with line citations | Structured audit report with actionable recommendations and blocker breakdown |
| **Remediation creates rogue branches** (re-prompting creates `jules/fix-2` instead of updating PR) | Automatically locks `startingBranch: prMetadata.headBranch` to push fixes directly onto the active PR | Commits directly to active PR branch with fail-closed API dispatch |
| **Lockfiles exhaust token context** | Automatically strips `package-lock.json`, `pnpm-lock.yaml`, and minified assets from diff payloads | Zero lockfile tokens forwarded to LLM evaluation context |

---

## Step-by-Step Tutorial: Conducting High-Accuracy Jules Tasks

### Step 1: Configure Credentials & Verify Repository Access
1. Open RepoPilot and click **Settings (Gear Icon)** in the top navigation bar.
2. Enter your **Google Jules API Key** (or use Dry-Run Simulation mode if testing offline).
3. (Optional) Provide a **GitHub Personal Access Token (PAT)** if working on private repositories.
4. RepoPilot automatically pings `/api/jules/sources` to confirm which GitHub organizations and repositories your Jules account is authorized to work on.

### Step 2: Formulate Intent in Stage 1 (Intake & Dispatch)
Navigate to **Stage 1: Intent & Jules Cloud Dispatch**:
1. **Target Repository**: Enter `owner/repo` (e.g., `acme-corp/api-gateway`).
2. **Branch Invariants**:
   - `Base Branch`: Branch to branch off of (e.g. `main`).
   - `Target Branch Name`: The branch Jules will create (e.g. `jules/rate-limiter`).
3. **Objective Statement**: A clear high-level description of what Jules should accomplish.
4. **Acceptance Criteria**: Click **"Add Criterion"** to add specific, measurable requirements:
   - *Functional*: "Extracts client IP from `X-Forwarded-For` header or fallback to socket IP."
   - *Functional*: "Implements a 60-second sliding window counter using Redis multi/exec."
   - *Reliability*: "Returns HTTP 429 Too Many Requests with `Retry-After` header when limit is exceeded."
   - *Testing*: "Includes comprehensive unit tests in `tests/middleware/rate-limiter.test.ts`."

### Step 3: Define Anti-Drift File Boundaries
In the **Authorized File Boundaries** section:
- Specify the exact directories or files Jules is permitted to create or modify:
  ```
  src/middleware/rate-limiter.ts
  src/middleware/**
  tests/middleware/**
  ```
- **RepoPilot guarantees**: If Jules touches any file outside these patterns (like `package.json` or `src/server.ts`), RepoPilot's audit engine will immediately flag the infraction and penalize the merge scorecard.

### Step 4: Dispatch the Cloud Session
Click **"Dispatch Session to Google Jules"**:
- RepoPilot binds `owner/repo` to a real `sources[].name` via `GET /v1alpha/sources`. Unconnected repos fail closed with 404 — the source path is never invented.
- First-pass sessions request `AUTO_CREATE_PR`; remediation sessions omit `automationMode` and lock `startingBranch` to the audited branch so fixes push onto the open PR.
- RepoPilot compiles the markdown contract, appends the machine-readable blueprint comment:
  ```html
  <!-- AUDIT_BLUEPRINT
  {
    "blueprintId": "bp_1741720000000",
    "repo": "acme-corp/api-gateway",
    "criteria": [...],
    "fileBoundaries": ["src/middleware/**"]
  }
  -->
  ```
- Dispatches via asynchronous REST call to `https://jules.googleapis.com/v1alpha/sessions`.
- Saves the session blueprint (`sourceName`, `sessionUrl`, `sessionState`, honest empty `prUrl`) into your in-browser **Blueprint Vault** (`localStorage`).
- Returns the Google Jules Cloud Session URL where you can monitor Jules executing live in Google's cloud infrastructure. Use **Refresh session** (`GET /api/jules/session?id=`) on the Stage-1 confirmation card to harvest `state`, `sessionUrl`, and `prUrl/prTitle` once Jules opens a PR.

---

## Post-PR Automated Verification: Stage 2

Once Jules completes its task and submits a Pull Request on GitHub, switch to **Stage 2: Audit & Evaluation**:

### Step 5: Ingest & Sanitize the Pull Request
1. Enter the PR URL or identifier (e.g., `acme-corp/api-gateway/pull/42`).
2. Click **"Ingest & Evaluate PR"** (or click **"Load Demo Pull Request"** to explore with pre-baked realistic data).
3. **Automatic State Hydration**:
   - If the PR description contains the `<!-- AUDIT_BLUEPRINT -->` comment created in Stage 1, RepoPilot extracts it automatically.
   - If missing, RepoPilot hydrates the matching contract from your local **Blueprint Vault**.
   - The **Hydrated Vault Evaluation Contract Card** displays the active contract ID, target branch pairs, and criterion counts.
4. **Diff Sanitization**:
   - Strips package-lock files, generated source maps, and binary diffs.
   - Analyzes all modified file paths against declared globs.
   - Displays blast radius metrics: Additions, Deletions, Net Changes, and File Count.

### Step 6: Gemini-Powered Audit Evaluation
RepoPilot submits the sanitized diff alongside the hydrated acceptance criteria to **Google Gemini**:
- Evaluates each criterion individually and returns:
  - **Verdict**: `MET`, `PARTIALLY_MET`, or `UNMET`.
  - **Evidence**: Concrete code snippets and exact line references from the diff.
  - **Reasoning**: Plain-English explanation of why the criterion passed or failed.
- Evaluates scope integrity:
  - The sanitizer's `unauthorizedPaths` are forwarded as `unauthorizedPaths` to `POST /api/audit/evaluate` and force the verdict via `forceScopeIntegrity` — Gemini cannot override a sanitizer-flagged file back to in-scope. An empty list means clean; omitted means unverified.
  - Lists any unauthorized files modified by Jules.
  - Computes blast radius rating (`LOW`, `MEDIUM`, `HIGH`) with a 35-point scope penalty applied deterministically.
- Computes overall **Merge Readiness Score (0-100)**:
  - **90-100 (Ready to Merge)**: All criteria met, zero out-of-scope files.
  - **70-89 (Needs Revision)**: Minor missing edge cases or formatting issues.
  - **< 70 (Blocked)**: Critical criteria unmet or boundary violations detected.

---

## Closed-Loop Autonomous Remediation

When a PR receives a **Needs Revision** or **Blocked** verdict, do not waste time writing a new prompt from scratch:

1. Scroll to the **Merge Readiness Scorecard** in Stage 2.
2. Click **"Auto-Dispatch Remediation to Jules"**.
3. **What RepoPilot does automatically**:
   - Extracts all unmet criteria and evidence citations.
   - Formulates explicit revert commands for any files outside the declared boundaries.
   - **Locks `startingBranch: prMetadata.headBranch`**: Crucially ensures Jules checks out the active PR branch instead of branching from `main`.
   - Dispatches a new Jules session that commits fixes directly to the open pull request!
4. Once Jules pushes the remediation commit, click **"Re-Evaluate PR"** to see the score update.

---

## Jules Prompt Engineering Playbook

To maximize the first-pass accuracy of Google Jules, follow these battle-tested patterns:

### 1. The "Single Responsibility" Rule
Agents succeed most when tasks are bounded to one cohesive concern. 
- ❌ *Poor*: "Build user authentication, update the database schema, and fix the navbar styling."
- ✅ *Optimal*: "Implement JWT verification middleware with Redis token revocation in `src/middleware/jwt.ts`."

### 2. Formulating Crisp Acceptance Criteria
Every criterion should be verifiable by a unit test or static inspection.
- ❌ *Vague*: "Make the error handling good."
- ✅ *Verifiable*: "Return JSON error response with `{ error: string, code: number }` matching OpenAPI spec when validation fails."

### 3. Strict Boundary Selection
- Always provide at least one source file pattern (e.g. `src/services/billing/**`) and one test file pattern (e.g. `tests/services/billing/**`).
- Never set `**/*` as a boundary unless performing a full-repo migration.
- Restricting boundaries prevents Jules from modifying lockfiles, `package.json`, or environment files.

---

## Accuracy Benchmarks

First-pass rates are not measured yet; do not publish percentages until the outcome log exists.

---

## Frequently Asked Questions

**Q: Do I need a paid Jules account to use RepoPilot?**  
A: RepoPilot supports both live Google Jules API keys and an **Offline Dry-Run Simulation Mode**. In dry-run mode, you can formulate contracts, test anti-drift compilation, save blueprints to the vault, and practice PR evaluations without calling the live Jules API.

**Q: Where does Jules execute?**  
A: Google Jules executes asynchronously in Google's secure cloud infrastructure. It does not run on your local machine, consume your local CPU/RAM, or require you to keep a browser tab open.

**Q: What if Jules doesn't include the blueprint comment in the PR?**  
A: RepoPilot automatically maintains a local **Blueprint Vault** in your browser (`localStorage`). When you open Stage 2, RepoPilot matches the target repository and branch name to automatically hydrate the original contract even if the PR comment was stripped.
