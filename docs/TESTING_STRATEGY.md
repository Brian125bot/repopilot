# RepoPilot Comprehensive Testing Strategy & Developer Guide

This document outlines the testing conventions, architectural philosophy, and expansion guidelines for RepoPilot's test suite.

---

## 1. Test Architecture & Runner

RepoPilot utilizes **Vitest 5.x** (`vitest@^5.0.0` + `vite@^7` required peer) with native ES Modules (`.mjs`). Vitest was selected for:
- **Instantaneous startup:** Tests execute in isolated workers (one per test file — 38 in the current suite).
- **Next.js & TypeScript Native Compatibility:** Zero custom transpilation overhead.
- **In-Memory Network Isolation:** Eliminates brittle external API dependencies during automated verification.

Install reproducibly with `npm ci` (`@types/node@^22` satisfies the vitest peer range, so no flags needed).

### Configuration (`vitest.config.mjs`)
```javascript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    alias: {
      '@': path.resolve(process.cwd(), './'),
    },
  },
});
```

---

## 2. Directory Structure & Suites

All test files are organized in the `/__tests__/` directory:

```
/__tests__/
├── api-routes-extended.test.ts     # Extended route-level guards (4)
├── audit-engine.test.ts            # Ingestion, error boundaries, unauthorizedPaths forcing (13)
├── audit-grade.test.ts             # Category join, severity blast, line-ref validation, grade math (34)
├── audit-server-grade.test.ts      # Server single-truth sync, union paths, grade→brief→prompt (8)
├── blueprint-vault.test.ts         # Serialization, deduplication, Refresh patch merge (5)
├── contract-lint.test.ts           # Contract lint rules and pre-dispatch gate (12)
├── criteria-generate-balance.test.ts # Criteria generation balance and grounding (5)
├── diff-sanitizer.test.ts          # Glob boundary matching, lockfile exclusion, hunk parsing (14)
├── diff-sanitizer-extended.test.ts # Shared 90k budget, per-file reserve, hunk markers (10)
├── dispatch-gate.test.ts           # Pre-dispatch gate checks (5)
├── evaluate-timeout.test.ts        # Timeout retry payload (3)
├── first-pass-analytics.test.ts    # First-pass analytics in the outcome log (2)
├── first-pass-storage.test.ts      # First-pass persistence (3)
├── gemini-scoring.test.ts          # Metrics, penalties, forced scope reconciliation (8)
├── github-pr-lookup.test.ts        # PR URL / branch ingest parsers, pulls-by-head (5)
├── github-status.test.ts           # PAT validation, scopes, rate limits (7)
├── infra.test.ts                   # Infra and configuration sanity checks (5)
├── job-status.test.ts              # idle / watching / PR ready / last verdict (7)
├── jules-dispatch.test.ts          # Dispatch validation, source binding, fail-closed 401/404 (50)
├── jules-github-helpers.test.ts    # Jules/GitHub helper utilities (11)
├── jules-message.test.ts           # Follow-up :sendMessage lib + route, fail-closed 401/400/404 (8)
├── jules-session.test.ts           # Session poll route + harvestPullRequest/getJulesSession (9)
├── merge-readiness.test.ts         # Check-run rollup, mergeability, verdict cap (12)
├── outcome-grade.test.ts           # Grade-aware FailureBrief and outcome log (6)
├── outcome-log.test.ts             # Append/cap-50/turns/update/export, no aggregates (9)
├── outcome-memory.test.ts          # FailureBrief build + continuation prompt caps (14)
├── prompt-compiler.test.ts         # Anti-drift contract generation & blueprint parsing (9)
├── remediation-prompt-quality.test.ts # Compiler facts, branch lock, size caps, latency (27)
├── remediation-workflow.test.ts    # Closed-loop remediation, audited branch targeting (2)
├── repo-inspect-deep.test.ts       # Recursive tree, test command, framework detection (5)
├── sample-contract.test.ts         # Empty Stage 1 defaults + Load sample (3)
├── scorecard-smoke.test.ts         # Scorecard component smoke tests (3)
├── scoring-extended.test.ts        # Extended scoring boundaries (9)
├── session-poll.test.ts            # Tiered backoff, 25-min cap, terminal states (7)
├── stage-handoff.test.ts           # Prefill real PR URL, vault match (5)
├── tree-grounding.test.ts          # Boundary validation, hallucination filter, dir fallback (9)
├── v1-release.test.ts              # 1.0.1 artifacts, local gate, no credential logs (3)
└── vault.test.ts                   # Driver selection, local round-trip, Upstash REST (10)
```

Total: 38 files / 361 tests. Run `npm test` locally; the full local gate is `npm ci && npm test && npx tsc --noEmit`.

---

## 3. How to Execute Tests

```bash
# 1. Single run (local)
npm test

# 2. Watch mode (Developer feedback loop)
npm run test:watch

# 3. Target a single test suite
npx vitest run __tests__/remediation-workflow.test.ts

# 4. Target tests by name pattern
npx vitest run -t "startingBranch"
```

---

## 4. Mocking Guidelines for Future Contributors

### Mocking Next.js `NextRequest`
All API route tests instantiate Next.js `NextRequest` directly from `next/server`:
```typescript
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/jules/dispatch/route';

const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ... }),
});

const res = await POST(req);
expect(res.status).toBe(200);
```

### Mocking Network Calls (`fetch`)
Always use `vi.spyOn(globalThis, 'fetch')` with clean URL routing so source binding, session dispatch, and GitHub pre-checks are handled separately. Match `/v1alpha/sessions` for the dispatch payload (not bare `jules.googleapis.com`, which also matches `/v1alpha/sources` and has no body):

```typescript
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
  const url = typeof input === 'string' ? input : (input as { url: string }).url;

  if (url.includes('/v1alpha/sources')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ sources: [{ name: 'sources/src_1', githubRepo: { owner: 'owner', repo: 'repo' } }] }),
    } as unknown as Response;
  }

  if (url.includes('/v1alpha/sessions')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ name: 'sessions/12345', state: 'ACTIVE' }),
    } as unknown as Response;
  }

  // GitHub API check fallback
  return {
    ok: true,
    status: 200,
    json: async () => ({ full_name: 'owner/repo' }),
  } as unknown as Response;
});
```

Tests import production functions from `lib/*` (e.g. `getJulesSession`, `harvestPullRequest`, `reconcileAuditReport`, `forceScopeIntegrity`); routes stay thin.

---

## 5. Writing New Tests for Future Features

When developing new capabilities (e.g. automation exporter, multi-repo support, or new evaluation metrics):

1. **Create a corresponding file in `/__tests__/`**: Name it `<feature-name>.test.ts`.
2. **Follow the Arrange-Act-Assert structure**.
3. **Include edge cases**:
   - Empty input handling (`""`, `null`, `undefined`).
   - Boundary condition violations (e.g., path traversal `../../`).
   - Network failure simulation (`ok: false`, status 500/404).
4. **Run `npm test`** to ensure 100% pass rate across the full suite before opening a PR.
