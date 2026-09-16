# RepoPilot 1.0.2 Golden Path

Two stages stay strictly separate. Complete this loop on a hosted deploy or local development server.

1. **Settings keys & WebCrypto Vault.** Open Credentials / Settings modal. Create or unlock your WebCrypto passphrase vault. Your provider keys (Jules API key from [jules.google.com/settings](https://jules.google.com/settings), Gemini API key, and GitHub PAT) are encrypted locally using AES-GCM 256-bit with PBKDF2-SHA256 key derivation (210,000 iterations) and stored in IndexedDB (`repopilot-credential-vault/vault-v1`). Any legacy plaintext entries in `localStorage` are automatically migrated and purged. Unlocked keys reside strictly in browser memory and auto-lock after 20 minutes of idle time or tab close/hide. Zero secret keys are ever persisted on server databases.
2. **Connected repo.** In Stage 1 (Dispatch), pick a repository Jules already has as an authorized source (troubleshooter → Connected Repos via `/api/jules/sources`), or type `owner/repo` after installing the Jules GitHub app on that repo. Do not use a Gemini key in the Jules field.
3. **Dispatch.** Set an objective statement, at least one testable acceptance criterion, and file-boundary globs. Click **Dispatch to Google Jules** (or **Dry-run (simulation)** if testing offline without a key). The compiled contract blueprint is saved locally to the vault.
4. **Wait for the PR, then audit.** Keep the tab visible or use manual refresh. RepoPilot watches the Jules session (15s backoff, up to 20 min) and harvests `prUrl` when Jules opens a pull request on GitHub. Click **Audit this PR in Stage 2**.
5. **Evaluate (Gemini PR Audit & Scorecard).** Stage 2 prefills the real PR URL and fetches the diff. Click **Evaluate** (Gemini evaluation is an explicit operator click). Read the server-graded scorecard: `criteria − scope = total`. The **deterministic diff sanitizer outranks LLM evaluation**: if any unauthorized path is detected outside declared boundaries, a **−35 scope penalty** is applied and the verdict is capped at `NEEDS_REVISION` or `BLOCKED` (never `READY_TO_MERGE`).
6. **Operator-approved same-branch remediation.** If the verdict is not ready to merge, the operator chooses between two explicit click-gated paths:
   - **Continue Jules session**: Posts the structured `FailureBrief` back into the same live session (`POST /api/jules/message`).
   - **New session with brief**: Remediation dispatch targeting the active PR head branch (`startingBranch` = head, `automationMode` omitted). Both paths target the audited PR branch directly so fixes push onto the existing PR without creating rogue branches.
7. **Local Outcome Analytics.** First-pass `READY N / M` outcome logging is recorded strictly in local browser storage (`repopilot_outcome_log`) for local tracking without external telemetry.

Simulation modes (**Load sample** in Stage 1 and **Load Demo PR** in Stage 2) do not call live Jules endpoints.
