# RepoPilot Comprehensive Testing Strategy & Developer Guide

This document outlines the testing conventions, architectural philosophy, and expansion guidelines for RepoPilot's test suite.

---

## 1. Test Architecture & Runner

RepoPilot utilizes **Vitest 5.x** (`vitest@^5.0.0` + `vite@^7` required peer) with native ES Modules (`.mjs`). Vitest was selected for:
- **Instantaneous startup:** Tests execute across 9 parallel isolated workers.
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
├── prompt-compiler.test.ts      # Anti-drift contract generation & blueprint parsing (7)
├── diff-sanitizer.test.ts       # Glob boundary matching, lockfile exclusion, hunk parsing (14)
├── jules-dispatch.test.ts       # Dispatch validation, source binding, automationMode, fail-closed 401/404 (21)
├── jules-session.test.ts        # Session poll route + harvestPullRequest/getJulesSession (7)
├── github-status.test.ts        # PAT validation, scopes, rate limits (7)
├── remediation-workflow.test.ts # Closed-loop remediation, audited branch targeting (2)
├── audit-engine.test.ts         # Ingestion, error boundaries, unauthorizedPaths forcing (9)
├── gemini-scoring.test.ts       # Metrics, penalties, forced scope reconciliation (8)
└── blueprint-vault.test.ts      # Serialization, deduplication, Refresh patch merge (4)
```

Total: 83 tests across 9 suites (`npm test`).

---

## 3. How to Execute Tests

```bash
# 1. Single run (CI mode)
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

When developing new capabilities (e.g. GitHub Actions exporter, multi-repo support, or new evaluation metrics):

1. **Create a corresponding file in `/__tests__/`**: Name it `<feature-name>.test.ts`.
2. **Follow the Arrange-Act-Assert structure**.
3. **Include edge cases**:
   - Empty input handling (`""`, `null`, `undefined`).
   - Boundary condition violations (e.g., path traversal `../../`).
   - Network failure simulation (`ok: false`, status 500/404).
4. **Run `npm test`** to ensure 100% pass rate across the full suite before opening a PR.
