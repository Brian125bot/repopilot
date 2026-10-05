# Changelog

## [Unreleased]

### Added

- **Built-in snippet library, fork-on-edit, and encrypted import/export (COR-58):**
  - **Expanded built-in set.** The steering library grows from 4 to 20 built-in snippets, five per shipped category, all with stable `builtin-` ids and the shared frozen `2026-09-01T00:00:00.000Z` stamp. `lib/snippets/builtin-loader.ts` keeps validating every entry with `parseSnippet` at module load, and the four pre-existing ids (`builtin-run-tests`, `builtin-verify-lint`, `builtin-explain-diff`, `builtin-explain-failure`) are unchanged so nothing an operator has already referenced disappears. New entries cover verification (security scan, production build, environment-config drift), investigation (change surface, data flow, conventions, callers), remediation (minimal fix, revert, test fixture, change splitting) and general (reviewer summary, release note, PR description, acceptance criteria, rollback).
  - **Settings → Snippet library** (`/settings/snippets`, linked from the navbar next to **Repos**): lists every built-in and custom snippet, searches titles and content, filters by category, pins, and shows fork provenance. Custom snippets can be created, edited and deleted. Nothing saves without an explicit click.
  - **Fork instead of edit.** A built-in row is labelled "Built-in · edit to fork"; **Fork** and **Edit** both open an editor whose save mints a genuinely new record (`forkSnippet`: fresh non-`builtin-` id, `isBuiltin: false`, `isPinned: false`, `usageCount: 0`, `forkedFromId` set to the original, real timestamps instead of the built-in stamp). Deleting a built-in is not a silent no-op: the row surfaces the existing `Built-in snippets cannot be deleted.` message followed by "Edit to fork this snippet." and routes the operator into that editor. No second delete guard was added — the store's existing guard is the only one.
  - **Optional `forkedFromId` on `SnippetSchema`.** The field is optional on purpose: records already in operator vaults were written under `STEERING_SCHEMA_VERSION = 1` without it, and `unwrapRecord` validates every decrypted record, so a required field would have made every pre-existing snippet fail validation and be silently dropped by `listSnippets` on upgrade. `__tests__/steering-schema.test.ts` carries that upgrade regression as a hermetic test that writes an old-shape record and asserts it still lists.
  - **Encrypted import/export** (`lib/snippets/import-export.ts`): the bundle is AES-GCM + PBKDF2-SHA256 encrypted through the existing `wrapRecord`/`unwrapRecord` helpers — no second encryption path, no new dependency, no new API route, no server-held secret. Conflict resolution (`replace` / `merge` / `skip duplicates by title`) is a pure function over parsed snippet arrays with no crypto, vault or IndexedDB, so it is unit tested directly.
  - **Honest limitations.** The ticket's five categories (Approve, Redirect, Scope, Quality, Process) are not the persisted taxonomy; the shipped four-value `SnippetCategorySchema` (`investigation` / `verification` / `remediation` / `general`) was kept rather than silently widening a persisted strict enum, and the ticket's labels map onto it (Approve and Redirect → `general`, Scope → `investigation`, Quality → `verification`, Process → `remediation`). Export carries **custom snippets only** — built-ins ship with the app — and is wrapped with an operator-supplied *export passphrase* that is independent of the vault key, so a bundle restores in a fresh browser without transferring the vault; that passphrase is unrecoverable if lost, and nothing is written to the vault until Import is clicked. The bundle is encrypted, but snippet text can contain repository conventions or pasted credentials, so the downloaded file must be treated as sensitive. Duplicate detection matches on trimmed, case-insensitive **title** only, and `merge` keeps both copies by giving the incoming one a fresh id. There is no bundle migration path beyond `version: 1`; a future format change would need one. The three new components have no automated UI coverage — vitest runs in the node environment and the repo has no DOM test setup.
  - **Import hardening (PR #34 review follow-up).** Replace-mode imports are driven by a pure `planImportWrites(current, resolved)` diff — upsert every resolved record that differs from the stored record with the same id, delete only the ids that vanished — replacing the previous "new ids only" heuristic, which silently no-opped an identical re-import, skipped a same-id rename, and could delete one snippet while leaving another stale when an import reused a stored id. All three cases are tested by running the exact write plan against a memory store. Replace-mode resolution also deduplicates by id, so two local records sharing a title (a merge can leave that behind) can no longer push the same incoming record twice, and a hand-edited bundle carrying a repeated id is deduplicated before resolving. Imports are capped: at most 500 snippets per bundle, envelope base64 fields and snippet ids / `forkedFromId` are length-capped, and a file over 5 MB is rejected before it is read into memory. Import is now a two-click flow — picking a file only stages it, and a replace that would delete stored snippets asks for one explicit confirmation before anything is written; deleting a custom snippet also confirms first. The locked settings view renders the built-in catalogue read-only, matching its copy.

- **Goal Ingestion (COR-56):** Start-session goal modal (`StartSessionModal`), Gemini extraction proxy (`/api/goal/extract`), edit-and-confirm flow with profile context bounding, and encrypted IndexedDB goal storage.
  - **Capture and review.** `StartSessionModal` is mounted in the dispatch workflow (`IntakeDispatchStage`) and opens before every dispatch. The operator enters freeform text, Gemini returns a structured goal (`title`, `scope`, `acceptanceCriteria`, `assumptions`, `ambiguityFlags`), and the operator edits and confirms it. **"Skip extraction"** stores the raw text with `extracted: null`. Nothing is ever confirmed or dispatched automatically: Confirm stays disabled while the title is `UNCLEAR` or the criteria list is empty, and closing the dialog aborts a pending dispatch.
  - **Profile-bounded extraction.** When a COR-54 `RepoProfile` is saved for the target repository it is passed to the extraction prompt, which injects the detected languages, framework, package manager, test runner, conventions, and operator instructions. Acceptance criteria are asked to cite the repository's real command form (derived from what was actually detected, e.g. `npm test lib/example.test.ts`) and never to invent paths. A missing or unreadable profile degrades to stack-agnostic extraction rather than blocking it.
  - **Encrypted goal storage.** Goals are AES-GCM encrypted with the same PBKDF2-SHA256 vault mechanism as credentials and steering profiles, reusing `wrapRecord`/`unwrapRecord` rather than reimplementing crypto. They live in the existing `repopilot-credential-vault` database in a new `goals-v1` object store, keyed by session id. Because an IndexedDB upgrade handler only runs when the version number increases, that database was bumped from version `2` to `3` so operators already on `2` actually receive the store. Encryption and write failures surface as a visible notice ("Failed to save goal to vault — please check your passphrase and retry") and keep the dialog open; they are never swallowed.
  - **Passphrase handling.** The modal collects the vault passphrase itself because `useCredentialVault` deliberately does not retain it. The passphrase is used for exactly two things — reading the saved repo profile and encrypting the goal — is never sent to the server, and is discarded when the dialog closes.
  - **Dispatch hand-off.** Confirming maps the extracted `acceptanceCriteria` onto the Stage 1 criteria list so the existing pre-dispatch gate, `compileJulesPrompt`, the `AUDIT_BLUEPRINT`, and Stage 2 scoring all carry them unchanged, and adds an optional `goal` field to the dispatch payload that `compileJulesPrompt` renders as an additive `§1.1 Goal Ingestion` block. Section 3 remains the authoritative criteria matrix, so a goal can never widen the authorized blast radius, and a prompt compiled without a goal is byte-identical to its pre-COR-56 output.
  - **Honest limitations.** The goal is keyed by a pre-dispatch `draft-…` id because no Jules session exists at capture time, so `getGoal` looks a goal up by that id rather than by a Jules session id. Confirming a goal replaces the Stage 1 criteria list; because extracted criteria are not guaranteed to satisfy the functional/testing/constraint balance that `preDispatchGate` requires, the first dispatch after a confirmation can be refused client-side with a visible error, which the operator resolves by editing the criteria and dispatching again.
  - The Gemini key is still read only from the client-supplied `x-gemini-api-key` header: no server-held key, no environment variable, and no key in logs. The extraction route returns `400 INVALID_INPUT`, `401 UNAUTHORIZED`, `422 INVALID_INPUT`, or `502 UPSTREAM_ERROR` and discards upstream error text, which can echo prompt content.

## 1.0.3 — 2026-10-02

Hardening pass over the COR-54 scan pipeline. The 1.0.2 pipeline scanned a repository in four stages with a cooperative deadline, and auto-saved an early-terminated scan as an `incomplete` profile; this work makes the failure modes typed and the save path operator-gated. No architectural contract changes: profiles still live only in the encrypted IndexedDB steering store, and no server-held token or environment variable is introduced.

### Hardening & Fixes

- **Typed scan stages with a fatal Stage 1 gate**:
  - Stages are typed as `ScanStage` (`metadata` / `manifest` / `commits` / `config`) and the run returns a typed `ScanResult` (`profile`, `outcome`, `issues`) instead of a bare profile.
  - Stage 1 is a fatal gate: if the repository does not resolve, the scan throws a typed `ScanError` and no later stage runs. Later stages are fail-soft and record a `ScanIssue` (`stage`, `code`, `status`, `message`) rather than aborting the run.
  - Scan outcomes are now four-valued — `complete`, `partial`, `cancelled`, `timed_out` — and every non-complete outcome is flagged `incomplete: true` on the profile, including aborts during the final config stage.
- **Typed `ScanError` codes and operator-facing messages**:
  - Added `ScanError` with codes `invalid_ref`, `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `network`, and `http_error`, surfaced through `describeScanError` instead of a raw exception message.
  - `validateAndParseRef` rejects malformed `owner/repo` before any network call, so a bad ref costs zero requests.
- **Internal `AbortController` and abortable rate-limit retry**:
  - The scanner owns an internal `AbortController` bridged to the caller's signal, so a cancel or deadline takes effect even while a request is in flight, and the abort listener is detached once each request settles instead of accumulating for the life of the scan.
  - Rate-limit handling distinguishes a bare `403` (forbidden, not retried) from a genuine limit, and retries at most once with a wait that the deadline can interrupt.
  - Manifest contents are decoded as UTF-8 rather than latin-1, so non-ASCII `package.json` names survive.
- **Scan progress and repository picker**:
  - `ScanProgress` labels the active stage as "Step N of 4" and always offers an explicit cancel.
  - `RepoPicker` is debounced, paginates via `Link` headers, filters client-side, retries on failure, and validates manual `owner/repo` input with the same rules the scanner enforces. Pagination follows a `rel="next"` URL only when it resolves to `https://api.github.com`, so the operator's PAT is never sent to a host named by a response header.
- **Never-downgrade save policy, gated on an operator click**:
  - `decideSave` formalises the policy. A **complete** scan may replace a saved profile, but only after an explicit click — the UI offers "Save and replace saved profile" instead of writing silently. A **non-empty partial** scan may also replace a complete saved profile, but only behind a second confirmation that states how many saved conventions are overwritten, how many the partial scan detected, and the date the saved profile was saved. An **empty** scan — a cancel or timeout that collected nothing — can never be saved by any route: the control renders disabled as "Nothing to save from this scan" and the save handler refuses with *"Cannot replace existing profile with an empty scan result."*
  - The only automatic write is a complete scan of a repository with no saved profile, where there is nothing to overwrite.
  - The save/replace control is disabled whenever no decision is available, and "Saved" is shown only after the vault write actually resolves — a failed write leaves the control enabled and reports the error.
  - The settle notice for a cancelled or timed-out scan now says nothing was collected only when the scan profile is actually empty: "Cancelled before any data was collected. Nothing saved." for a cancel, and "Timed out before any data was collected. Nothing saved." for a timeout. A scan stopped in Stage 2 or later with no saved profile, or only an incomplete one, now reports that it was cancelled or timed out with partial data that has not been saved yet, instead of wrongly claiming nothing was collected. The save/replace controls and the empty-scan guard are unchanged.
- **Commit and ref parsing accuracy**:
  - Ticket keys are only recognised in an anchored position (start of subject, leading bracket, conventional-commit scope, or trailing parenthetical) which reduces false matches on standards names such as `SHA-256`, `UTF-8`, or `ISO-8601`. It does not eliminate them: the conventional-commit scope pattern is case-insensitive, so a scope like `feat(sha-256)` is still read as ticket `sha`.
  - Skipped merge commits are excluded from the 30% convention threshold, so a merge-heavy repository is no longer penalised for history it did not author.
  - Branch names containing `/` keep their slashes in the git-trees request, which the GitHub endpoint requires to resolve the ref.

### Documentation

- Corrected three 1.0.2 entries below for accuracy against what shipped at `5229949`: provider key verification is click-triggered, the 15s scan deadline did not abort in-flight requests, and any scan error (not only a cancel or timeout) auto-saved an `incomplete` profile. The COR-34 heading and the 1.0.2 summary were also corrected to drop the "verify on first paint" claim.

## 1.0.2 — 2026-09-21

Zero-auth, zero-server release featuring client-side WebCrypto credential isolation, encrypted IndexedDB steering storage, an initial GitHub repository scan pipeline, audited PR head SHA drift rejection, click-to-verify provider keys with a verify-before-dispatch gate, security headers & empty-env contract, and documentation honesty.

### Landed Tickets & Architectural Changes

- **COR-36: Security headers & public empty-environment contract**:
  - Added security headers (`Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`) via `vercel.json` and `next.config.ts` for hosted hybrid Vercel deployments.
  - Documented public empty-environment contract across `.env.example` and `SECURITY.md`: public Vercel projects MUST leave `JULES_API_KEY`, `GEMINI_API_KEY`, and `GITHUB_PAT` unset to ensure multi-user credential isolation.
- **COR-40: Persisted audited PR head SHA & drift rejection**:
  - Locked remediation dispatch and continuation prompt compilation to the exact `auditedHeadSha` captured during Stage 2 evaluation.
  - Fail-closed gate (`400 INVALID_INPUT`) blocks remediation if the current PR head branch diverges from the audited SHA, preventing Jules from executing fixes on un-audited commits or falling back to `main`.
- **COR-34: Settings provider key Verify checks & verify-before-dispatch gate**:
  - Click-triggered **Verify** checks for provider credentials (Google Jules, Google Gemini, GitHub PAT) in the Settings modal. Verification is not automatic; it runs only when the operator clicks **Verify**.
  - Validates key authorizations, scopes, and target repository connections without exposing secret key material in error payloads or logs.
- **COR-35: Encrypted WebCrypto browser vault & plaintext wipe**:
  - Implemented WebCrypto AES-GCM 256-bit client-side credential vault backed by PBKDF2-SHA256 key derivation (210,000 iterations).
  - Ciphertext envelopes stored in IndexedDB under database `repopilot-credential-vault` (`vault-v1`), keeping unlocked keys exclusively in non-persisted browser memory (`MemoryVault`).
  - Session auto-locking after 20 minutes of idle time (`VAULT_IDLE_TIMEOUT_MS = 1,200,000ms`) or on tab close/hide (`visibilitychange`, `pagehide`, `beforeunload`).
  - Automatic one-shot migration and purging of legacy plaintext `localStorage` credentials (`repopilot_jules_key`, `repopilot_gemini_key`, `repopilot_github_pat`). Server endpoints reject secret key attributes (`/api/vault`).
- **COR-10: Purged fabricated benchmarks & documentation honesty**:
  - Repo-wide audit and removal of unverified benchmark statistics (e.g., legacy fabricated marketing percentages) across documentation.
  - Aligned documentation with true system mechanics: deterministic diff sanitizer priority (-35 penalty), click-gated operator remediation ("Continue Jules session" and "New session with brief"), and local outcome analytics (`repopilot_outcome_log`).
- **COR-53: Repo profile & steering snippet types with encrypted IndexedDB storage**:
  - Added Zod schemas `RepoProfileSchema` and `SnippetSchema` (`lib/types/steering.ts`) covering repository profiles, convention entries, and steering snippets, with `parseRepoProfile` / `parseSnippet` guards and strict field validation.
  - Implemented a client-side WebCrypto AES-GCM encrypted steering store (`lib/vault/steering-store.ts`) for repository profiles and steering snippets in IndexedDB (`profiles-v1` and `snippets-v1`). Plaintext never touches storage; keys stay in non-persisted browser memory.
  - Unified the IndexedDB database opener (`lib/vault/open-db.ts`) at schema version 2 so the credential vault and the steering store share a single upgrade path and cannot race on `onupgradeneeded`.
- **COR-54: GitHub scan pipeline & scan UI**:
  - Added a four-stage repository scan (`metadata`, `manifest`, `commits`, `config`) that reads public GitHub data with the operator's browser-held PAT, extracting the default branch, detected languages, package manager / framework / test runner, and lint & format conventions into a `RepoProfile`.
  - Added a cooperative 15s scan deadline, checked only between GitHub requests. It did not abort a request already in flight, so a hung GitHub request could keep the run going past the deadline.
  - Added an explicit cancel control to the scan progress panel, and a repository picker with a plain `owner/repo` manual entry field alongside the operator's repository list.
  - A complete scan result is held for an explicit **Save Profile** click. Any scan that did not complete — cancelled, timed out, or stopped by any error thrown during the scan (for example a network failure) — returned an `incomplete` profile that was written straight to the encrypted IndexedDB steering store, overwriting any existing entry for that repository.

## 1.0.1 — 2026-09-14 (@ 1f4f4e7)

First tagged update to the frozen two-stage loop. Everything below shipped between the `v1.0.0` tag and this release: operator-in-the-loop Continue-with-brief remediation, first-pass intake quality gates, grounded server-side grading, and a dual-runtime vault with grounded PR verification.

### Continue-with-brief remediation (operator-in-the-loop)

- 1.0.0 froze the two-stage loop and the Outcome Memory libraries (`buildFailureBrief`, `compileContinuationPrompt`, outcome log turns).
- Continue-with-brief wired as the primary blocked-audit action: **Continue Jules session** (`POST /api/jules/message` + FailureBrief) with **New session with brief** fallback (remediation dispatch, same brief, same PR branch, `automationMode` omitted). Operator stays in the loop; Evaluate is still a click.
- `lastBrief` persisted across Stage 2 hydration and vault round-trips so remediation resumes without re-audit; fallback paths documented in the user guide.

### First-pass intake gates & deep repo grounding

- Contract lint and a pre-dispatch gate with grounded prompts, category coverage, and a definition-of-done self-check; always-strict criteria.
- Deep repo inspection: recursive tree, test-command detection, and framework detection feed boundary generation; criteria are validated against the real tree.
- First-pass analytics recorded in the outcome log.
- Verification contract is local-only: `npm ci && npm test && npx tsc --noEmit`. GitHub Actions is intentionally omitted; historical failed checks on older commits are obsolete.

### Grounded server grade & decision-first scorecard

- Server is the single truth for merge readiness: `report.grade` computed in `/api/audit/evaluate` via `attachAuditGrade()` (the UI renders it, recomputing only for old cached reports).
- Headline math unchanged (`criteria − scope = total`, flat −35, `READY` only in-scope + all MET + ≥85) but owned once by `computeScorecardMetrics()`.
- Granularity: `satisfiedAspects` / `remainingWork` per criterion, normalized category join (`CRIT-1`/`01`/`1`), category rollup, `MET/PARTIAL/UNMET of total` chips, decision-first ordering (UNMET → PARTIAL → MET).
- Accuracy: sanitizer-outranks-model scope union (`unionUnauthorizedPaths`), `path:lines` validation (`unverifiedReferences` = “cited, not in diff”), truncation contract (sanitizer 100k / evaluate 80k, `diffFacts.truncated/shownChars` + UI warning).
- Relevance: severity-grounded change risk (critical files → `HIGH`, non-critical drift → `MEDIUM`, volume bands otherwise), `Why this grade[≤3]` + `Next: merge/revert_scope/remediate/blocked`, enriched remediation prompt (`Score`, `Next`, `Change Risk`, `Remaining`/`Satisfied`/`Category`), grade-aware `FailureBrief` and outcome log.
- UI split: `MergeScorecard` orchestrates new `components/scorecard/{ScoreHeader,WhyNextCard,ScopeRiskCoverageGrid,CriteriaMatrix}`.

### Grounded verification & dual-runtime vault

- **Grounded mergeability**: PR ingestion reads GitHub check runs + `mergeable` state (`githubStatus`); conflicts or failing checks cap `READY_TO_MERGE` at `NEEDS_REVISION` with named reasons and a Checks & Branch Health widget.
- **Tree-grounded boundaries**: generation validates suggested globs against the real git tree, rejects hallucinations (`rejectedGlobs`), falls back to real top-level dirs.
- **Unified diff budget**: one shared 90k-char budget with reserved per-file allocation, hunk-aware cuts, and omission headers; secondary model-side slicing removed.
- **Dual-runtime vault**: `GET`/`POST`/`DELETE /api/vault` backed by local `.repopilot/vault.json` or Upstash REST; server-first hydration with localStorage fallback.
- **Resilient polling**: tiered 15s → 30s → 60s backoff (25-min cap), instant refresh on tab-visible, Check Session Status button, PR-detected handoff toast, harvest-to-vault recovery.
- Remediation now requires the audited PR head (400 otherwise — no `main` fallback); live dispatches persist only real Jules session ids (`dry_` ids for dry runs, 502 when Jules returns none).

### Tests

- 38 files / 361 tests green under the local gate (`npm ci && npm test && npx tsc --noEmit`), including `audit-grade` (34), `audit-server-grade` (8), `remediation-prompt-quality` (27), `contract-lint` (12), and `merge-readiness` (12).

## 1.0.0

First curated release of the Jules → audit loop.

- Outcome Memory libraries (`buildFailureBrief`, `compileContinuationPrompt`, outcome log turns), deterministic scoring (`computeScorecardMetrics`, scope-forced reconciliation), and fail-closed dispatching (key/source/branch validation, no fabricated session ids).
- Stage 1 starts empty; **Load sample** restores the rate-limiter contract. Dry-run and Load Demo PR are labeled as simulation.
- Navbar job chrome: idle / watching / PR ready / last verdict.
- Operator copy: dispatch, wait for PR, audit, fix. Two stages remain.
- Session watch (15s, 20 min, tab-visible) and GitHub PR lookup by head branch.
- Gemini User-Agent `RepoPilot/1.0`. Evaluate route `maxDuration` 60s with retryable timeout.
- Local gate: `npm ci && npm test && npx tsc --noEmit`.
- LICENSE (MIT), SECURITY.md, [golden path](./docs/GOLDEN_PATH.md).
