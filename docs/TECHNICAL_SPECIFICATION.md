# RepoPilot Technical Specification & Systems Architecture
### *Deep Technical Reference for Autonomous Agent Orchestration, Diff Analysis, and Structured Gemini Auditing*

---

## 1. System Overview & Architectural Paradigm

**RepoPilot** is built on Next.js 15 (App Router), React 19, TypeScript 5, and Tailwind CSS. It replaces fragile, synchronous streaming agent interfaces with a **State-Hydrated, Asynchronously Decoupled Architecture**.

```
+---------------------------------------------------------------------------------------------------+
|                                     CLIENT APPLICATION (Browser)                                  |
|                                                                                                   |
|  +--------------------------------+   +-------------------------------+   +--------------------+  |
|  | Stage 1: Intake & Dispatch     |   | Stage 2: Audit & Remediation  |   | Blueprint Vault    |  |
|  | (IntakeDispatchStage.tsx)      |   | (AuditEvaluationStage.tsx)    |   | (LocalStorage)     |  |
|  +--------------------------------+   +-------------------------------+   +--------------------+  |
|                 |                                     ^                                           |
|                 v                                     |                                           |
+-----------------|-------------------------------------|-------------------------------------------+
                  | REST (JSON)                         | REST (JSON)
                  v                                     |
+---------------------------------------------------------------------------------------------------+
|                                  NEXT.JS API BACKEND (Server Routes)                              |
|                                                                                                   |
|  +-----------------------+  +----------------------+  +---------------------+  +---------------+  |
|  | /api/jules/dispatch   |  | /api/jules/sources   |  | /api/audit/fetch-diff|  | /api/audit/   |  |
|  | (Jules REST Client)   |  | (GitHub Sources)     |  | (Diff Ingest Engine)|  | evaluate      |  |
|  +-----------------------+  +----------------------+  +---------------------+  +---------------+  |
|             |                                                    |                     |          |
+-------------|----------------------------------------------------|---------------------|----------+
              |                                                    |                     |
              v                                                    v                     v
   Google Jules Cloud API                               GitHub REST API             Google Gemini
   (https://jules.googleapis.com)                      (api.github.com)           (Gemini 3.8 Flash)
```

---

## 2. Core Subsystems & Algorithmic Internals

### 2.1 The Anti-Drift Compiler (`lib/prompt-compiler.ts`)

The Anti-Drift Compiler accepts user intent and emits a deterministic Markdown instruction document with embedded machine-readable metadata.

#### Blueprint Embedding Grammar
To ensure the specification survives the asynchronous cloud agent trip, the compiler embeds a base64 or JSON comment header directly into the prompt:

```markdown
<!-- AUDIT_BLUEPRINT
{
  "blueprintId": "bp_1741720000000_a1b2c3",
  "repo": "acme-corp/api-gateway",
  "baseBranch": "main",
  "branchName": "jules/rate-limiter",
  "objective": "Implement Redis sliding window rate limiter",
  "criteria": [
    { "id": "crit_1", "text": "Extracts client IP", "category": "functional" }
  ],
  "fileBoundaries": ["src/middleware/**", "tests/middleware/**"],
  "createdAt": "2026-09-11T12:00:00.000Z"
}
-->
```

#### Extraction Mechanism
When parsing PR bodies returned by GitHub, RepoPilot employs non-greedy regex extraction:
```typescript
export function extractBlueprintFromMarkdown(content: string): Blueprint | null {
  const match = content.match(/<!--\s*AUDIT_BLUEPRINT\s*([\s\S]*?)-->/);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim()) as Blueprint;
  } catch {
    return null;
  }
}
```

---

### 2.2 Diff Sanitizer & Noise Reduction Engine (`lib/diff-sanitizer.ts`)

LLMs have finite context windows and high token costs. Furthermore, large lockfile diffs (such as a 30,000-line `package-lock.json` change) trigger false positives and degrade model reasoning.

#### Boundary Glob Matching Algorithm
RepoPilot converts declared POSIX boundary globs into strict JavaScript `RegExp` objects with recursive wildcard support. See the single implementation in `lib/diff-sanitizer.ts:globToRegex` (do not fork the snippet):

```typescript
export function globToRegex(glob: string): RegExp {
  const normalized = glob.trim().replace(/^\.?\//, '');
  let regexString = '^' + normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
    .replace(/\*\*\//g, '(?:.+/)?')       // **/ matches zero or more directories
    .replace(/\*\*/g, '.*')               // ** matches everything
    .replace(/\*/g, '[^/]*')              // * matches within segment
    .replace(/\?/g, '[^/]');              // ? matches single char
  regexString += '$';
  return new RegExp(regexString);
}
```

#### Lockfile & Noise Detection Patterns
The sanitizer filters out standard dependency locks, coverage reports, and build bundles:
```typescript
const NOISE_FILE_PATTERNS = [
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)bun\.lock(?:b)?$/,
  /(?:^|\/)Cargo\.lock$/,
  /(?:^|\/)composer\.lock$/,
  /(?:^|\/)\.next\//,
  /(?:^|\/)dist\//,
  /(?:^|\/)build\//,
  /(?:^|\/)coverage\//,
  /\.map$/,
  /\.min\.(?:js|css)$/,
];
```

#### Token Budget Capping
If a sanitized diff exceeds `MAX_DIFF_CHARS` (default: 120,000 characters ~ 30,000 tokens), the sanitizer truncates diff hunks per file while preserving the header index, logging the exact truncation point for the auditor.

---

### 2.3 Gemini PR Audit Engine (`app/api/audit/evaluate/route.ts`)

The evaluation engine leverages the Google Gen AI SDK (`@google/genai`) and `gemini-3.8-flash` with strict structured output schemas, reconciled by `reconcileAuditReport(report, unauthorizedPaths)` so the sanitizer outranks the model on scope.

#### Structured Schema Definition
Using `Type.OBJECT` enforcement, Gemini is constrained to return a predictable JSON payload:

```typescript
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.INTEGER, description: "Score from 0 to 100" },
    verdict: {
      type: Type.STRING,
      enum: ["READY_TO_MERGE", "NEEDS_REVISION", "BLOCKED"],
    },
    summary: { type: Type.STRING },
    blastRadius: {
      type: Type.STRING,
      enum: ["LOW", "MEDIUM", "HIGH"],
    },
    criteriaEvaluations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING },
          status: {
            type: Type.STRING,
            enum: ["MET", "PARTIALLY_MET", "UNMET"],
          },
          evidence: { type: Type.STRING },
          reasoning: { type: Type.STRING },
          lineReferences: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["id", "text", "status", "evidence", "reasoning"],
      },
    },
    scopeIntegrity: {
      type: Type.OBJECT,
      properties: {
        withinDeclaredBoundaries: { type: Type.BOOLEAN },
        unauthorizedFiles: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        boundaryAuditSummary: { type: Type.STRING },
      },
      required: ["withinDeclaredBoundaries", "unauthorizedFiles"],
    },
    actionableDirectives: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    "overallScore",
    "verdict",
    "summary",
    "blastRadius",
    "criteriaEvaluations",
    "scopeIntegrity",
    "actionableDirectives",
  ],
};
```

#### Deterministic Scoring Invariants
1. **Scope Penalty**: If `scopeIntegrity.strictlyInScope === false`, `computeScorecardMetrics` applies a deterministic 35-point deduction (`forceScopeIntegrity` outranks the model; empty `unauthorizedPaths` = clean, omitted = unverified).
2. **Criteria Weighting**: Compliance ratio = `(MET + 0.5*PARTIALLY_MET) / total`; scope penalty subtracted, clamped 0–100.
3. **Verdict Gates**: derived from `computeScorecardMetrics` (`READY_TO_MERGE` only when in-scope, no UNMET, no PARTIALLY_MET, score ≥85).

---

### 2.4 Google Jules REST Cloud Dispatcher (`app/api/jules/dispatch/route.ts`)

Jules sessions are created via REST requests to `https://jules.googleapis.com/v1alpha/sessions`.

#### Request Structure:
```json
{
  "prompt": "Full compiled markdown prompt with boundaries and embedded blueprint",
  "title": "[RepoPilot] ...",
  "sourceContext": {
    "source": "sources/xxx (bound via GET /v1alpha/sources, never invented)",
    "githubRepoContext": {
      "startingBranch": "jules/rate-limiter"
    }
  },
  "requirePlanApproval": false,
  "automationMode": "AUTO_CREATE_PR (first-pass only; omitted on remediation)"
}
```

First-pass sessions request `AUTO_CREATE_PR`; remediation sessions omit `automationMode` so fixes push onto the audited branch. Dispatch returns `Blueprint{sourceName,sessionUrl,sessionState}` with honest empty `prUrl`; poll `GET /api/jules/session?id=` to harvest `state/prUrl/prTitle`.

#### The `startingBranch` Preservation Invariant
When dispatching an initial task:
- `startingBranch` defaults to the base branch (e.g. `main`).

When dispatching a **remediation session**:
- `startingBranch` **MUST** be set to `prMetadata.headBranch` (the active pull request branch).
- This guarantees that Jules executes `git checkout <headBranch>`, commits fixes on top of the existing PR, and avoids spawning orphaned branches.

---

## 3. Data Flow & State Hydration Lifecycle

```
[ Developer Input ]
       │
       ▼
[ Compiled Prompt + Blueprint ID ]
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
[ Local Vault (localStorage) ]    [ Jules Cloud Session ]
                                         │
                                         ▼
                              [ GitHub Pull Request ]
                                         │
                                         ▼
                              [ PR Ingestion Route ]
                                         │
                   ┌─────────────────────┴──────────────────────┐
                   ▼                                            ▼
      (PR Body contains Comment?)                  (Comment Missing or Stripped?)
                   │                                            │
                   ▼                                            ▼
       Extract Embedded Blueprint                     Lookup by Repo + Branch in Vault
                   │                                            │
                   └─────────────────────┬──────────────────────┘
                                         ▼
                         [ Active Hydrated Blueprint ]
                                         │
                                         ▼
                         [ Gemini Audit Scorecard (0-100) ]
```

---

## 4. API Endpoints Reference

### `POST /api/jules/dispatch`
Creates an asynchronous coding session with Google Jules or simulates a dry run.

- **Headers**:
  - `Content-Type: application/json`
  - `x-jules-api-key`: Optional Jules API key overriding environment variables.
- **Request Body**:
  ```json
  {
    "repo": "owner/repo",
    "baseBranch": "main",
    "branchName": "jules/feature-branch",
    "startingBranch": "jules/feature-branch",
    "fileBoundaries": ["src/**", "tests/**"],
    "objective": "Objective description",
    "criteria": [{ "id": "1", "text": "...", "category": "functional" }],
    "isRemediation": false,
    "dryRun": false
  }
  ```
- **Responses**:
  - `200 OK`: `{ "success": true, "sessionId": "...", "sessionUrl": "...", "blueprint": {"sourceName": "...", "sessionUrl": "...", "sessionState": "...", "prUrl": null} }`
  - `400 Bad Request`: Validation failure.
  - `401 Unauthorized`: Missing or invalid Jules API key.
  - `404`: Repo not in `GET /v1alpha/sources` (fail-closed, never invents source).

---

### `GET /api/jules/session?id=sessions/xxx`
Reads a Jules session back via `getJulesSession`, harvesting `state` and `outputs[].pullRequest`.

- **Headers**: `x-jules-api-key`
- **Response**: `{ "success": true, "sessionId": "...", "sessionUrl": "...", "state": "...", "prUrl": "...", "prTitle": "..." }`
- **Errors**: `401` no key, `400` no id, passthrough Jules status otherwise.

---

### `GET /api/jules/sources`
Discovers authorized GitHub repositories configured in the user's Jules workspace.

- **Headers**:
  - `x-jules-api-key`: User's Jules API key.
- **Response**:
  ```json
  {
    "sources": [
      { "name": "sources/github/owner/repo", "githubRepo": { "owner": "owner", "repo": "repo" } }
    ]
  }
  ```

---

### `POST /api/audit/fetch-diff`
Retrieves and sanitizes a pull request diff from GitHub.

- **Headers**:
  - `x-github-pat`: Optional GitHub PAT for private repositories.
- **Request Body**:
  ```json
  {
    "prUrl": "owner/repo/pull/42",
    "fileBoundaries": ["src/middleware/**"]
  }
  ```
- **Response**:
  ```json
  {
    "pr": {
      "number": 42,
      "title": "PR Title",
      "body": "PR Description",
      "headBranch": "jules/feature-branch",
      "baseBranch": "main",
      "embeddedBlueprint": { ... }
    },
    "sanitizedResult": {
      "filesChanged": 3,
      "additions": 142,
      "deletions": 18,
      "outOfScopeFiles": [],
      "sanitizedDiff": "diff --git a/src/...",
      "strippedNoiseFiles": ["package-lock.json"]
    }
  }
  ```

---

### `POST /api/audit/evaluate`
Executes Gemini structured verification of the sanitized diff against criteria.

- **Headers**:
  - `x-gemini-api-key`: Optional client Gemini key overriding environment variable.
- **Request Body**:
  ```json
  {
    "diff": "sanitized unified diff text...",
    "criteria": [
      { "id": "1", "text": "Extracts client IP", "category": "functional" }
    ],
    "fileBoundaries": ["src/middleware/**"],
    "unauthorizedPaths": ["package.json"],
    "repo": "owner/repo",
    "prTitle": "PR Title",
    "prNumber": 42
  }
  ```
  `unauthorizedPaths` comes from `sanitizedResult.stats.unauthorizedPaths` and forces scope via `forceScopeIntegrity` (empty = clean, omitted = unverified).
- **Response**:
  ```json
  {
    "scorecard": {
      "overallScore": 95,
      "verdict": "READY_TO_MERGE",
      "summary": "All functional criteria satisfied with high fidelity.",
      "blastRadius": "LOW",
      "criteriaEvaluations": [ ... ],
      "scopeIntegrity": {
        "withinDeclaredBoundaries": true,
        "unauthorizedFiles": []
      },
      "actionableDirectives": [ ... ]
    }
  }
  ```

---

## 5. Security & Isolation Architecture

1. **Ephemeral Key Transport**: Client-configured API keys are stored solely in the user's browser `localStorage` and dispatched over HTTPS headers (`x-jules-api-key`, `x-gemini-api-key`, `x-github-pat`). They are never persisted in databases, file systems, or server logs.
2. **Context Minimization**: Sensitive build artifacts, environment configuration files (`.env`), and keys are blocked by the sanitizer before forwarding to Gemini.
3. **Strict Schema Type Casting**: Model responses cannot inject rogue executable scripts or malformed HTML because outputs are bound to standard JSON schemas and sanitized prior to rendering.

---

## 6. Verification & Automated Test Coverage

RepoPilot includes 75 automated unit and integration tests executing under **Vitest**:

```
Test Suites: 12 passed, 12 total
Tests:       122 passed, 122 total
```

Run test suite via:
```bash
npm test
```
