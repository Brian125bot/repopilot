# COR-56 — Goal Ingestion (modal, extraction, edit-and-confirm)

Branch: `cor-56-goal-ingestion-v2` · Base: current `main` HEAD `20da77a` · Supersedes unmerged PR #27

## Context

Capture operator intent at Jules session start as a structured goal (`title`, `scope`, `acceptanceCriteria`, `assumptions`, `ambiguityFlags`) via Gemini freeform extraction, with mandatory human review, encrypted client-side persistence, and hand-off into the existing dispatch contract.

PR #27 was rejected for four integration holds. This plan closes each one explicitly:

| # | Prior hold | Closed by |
|---|---|---|
| 1 | `StartSessionModal` never mounted into the dispatch flow | Task 9 wires it into `IntakeDispatchStage`'s Dispatch button |
| 2 | Extraction prompt lacked `RepoProfile` context | Task 4 injects COR-54 profile; Task 5 threads it to `/api/goal/extract` |
| 3 | Vault write failures swallowed via `console.warn` | Task 8 catches, renders a blocking visible error, and refuses to close/dispatch |
| 4 | Opened its own `repopilot-goals-v1` IndexedDB | Task 2 provisions `goals-v1` inside the unified `openVaultDb()` opener |

### Corrections to the brief (verified against code — follow these, not the brief text)

1. **Base commit.** Brief says `main @ 42f9feb`; actual HEAD is **`20da77a`** (release 1.0.3 cleanup). Branch from current `main` HEAD.
2. **Error code.** Brief says `UPSTREAM`. `ApiErrorCode` (lib/api-error.ts:4) has no `UPSTREAM` — the value is **`UPSTREAM_ERROR`**. `UNAUTHORIZED` and `INVALID_INPUT` exist as written.
3. **Gemini model.** Brief says `gemini-2.5-flash`. `lib/gemini.ts` uses **`gemini-3.8-flash`** for both existing calls. Use `gemini-3.8-flash`; do not introduce a second model string.
4. **`getGoal` signature.** Brief writes `getGoal(sessionId: string)`. An AES-GCM record cannot be read without a passphrase, so the real signature is `getGoal(sessionId, passphrase?, store?)`, throwing a descriptive error when the passphrase is absent.
5. **`Goal` shape.** Brief adds `id` (uuid) and `repo` (owner/name) to `Goal`; PR #27 lacked both. Keep both.
6. **`lib/gemini.ts` imports.** PR #27 appended `import` statements at the end of the file. Put new imports at the top.

### Decisions already taken

- **Passphrase source:** `StartSessionModal` renders its own labelled password field. `useCredentialVault` never retains the passphrase (SettingsModal clears it at components/SettingsModal.tsx:326,351,368) and `app/page.tsx` holds none, so there is nothing to thread. One passphrase serves both goal encryption and the `RepoProfile` read.
- **Dispatch hand-off:** map `extracted.acceptanceCriteria` into the existing `criteria: AcceptanceCriterion[]` **and** add an optional `goal` field to `JulesDispatchBodySchema` that `compileJulesPrompt` renders as a new section.
- **Test paths:** co-located, as the brief names them (`lib/goals/storage.test.ts`, `app/api/goal/extract/route.test.ts`). `vitest.config.mjs` sets no `include`, so defaults discover them.

---

## Tasks

### 1. `lib/goals/types.ts` (new)

Zod schemas + inferred types. Mirror the style of lib/types/steering.ts (explicit `message:` strings, ISO-8601 `refine`).

- `GOAL_RAW_TEXT_MAX = 20000`, `GOAL_TITLE_MAX = 120`, `GOAL_LIST_ITEM_MAX = 2000`, `GOAL_LIST_MAX = 20`.
- `GoalExtractedSchema` — `title` (trim, min 1, max), `scope`/`acceptanceCriteria`/`assumptions`/`ambiguityFlags` (arrays of non-empty trimmed strings, capped). **Do not use `.strict()`** — default key-stripping keeps a chatty Gemini response from failing the whole extraction. Add `.refine()`: `title === 'UNCLEAR'` requires non-empty `ambiguityFlags` (carry this rule over from PR #27).
- `GoalSchema` — `.strict()`: `id` (uuid string, min 1), `sessionId` (min 1), `repo` (trim min 1), `rawText`, `extracted: GoalExtractedSchema.nullable()`, `createdAt`/`updatedAt` ISO-8601. Strict is correct here: it is our own record and lets `unwrapRecord` detect corruption.
- Export `parseGoal(value): Goal` and `buildGoal(input): Goal` (pure factory that stamps `crypto.randomUUID()` for `id`, `new Date().toISOString()` for both timestamps, and takes `sessionId` as the caller's draft id). `buildGoal` is the unit-testable seam that replaces PR #27's DOM-free component smoke test.

### 2. `lib/vault/open-db.ts` (edit) — closes hold #4

Add `export const GOALS_STORE = 'goals-v1';` and a guarded `createObjectStore(GOALS_STORE)` inside the existing `onupgradeneeded`.

**Bump `VAULT_IDB_VERSION` from `2` to `3`.** This is required, not cosmetic: `onupgradeneeded` only fires on a version *increase*, so adding the store to the v2 handler would never provision it for anyone already on v2. All three call sites (`credential-vault.ts`, `steering-store.ts`, new `goals/storage.ts`) share this opener, so the bump is consistent. `STEERING_IDB_VERSION` re-exports the constant automatically.

Use out-of-line keys (matching `vault` / `profiles-v1` / `snippets-v1`), keyed by `sessionId`. Update `__tests__/idb-version-sync.test.ts`: assert version `3` and the presence of `goals-v1`. Its hand-rolled `FakeIDBDatabase` already handles `createObjectStore` generically, so only the assertions change.

### 3. `lib/goals/storage.ts` (new) — closes holds #3, #4

Re-use the landed crypto instead of duplicating it. `wrapRecord` and `unwrapRecord` are already **exported** from lib/vault/steering-store.ts:102,119 along with the `SteeringEnvelope` type — import them. Do not re-implement PBKDF2/AES-GCM.

- `GoalRecordStore` = `{ read(sessionId), write(sessionId, envelope), delete(sessionId) }`.
- `indexedDbGoalRecordStore()` — mirrors `indexedDbSteeringRecordStore()`: `openVaultDb()`, `db.transaction(GOALS_STORE, …)`, `closeDb` in both `try` and `catch`.
- `createMemoryGoalRecordStore()` — hermetic `Map`, required by the storage tests.
- `class GoalVaultError extends Error` with `cause`, carrying operator-facing text.
- `saveGoal(goal, passphrase?, store = defaultGoalStore)` — `GoalSchema.safeParse` → `SteeringValidationError`-style message on failure; missing/blank passphrase → `GoalVaultError`; `wrapRecord` → `store.write`. Wrap `store.write` failure in `GoalVaultError` and **rethrow**. Never swallow.
- `getGoal(sessionId, passphrase?, store?)` — `null` when no envelope; otherwise `unwrapRecord(envelope, pass, GoalSchema)`.
- `deleteGoal(sessionId, store?)`.
- Default store resolved at call time (not module load, which would capture `typeof indexedDB` too early in the browser).

### 4. `lib/goals/extract-prompt.ts` (new) — closes hold #2

- `GOAL_EXTRACT_SYSTEM_PROMPT` — JSON-only contract for `GoalExtracted`; the `UNCLEAR` rule (vague/lacking actionable criteria ⇒ `title: "UNCLEAR"` + populated `ambiguityFlags`); assumptions must hold invented numbers, never silently.
- `formatRepoProfileContext(profile?: RepoProfile): string` — pure and separately testable. Emits repo `owner/name`, `stack.languages`, `stack.packageManager`, `stack.framework`, `stack.testRunner`, conventions (title + body, capped count/length), `customInstructions`, `notes`. Empty string when `profile` is absent.
- Build the example project command from the profile rather than hardcoding npm: `` `${packageManager ?? 'npm'} ${testRunner ? `${testRunner} ` : ''}lib/<path>.test.ts` `` (e.g. `npm test lib/goals/storage.test.ts`), so the brief's "cite specific project commands" example is grounded in real detection.
- Instruct: acceptance criteria must cite real files/commands present in the profile and must never invent paths.
- `buildGoalExtractPrompt(rawText: string, repoProfile?: RepoProfile)` → `{ systemPrompt, userPrompt }`. Cap `rawText` at `GOAL_RAW_TEXT_MAX`.

### 5. `lib/gemini.ts` (edit)

Add `extractGoalFromText({ rawText, repoProfile, customApiKey }): Promise<GoalExtracted>` mirroring `generateAcceptanceCriteria`: `getGeminiClient(customApiKey)`, `model: 'gemini-3.8-flash'`, `responseMimeType: 'application/json'`, a `goalExtractionSchema` built from `Type.OBJECT/ARRAY/STRING` with all five keys `required`, `temperature: 0.1`. Throw on empty `response.text`. Imports at the top of the file.

### 6. `app/api/goal/extract/route.ts` + `lib/validation.ts` (new / edit)

`lib/validation.ts`:
- `GoalExtractBodySchema` = `z.object({ rawText: <trimmed, min 1, max GOAL_RAW_TEXT_MAX>, repoProfile: RepoProfileSchema.optional() }).strict()`. Reuse `RepoProfileSchema` from `@/lib/types/steering` — do not restate it.
- `GoalExtractedSchema` imported from `@/lib/goals/types` (single source of truth; re-export nothing).
- `JulesDispatchBodySchema`: add `goal: GoalExtractedSchema.nullable().optional()`. The schema is `.strict()`, so without this the payload is rejected outright.
- Export `GoalExtractBody`.

Route (`POST`), following `app/api/criteria/generate/route.ts`:
- `parseRequestBody(GoalExtractBodySchema, req, '/api/goal/extract', requestId)` → 400 `INVALID_INPUT` on failure.
- Key: `req.headers.get('x-gemini-api-key')`. If absent **and** `process.env.GEMINI_API_KEY` is unset → `401 UNAUTHORIZED` (mirrors the dispatch route). Never echo or log the key.
- `extractGoalFromText(...)`, then `GoalExtractedSchema.safeParse`. On failure return `422 INVALID_INPUT`.
- Call `apiError(...)` **only** — it already invokes `logRouteError` (lib/api-error.ts:43). PR #27 called `logRouteError` and then `apiError`, emitting duplicate log lines; do not repeat that.
- Gemini throw → `502 UPSTREAM_ERROR`. Success → `NextResponse.json({ success: true, ...parsed })`.

### 7. `components/JulesSession/` (new; directory does not exist yet)

Follow the existing modal shell (`Dialog → DialogHeader(onClose) → DialogTitle → DialogContent → DialogFooter`, as in components/ContractPreviewModal.tsx). `variant="success"` and `size="icon"` already exist in components/ui/button.tsx. All three files need `'use client'` (components/ui/dialog.tsx:17 touches `window`).

- **`GoalRawInput.tsx`** — `Textarea`, live character count, `Extract Goal` (`variant="accent"`, disabled while `isExtracting` or blank), `Skip extraction` (`variant="outline"`). Props: `initialText`, `onExtract(rawText)`, `onSkip(rawText)`, `isExtracting`.
- **`GoalExtractedEditor.tsx`** — editable title (`Input`), editable scope list, editable `acceptanceCriteria` list with add/edit/delete per line, editable assumptions list, and `ambiguityFlags` rendered as read-only amber warning banners. Preserve the operator's raw text in a `whitespace-pre-wrap` block so they can compare against the extraction.
  - **Confirm is blocked while `title === 'UNCLEAR'` or the criteria list is empty**, with an inline reason. This is invariant #3 enforced in the UI.
- **`StartSessionModal.tsx`** — owns `step: 'raw' | 'editor'`, the passphrase, `error`, `isExtracting`, `isSaving`.
  - Renders the passphrase field once, above the step content: label "Vault passphrase — the same passphrase you use to unlock credentials. Used only in this browser to encrypt the goal; never sent to the server." Required before Confirm/Skip.
  - **Extract:** `indexedDbSteeringStore()` → `unlock(passphrase)` → `getRepoProfile(repo)`; on failure resolve to `undefined` plus a non-blocking inline note (a missing profile must not block extraction). POST `/api/goal/extract` with `x-gemini-api-key: geminiApiKey` and `{ rawText, repoProfile }`, then re-validate the response with `GoalExtractedSchema` client-side.
  - **Confirm / Skip:** `buildGoal({ sessionId: draftId, repo, rawText, extracted })` where `draftId = \`draft-${crypto.randomUUID()}\`` (no Jules session exists yet — the spec allows a temporary draft ID), then `await saveGoal(goal, passphrase)` inside `try/catch`. **On failure set `saveError` and do not call `onConfirm`, do not close the modal, do not dispatch.** On success call `onConfirm(goal)`.
  - Vault failure copy, verbatim: `Failed to save goal to vault — please check your passphrase and retry.`
  - Clear the passphrase from state whenever the modal closes. Consequence accepted: the goal stays keyed by its draft id rather than the Jules session id; `getGoal` is still exported and tested.
  - Props: `open`, `onOpenChange`, `repo`, `geminiApiKey`, `initialRawText`, `intent: 'dispatch' | 'goal-only'`, `onConfirm(goal)`, `onCancel`. Primary button label follows intent — `Confirm & Dispatch` vs `Confirm & Save`.

### 8. `lib/prompt-compiler.ts` + `app/api/jules/dispatch/route.ts` (edit)

- `PromptCompilerInput` gains `goal?: GoalExtracted | null`.
- Render `## 1.1 Goal Ingestion (operator-confirmed)` **only when `goal` is non-null**, immediately after `## 1. Primary Objective`, listing title, scope, assumptions, and any ambiguity flags with a note that the operator reviewed them. Keeping §2–§5 numbering intact avoids churn and keeps every existing prompt assertion byte-identical (the section is absent when `goal` is absent, so `__tests__/prompt-compiler.test.ts` cannot regress).
- Dispatch route: destructure `goal` and forward it to `compileJulesPrompt`. **Do not** add `goal` to the `Blueprint` — it reaches Stage 2 through `compiledPrompt` and `criteria` only, which avoids rippling into `/api/vault`'s schema and the `AUDIT_BLUEPRINT` payload.

### 9. `components/IntakeDispatchStage.tsx` (edit) — closes hold #1

- New state: `goalModalOpen`, `pendingGoal: Goal | null`, `goalIntent`.
- Mount `<StartSessionModal … />` alongside the existing `ContractPreviewModal` and `JulesTroubleshootModal` (components/IntakeDispatchStage.tsx:595-615).
- The existing Dispatch button (`onClick={handleDispatch}`, line 1535) becomes `onClick={() => openGoalModal('dispatch')}`. Add a secondary **"Capture Goal"** button (`variant="outline"`) that opens the modal with `intent: 'goal-only'`.
- On confirm with `intent: 'goal-only'`: apply and close, no dispatch.
- On confirm with `intent: 'dispatch'`: apply, close, then run the existing `handleDispatch()`.
- Applying the goal:
  - `setCriteria(...)` from `goal.extracted.acceptanceCriteria`, mapping to `{ id: String(i + 1), text, category }` with `category: 'testing'` when the text matches `/test/i`, else `'functional'`.
  - Explicitly tell the operator in the modal that confirming replaces the Stage-1 criteria list and shows the count.
  - `preDispatchGate`/`lintCriteria` may then report an unbalanced matrix. That surfaces as the existing **visible** `dispatchError`/warning — the operator edits the Stage-1 criteria and re-dispatches. Document this in the PR body as expected, not as a defect.
- `handleDispatch` body adds `goal: pendingGoal?.extracted ?? null`.
- Cancel/close with `intent: 'dispatch'` aborts the dispatch entirely (invariant #3: never dispatch without an explicit Confirm or Skip).
- Reset `pendingGoal` in `handleResetForm` and after a successful dispatch.
- `app/page.tsx` needs **no** changes — the Gemini key is already a prop (`geminiKey`) and no new host context is required.

### 10. Tests

- **`lib/goals/storage.test.ts`** (hermetic, no IndexedDB): extracted roundtrip; `extracted: null` roundtrip; wrong passphrase rejects; unknown `sessionId` → `null`; blank passphrase → `GoalVaultError`; an injected failing store makes `saveGoal` throw `GoalVaultError` (never resolve silently); the stored envelope's `ciphertextB64` contains neither `rawText` nor the title (proves encryption at rest); `buildGoal` stamps a uuid `id` and ISO timestamps.
- **`app/api/goal/extract/route.test.ts`**: mock with the repo's Pattern A — `vi.mock('@/lib/gemini', async (importOriginal) => ({ ...await importOriginal(), extractGoalFromText: vi.fn() }))` plus `vi.mocked(...).mockReset()` in `beforeEach`. Cover: valid extraction → 200 with the parsed body; `UNCLEAR` + non-empty `ambiguityFlags` passes through; `repoProfile` is forwarded into the mocked call **and** `formatRepoProfileContext` surfaces the detected stack so criteria can cite a real command; 400 on empty `rawText`; 401 when no key is configured; 502 `UPSTREAM_ERROR` when Gemini throws; 422 `INVALID_INPUT` on schema-invalid model output.
- **`lib/goals/extract-prompt.test.ts`** (co-located, follows the `lib/repo-profile/*.test.ts` precedent): `formatRepoProfileContext` empty-vs-populated, command derived from `packageManager`/`testRunner`, output truncated at the caps, `UNCLEAR` rule present in the system prompt.
- **`__tests__/idb-version-sync.test.ts`**: version `3`, `goals-v1` present.
- **`__tests__/v1-release.test.ts`**: add `app/api/goal/extract/route.ts` to the hardcoded route list at line 31 so the "no credential headers logged as values" assertion covers the new route.
- No `.tsx` component test (there is no DOM environment; PR #27's `React.createElement` smoke test asserted nothing meaningful). `buildGoal` covers the logic instead.

### 11. `CHANGELOG.md`

Under the existing empty `## [Unreleased]`, add `### Added` with the brief's line verbatim:

> - **Goal Ingestion (COR-56):** Start-session goal modal (`StartSessionModal`), Gemini extraction proxy (`/api/goal/extract`), edit-and-confirm flow with profile context bounding, and encrypted IndexedDB goal storage.

Then one honest sub-bullet, matching this changelog's style: the goal record lives in the existing `repopilot-credential-vault` database under a new `goals-v1` object store, which required bumping that database to version `3` so the store is provisioned for operators already on version `2`; goals are keyed by a pre-dispatch draft id because no Jules session exists at capture time; and the modal collects the vault passphrase in-browser because the credential vault deliberately does not retain it.

### 12. Verify, then open the PR

```
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Branch `cor-56-goal-ingestion-v2` off current `main`. PR body: summary of the components and the `IntakeDispatchStage` wiring; an explicit proof table mapping each of the four prior holds to the task that closes it; the gate output above.

---

## Invariants to preserve

1. **Zero-auth / empty Vercel env** — no Gemini key in server env or Vercel config; key travels in `x-gemini-api-key`. The CSP in next.config.ts:7 already allows `generativelanguage.googleapis.com`.
2. **Client-side encryption** — AES-GCM + PBKDF2 in `repopilot-credential-vault` only.
3. **Operator-in-the-loop** — no dispatch without an explicit "Confirm & Dispatch" or "Skip extraction"; `UNCLEAR`/empty-criteria blocks Confirm.
4. **`output: 'standalone'`** in next.config.ts — do not touch the file.
5. **No `.github/workflows`** — none exist; do not add any. Verification stays local-only (CONTRIBUTING.md:11).

## Risks

- **Vault version bump is user-visible.** Any consumer assuming version `2` must be checked — `VAULT_IDB_VERSION` is referenced by `credential-vault.ts`, `steering-store.ts` (re-export), and `__tests__/idb-version-sync.test.ts`. Grep before committing.
- **`preDispatchGate` imbalance.** Extracted criteria will not always satisfy `lintCriteria`' functional + testing + constraint balance, so the first dispatch after confirming a goal can fail client-side with a visible error. Expected and recoverable; state it in the PR body.
- **Strict `RepoProfileSchema` on the wire.** The client sends back exactly what it decrypted, so `.strict()` is safe; any future field addition to `RepoProfileSchema` must be reflected on both sides.
- **`GoalSchema` is `.strict()`** while `GoalExtractedSchema` is not. Do not flip either.
- **`tsc --noEmit` covers `app/api/**/*.test.ts`** (tsconfig includes `**/*.ts`), so the co-located route test must be type-clean and lint-clean — `next build` runs ESLint with `ignoreDuringBuilds: false`.

## Out of scope

- Re-keying the stored goal to the real Jules `sessionId` after dispatch (would require retaining the passphrase past modal close).
- Any Stage-2 evaluation change; goals reach Stage 2 only through `criteria` and `compiledPrompt`.
- `.github/workflows`, deployment config, README/ARCHITECTURE edits beyond the CHANGELOG entry.