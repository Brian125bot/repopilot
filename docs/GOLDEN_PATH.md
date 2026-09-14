# RepoPilot 1.0.1 golden path

Two stages stay separate. Complete this loop on a hosted deploy or `npm run dev`.

1. **Settings keys.** Open Credentials. Paste a Jules API key from [jules.google.com/settings](https://jules.google.com/settings), a Gemini API key, and a GitHub PAT. Press **Test Key** / test PAT. Keys stay in this browser only.
2. **Connected repo.** In Stage 1 (Dispatch), pick a repository Jules already has as a source (troubleshooter → Connected Repos), or type `owner/repo` after installing the Jules GitHub app on that repo. Do not use a Gemini key in the Jules field.
3. **Dispatch.** Set an objective, at least one acceptance criterion, and file-boundary globs. **Dispatch to Google Jules** (or **Dry-run (simulation)** if you have no Jules key). The contract is saved to the vault.
4. **Wait for the PR, then audit.** Keep the tab visible. RepoPilot watches the Jules session (15s, up to 20 min) and harvests `prUrl` when Jules opens a pull request. Click **Audit this PR in Stage 2**. If you arrive early, Stage 2 waits or looks up the branch.
5. **Evaluate.** Stage 2 prefills the real PR URL and fetches the diff when a PR is known. Press **Evaluate** (Gemini is a click, not automatic). Read the server-graded scorecard: `criteria − scope = total`, `MET/PARTIAL/UNMET` counts, scope integrity, severity-grounded change risk, `Why this grade` + `Next` decision, and the decision-ordered criteria matrix (`Already in place` / `Remaining`, unverified refs flagged).
6. **Same-branch remediation (operator-approved).** If the verdict is not ready to merge, click **Continue Jules session** to post the FailureBrief back into the same session, or **New session with brief** when there is no session to continue (same brief, same PR branch, `startingBranch` = head). Do not open a new PR. COMPLETED sessions may reject follow-ups — that fallback is expected.

Simulation: **Load sample** on Stage 1 and **Load Demo PR (simulation)** on Stage 2 do not call Jules for a live repo.
