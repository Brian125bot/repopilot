# RepoPilot Comprehensive Testing Strategy & Developer Guide

This document outlines the testing conventions, architectural philosophy, and expansion guidelines for RepoPilot's test suite.

---

## 1. Test Architecture & Runner

RepoPilot utilizes **Vitest 3.x/5.x** with native ES Modules (`.mjs`). Vitest was selected for:
- **Instantaneous startup:** Tests execute in under 2.5 seconds across 7 parallel isolated workers.
- **Next.js & TypeScript Native Compatibility:** Zero custom transpilation overhead.
- **In-Memory Network Isolation:** Eliminates brittle external API dependencies during automated verification.

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
├── prompt-compiler.test.ts      # Anti-drift contract generation & blueprint parsing
├── diff-sanitizer.test.ts       # Glob boundary matching, lockfile exclusion, hunk parsing
├── jules-dispatch.test.ts       # Jules API route validation, dry-run mode, startingBranch
├── remediation-workflow.test.ts # Closed-loop remediation, audited branch targeting
├── audit-engine.test.ts         # Ingestion, fetch-diff, and evaluation error boundaries
├── gemini-scoring.test.ts       # Metric calculation, penalty weightings, blast radius
└── blueprint-vault.test.ts      # Blueprint serialization, deduplication, state hydration
```

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
Always use `vi.spyOn(globalThis, 'fetch')` with clean URL routing so both GitHub pre-checks and Jules endpoints are handled cleanly:

```typescript
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
  const url = typeof input === 'string' ? input : (input as { url: string }).url;
  
  if (url.includes('jules.googleapis.com')) {
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
