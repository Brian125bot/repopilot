# COR-56: Goal ingestion modal, extraction prompt, and edit-and-confirm flow

Rebuilt cleanly on `main` @ `20da77a`. Supersedes the unmerged #27, which was built on an older commit and held for four integration reasons.

## The four prior holds, and where each is closed

| # | Hold on #27 | Closed by |
|---|---|---|
| 1 | `StartSessionModal` was never mounted into the dispatch flow | `components/IntakeDispatchStage.tsx` mounts it alongside the existing preview/troubleshoot modals. The primary Dispatch button opens it first; a secondary **Capture Goal** button opens it without dispatching; closing the dialog cancels a pending dispatch. |
| 2 | The extraction prompt had no `RepoProfile` context | `lib/goals/extract-prompt.ts` injects the detected stack, conventions, and operator instructions via `formatRepoProfileContext`, and asks for criteria that cite the repository's real command form (`buildExampleTestCommand` derives it from the actual `packageManager`/`testRunner` — e.g. `pnpm test lib/example.test.ts`, or the runner verbatim for non-JS runners). `extractGoalFromText` threads it from the route. |
| 3 | Vault write failures were swallowed with `console.warn` and the goal confirmed anyway | `lib/goals/storage.ts` throws a typed `GoalVaultError` with the underlying `cause`; `StartSessionModal` renders "Failed to save goal to vault — please check your passphrase and retry" and neither confirms, closes, nor dispatches. Covered by four explicit failure tests. |
| 4 | It opened its own `repopilot-goals-v1` database | `lib/vault/open-db.ts` provisions `goals-v1` inside the unified `openVaultDb()`. **The database version had to go from 2 to 3**: an IndexedDB upgrade handler only runs when the version increases, so adding the store to the v2 handler would never reach operators already on v2. `__tests__/idb-version-sync.test.ts` now pins the v2 → v3 upgrade specifically. |

## What landed

- **`lib/goals/types.ts`** — `GoalExtracted`/`Goal` Zod schemas and a pure `buildGoal`. `GoalExtractedSchema` deliberately strips unknown keys (model output); `GoalSchema` is `.strict()` (our own record, so corruption is detectable). `title: "UNCLEAR"` requires non-empty `ambiguityFlags`.
- **`lib/goals/storage.ts`** — reuses the exported `wrapRecord`/`unwrapRecord` rather than reimplementing PBKDF2/AES-GCM, so goals and steering profiles share one passphrase and one KDF. IndexedDB store plus a hermetic memory store.
- **`lib/goals/contract.ts`** — maps confirmed `acceptanceCriteria` onto the Stage 1 criteria matrix so `preDispatchGate`, `compileJulesPrompt`, the `AUDIT_BLUEPRINT`, and Stage 2 scoring all carry them.
- **`lib/goals/extract-prompt.ts`**, **`lib/gemini.ts`**, **`app/api/goal/extract/route.ts`** — extraction proxy. `400 INVALID_INPUT` / `401 UNAUTHORIZED` / `422 INVALID_INPUT` / `502 UPSTREAM_ERROR`. Upstream error text is discarded because it can echo prompt content, and `apiError` is called without a duplicate `logRouteError` (a #27 defect).
- **`components/JulesSession/`** — `GoalRawInput`, `GoalExtractedEditor`, `StartSessionModal`. Wizard state lives in a child that only mounts while the dialog is open, so the passphrase is discarded on unmount rather than via a reset effect. Confirm stays disabled while the title is `UNCLEAR` or the criteria list is empty.
- **Dispatch hand-off** — `JulesDispatchBodySchema` gained an optional `goal` field (it is `.strict()`, so the payload would otherwise be rejected), and `compileJulesPrompt` renders it as an additive `§1.1` block. §3 stays authoritative, so a goal can never widen the blast radius; with no goal the compiled prompt is byte-identical to its pre-COR-56 output (asserted).

## Invariants

No server-held Gemini key and no new environment variable — the key arrives only in `x-gemini-api-key`. Goals persist only in the WebCrypto AES-GCM vault. No automatic confirm or dispatch. `output: 'standalone'` untouched; no `.github/workflows` added.

## Verification (local gate)

```
npm ci
npm test          665 passed / 61 files
npm run lint      0 errors (9 pre-existing warnings in hooks/use-credential-vault.ts, untouched)
npx tsc --noEmit  clean
npm run build     success — /api/goal/extract registered
```

## Reviewer notes — please read before approving

1. **Branch and PR were not created by me.** My git permissions are read-only, so the work is on the worktree branch `kilo/smoky-cliff-vo1` (exactly `main` @ `20da77a`). Rename to `cor-56-goal-ingestion-v2`, push, and open.
2. **The passphrase design is a deliberate decision.** `useCredentialVault` never retains the passphrase (SettingsModal clears it after every use) and `app/page.tsx` holds none, so there was nothing to thread. The modal collects it once and uses it for exactly two things: reading the saved repo profile and encrypting the goal. The alternatives were retaining the passphrase in the credential-vault hook or lifting SettingsModal state upward.
3. **Vault version 2 → 3 is a real migration.** It is required for hold #4, but it is the one user-visible schema change in this PR.
4. **A goal is keyed by a `draft-…` id,** not a Jules session id, because no session exists at capture time. Re-keying after dispatch would mean holding the passphrase past the dialog close.
5. **Confirming a goal can be refused by the client gate.** Extracted criteria are not guaranteed to satisfy the functional/testing/constraint balance `preDispatchGate` requires, so the first dispatch after a confirmation may fail with a visible error; the operator edits the Stage 1 criteria and dispatches again. This is expected, not a defect.
6. **Pre-existing flaky test, unrelated to this PR.** `__tests__/settings-verify.test.ts:41` asserts the response payload does not contain `String(key.length)` (`"30"`), but every error envelope now carries a random `requestId` UUID, so roughly 1 run in 3 fails when a hex `30` lands in the UUID. The file is untouched here. I left it alone because it is a security assertion outside COR-56's scope and weakening it silently would be worse than a red gate.