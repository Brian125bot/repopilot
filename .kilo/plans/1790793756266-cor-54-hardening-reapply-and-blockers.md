# COR-54 — Re-apply hardening layer, fix 2 Verify blockers, open PR

## Context (verified against the repo, not assumed)

- `main` HEAD = `5229949c`. Current working branch is `kilo/stellar-mosaic-lbv`, clean, at `5229949c`.
- **`8d6d9c8` is already a direct child of `main`.** `git rev-list --count origin/main..8d6d9c8` = `1` and
  `git rev-list --ancestry-path origin/main..8d6d9c8` returns only `8d6d9c8`. **There is no rebase and no
  conflict resolution to do** — the "rebase or apply" step reduces to branching at `8d6d9c8`.
- `8d6d9c8` touches 16 files, +1571 / −341, matching the brief exactly. `git diff --stat origin/main 8d6d9c8`.
- PR #26 is **closed**, so its branch cannot be reopened. A new branch + new PR is required.
- Only `app/settings/repos/page.tsx` and `lib/repo-profile/scan.test.ts` import `scanRepository`, so the
  `RepoProfile` → `ScanResult` return-type change is contained.
- No `.github/` directory exists; `CONTRIBUTING.md` states remote CI is intentionally absent and the
  local gate is authoritative.

### Prior-fix audit (Task 4) — current state

| Prior fix | Status at `8d6d9c8` | Action |
|---|---|---|
| 1. Abort during config/file extraction signals `incomplete: true` | **Present.** `profile` is seeded with `incomplete: true` in the constructor (`lib/repo-profile/scan.ts`, ~L239). Stage-4 abort is a `if (!ctrl.signal.aborted)` skip that falls through to the final block, which sets `outcome = "cancelled" \| "timed_out"` then re-asserts `profile.incomplete = true` (L512–528). | Add one explicit test naming this path (Step 5). No production change. |
| 2. Navigation to `/settings/repos` | **Present on `main` already**, `components/Navbar.tsx:151` (`<Link href="/settings/repos">` with a "Repos" button). Not touched by `8d6d9c8`. | No change. |
| 3. Non-abort scan errors surfaced | **Present.** Hardened `handleScan` `catch` calls `setError(describeScanError(err))`. | No change. Note: `handleDeleteProfile` still swallows via `console.error` — not a scan path, leave alone. |

### Contradictions in the brief (resolved with the user)

1. **`isProfileEmpty` field spec is wrong.** The brief cites "empty tech stack, scripts, dependencies, and
   summary". `RepoProfile` in `lib/types/steering.ts` has no `summary`, `scripts`, or `dependencies`
   fields. **Decision: keep the four signals already implemented in `8d6d9c8`** — `repoRef.defaultBranch`,
   `stack.languages`, `stack.packageManager|framework|testRunner`, `conventions`. The only change is to
   **export** the helper.
2. **Auto-save violates Invariant 3.** Hardened `handleScan` writes to the vault whenever
   `decideSave` returns `action: "save"`, including `outcome === "complete"`. **Decision: auto-save
   `complete` scans only**; `partial` / `cancelled` / `timed_out` always require an explicit operator click.
3. **CHANGELOG heading.** The brief says `## [1.0.2] - 2026-09-21`; the actual heading in the file is
   `## 1.0.2 — 2026-09-21` (em dash, unbracketed). Use the real one. Do not normalize headings.
4. **Invariant 1 wording vs. reality (pre-existing, out of scope).** Both `main` and `8d6d9c8` call
   `https://api.github.com` directly from the browser rather than through a `/api/*` proxy; no server-held
   token or env var is introduced, so the security intent of Invariant 1 holds. Rerouting through a new
   stateless proxy route is **not** in scope for this PR. Flag it in the PR body as a known follow-up.

## Decisions

- Branch `cor-54-harden-scan-pipeline-v2` from `8d6d9c8`; two follow-up commits (Blocker 1, Blocker 2);
  new PR against `main` that supersedes #26.
- `isProfileEmpty` becomes an exported pure function in `lib/repo-profile/save-policy.ts`, keeping the
  four signals. The exact operator-facing message is exported as a constant so tests can assert it.
- Page-level guard is **defense in depth** behind `decideSave` returning `skip`: hidden button +
  `handleExplicitReplace` early-return + exported message.
- No DOM test harness exists (`vitest.config.mjs` is `environment: 'node'`; no `jsdom`, no
  `@testing-library/*` in `package.json`). Do **not** add one. Keep the page's decision logic in
  `save-policy.ts` where it is unit-testable; verify page wiring via `npx tsc --noEmit` + `npm run build`
  plus the manual checklist in Step 6.

## Implementation steps

### Step 1 — Branch off the hardening commit

```bash
git fetch origin
git switch -c cor-54-harden-scan-pipeline-v2 8d6d9c8
```
Confirm `git status` is clean and `git log --oneline -2` shows `8d6d9c8` on top of `5229949c`.

### Step 2 — Blocker 1a: export the guard (`lib/repo-profile/save-policy.ts`)

- Change `function isProfileEmpty(...)` to `export function isProfileEmpty(profile: RepoProfile & { incomplete?: boolean }): boolean`.
- Leave the body as-is (four signals). Do not add `notes`, `customInstructions`, or `id`.
- Add `export const EMPTY_REPLACE_MESSAGE = "Cannot replace existing profile with an empty scan result.";`

### Step 3 — Blocker 1b: page wiring (`app/settings/repos/page.tsx`)

Import `isProfileEmpty` and `EMPTY_REPLACE_MESSAGE` from `@/lib/repo-profile/save-policy`.

1. **Handler guard.** At the top of `handleExplicitReplace` (rename to `handleConfirmSave` in the same
   commit — it now serves "save first partial" and "replace with partial"), add before the `try`:

   ```ts
   if (!saveDecision || !isUnlocked) return;
   if (isProfileEmpty(saveDecision.profile)) {
     setError(EMPTY_REPLACE_MESSAGE);
     return;
   }
   ```

2. **Narrow auto-save to `complete` only** (Invariant 3). In `handleScan`, replace the
   `if (decision.action === 'save') { ...auto-save... }` block with:

   - `decision.action === 'save' && result.outcome === 'complete'` → keep the current auto-save +
     `setStatusNotice('Scan completed and profile saved.')`.
   - `decision.action === 'save'` (i.e. incomplete/partial) → **do not write**;
     `setStatusNotice('Incomplete scan. Review it below, then choose Save to keep it.')`.
   - `decision.action === 'skip'` → keep the existing messaging, and **close the silent hole**: today an
     empty `partial` result with no existing profile sets no `statusNotice` at all. Add a final fallback
     branch, e.g. `setStatusNotice('Nothing meaningful was collected. Nothing saved.')`.

3. **Button rendering.** Make the primary action a four-way branch instead of the current
   `saveDecision?.action === 'save' ? <disabled Saved> : <Replace button>`:

   | Condition | Render |
   |---|---|
   | `action === 'save' && !profile.incomplete` | disabled **"Saved"** (auto-saved) |
   | `action === 'save' && profile.incomplete` | enabled **"Save partial profile"** → `handleConfirmSave` |
   | `action === 'skip' && !isProfileEmpty(profile)` | enabled **"Replace saved profile with this partial"** → `handleConfirmSave` |
   | `isProfileEmpty(profile)` | disabled **"Nothing to save from this scan"** + inline hint *"This scan was cancelled or timed out before any data was collected."* |

   The `Discard` / `Close` secondary button stays rendered in all four cases.

4. On successful `handleConfirmSave`, keep `setStatusNotice(...)` but make the copy accurate for both
   flows (e.g. `"Saved incomplete profile."` vs `"Replaced saved profile with this partial scan."`).

### Step 4 — Blocker 1c: tests (`lib/repo-profile/save-policy.test.ts`)

Extend the file that `8d6d9c8` already adds. Keep the `// @vitest-environment node` pragma and the existing
`createMockProfile` / `createEmptyProfile` helpers. Add:

- `isProfileEmpty` returns `true` for `createEmptyProfile()` (the early-cancel shape).
- returns `false` when **only** `repoRef.defaultBranch` is set.
- returns `false` when **only** `stack.languages` is non-empty.
- returns `false` when **only** `stack.framework` is set.
- returns `false` when **only** one `conventions` entry is present.
- **The data-loss regression:** `decideSave(completeExisting, { outcome: "cancelled", profile: createEmptyProfile() })`
  returns `action: "skip"` — an empty cancel can never overwrite a saved complete profile.
- `decideSave(completeExisting, cancelledProfileThatHadOnlyDefaultBranch)` still returns `"skip"` via the
  never-downgrade rule (guards the "don't lose the old profile" path is independent of emptiness).
- `EMPTY_REPLACE_MESSAGE` equals the exact operator-facing string.
- A complete scan result is never empty: `isProfileEmpty` on a full `decideSave(null, completeResult).profile`
  is `false`.

Do not add a UI test — no DOM harness exists and adding one is out of scope. State this limitation in the
PR body so Verify does not read the missing file as an omission.

### Step 5 — Prior-fix regression test (`lib/repo-profile/scan.test.ts`)

Add one case to the existing `describe("scanRepository")` block: abort the controller while Stage 4
(`/git/trees/...`) is in flight; assert `result.outcome === "cancelled"` and
`result.profile.incomplete === true`. This names the exact path Task 4 item 1 calls out. The neighbouring
cases already cover the timeout and backoff-sleep aborts.

### Step 6 — Blocker 2: CHANGELOG (`CHANGELOG.md`)

1. Delete the two blocks (`- **COR-53: ...**`, `- **COR-54: ...**`) currently sitting under `## [Unreleased]`,
   leaving that heading empty.
2. Re-insert them **inside the `## 1.0.2 — 2026-09-21` section**, appended to the end of the existing
   `### Landed Tickets & Architectural Changes` list (after the COR-10 bullet). Both COR-53 (merged via
   PR #21) and COR-54 (via PR #23) are ancestors of the 1.0.2 release commit, so 1.0.2 is the correct home.
3. Rewrite the copy to match what actually shipped:
   - **COR-53 — Repo profile and steering snippet types and encrypted IndexedDB storage.** Zod
     `RepoProfileSchema` / `SnippetSchema` in `lib/types/steering.ts`; AES-GCM encrypted IndexedDB steering
     store (`lib/vault/steering-store.ts`); unified version-2 `open-db.ts` shared with the
     `repopilot-credential-vault` database so vault and steering never race on `onupgradeneeded`.
   - **COR-54 — Hardened GitHub scan pipeline, cancelable scan progress, repository picker, and save policy.**
     4-stage scan (`metadata` / `manifest` / `commits` / `config`) with an internal `AbortController` and a
     15 s deadline; fatal Stage-1 gate, fail-soft later stages; typed `ScanError` with rate-limit backoff and
     UTF-8 base64 decoding; cancelable `ScanProgress` with "Step N of 4" stage labels; debounced `RepoPicker`
     with Link-header pagination, client-side filtering, and manual `owner/repo` validation; never-downgrade
     `decideSave` policy that refuses to let an empty or incomplete scan replace a saved complete profile.
4. Extend the 1.0.2 intro sentence by one clause to mention the encrypted IndexedDB steering store and the
   GitHub scan pipeline, so the section summary matches its contents.

### Step 7 — Local verification gate

```bash
npm ci && npm test && npm run lint && npm run build && npx tsc --noEmit
```

- `node_modules` is **not present** in this workspace; `npm ci` requires network. Run the gate in a
  networked environment and paste the full output into the PR body.
- Watch for: new `react-hooks/set-state-in-effect` eslint errors in `app/settings/repos/page.tsx`
  (main already carries a disable comment on `loadProfiles`; the hardened `RepoPicker` carries one too),
  and `next build` type-checking the new 4-way JSX branch.
- `git diff origin/main...HEAD --stat` should end at 16 files touched by `8d6d9c8` plus the three amended
  files in Steps 2–6.

### Step 8 — Manual smoke checklist (no CI exists)

Unlock vault → scan a repo → cancel during Stage 2 → confirm **no** replace/save button, notice reads
"Nothing meaningful was collected", and the previously saved profile is still listed. Then scan to
completion → confirm the auto-save notice. Then re-scan and cancel after Stage 1 → confirm the disabled
"Nothing to save from this scan" button appears. Reach `/settings/repos` via the Navbar "Repos" button.

### Step 9 — Open the PR

```bash
git push -u origin cor-54-harden-scan-pipeline-v2
gh pr create --base main --head cor-54-harden-scan-pipeline-v2 \
  --title "fix(repo-profile): COR-54 hardening re-applied with empty-scan save guard" \
  --body "<see below>"
```

PR body must state:
- Supersedes closed PR #26; `8d6d9c8` was a direct child of `main` so no rebase was needed.
- Blocker 1: empty partial scans can no longer replace a saved complete profile (hidden control + handler
  guard + `decideSave` `skip`), with the exact operator message.
- Blocker 2: COR-53 / COR-54 relocated from `[Unreleased]` into the `1.0.2` section.
- Invariant-3 narrowing: auto-save now applies to `complete` scans only; incomplete results require a click.
- Prior fixes 1–3 verified present (cite `lib/repo-profile/scan.ts` L512–528, `components/Navbar.tsx:151`,
  `describeScanError` in the `handleScan` catch).
- Known follow-up, out of scope: browser-direct `api.github.com` calls predate this PR; no server token or
  env var was introduced.
- No UI test file: the repo has no DOM test harness (`vitest.config.mjs` is `environment: 'node'`, no
  `@testing-library/*`); the page's decision logic lives in `save-policy.ts` and is unit-tested there.
- Full `npm ci && npm test && npm run lint && npm run build && npx tsc --noEmit` output.

Do **not** add or modify `.github/workflows` (Invariant 4). Do not touch `package.json` dependencies.

## Risks

- The `save-policy.test.ts` case *"saves incomplete result when no existing profile exists"* still asserts
  `action: "save"`. That is a policy-level test and remains correct — the Invariant-3 change lives in the
  page, not in `decideSave`. Do not "fix" that test.
- Edge case accepted: a cancel that lands after Stage 1 populated `defaultBranch` produces a non-empty
  profile, so replacing is still permitted. This is intended — the profile has real data. Only a
  fully-empty cancel is blocked.
- `next build` will catch type errors the page edit could introduce; if the 4-way JSX branch trips
  `no-nested-ternary`, extract the label selection into a small `const` above the `return`.
