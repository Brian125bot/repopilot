# RepoPilot 1.0 golden path

Two stages stay separate. Complete this loop on a hosted deploy or `npm run dev`.

1. **Settings keys.** Open Credentials. Paste a Jules API key from [jules.google.com/settings](https://jules.google.com/settings), a Gemini API key, and a GitHub PAT. Press **Test Key** / test PAT. Keys stay in this browser only.
2. **Connected repo.** In Stage 1 (Dispatch), pick a repository Jules already has as a source (troubleshooter → Connected Repos), or type `owner/repo` after installing the Jules GitHub app on that repo. Do not use a Gemini key in the Jules field.
3. **Dispatch.** Set an objective, at least one acceptance criterion, and file-boundary globs. **Dispatch to Google Jules** (or **Dry-run (simulation)** if you have no Jules key). The contract is saved to the vault.
4. **Wait for the PR, then audit.** Keep the tab visible. RepoPilot watches the Jules session (15s, up to 20 min) and harvests `prUrl` when Jules opens a pull request. Click **Audit this PR in Stage 2**. If you arrive early, Stage 2 waits or looks up the branch.
5. **Evaluate.** Stage 2 prefills the real PR URL and fetches the diff when a PR is known. Press **Evaluate** (Gemini is a click, not automatic). Read the scorecard: criteria, scope, blast radius.
6. **Same-branch remediation.** If the verdict is not ready to merge, 1-click **fix** dispatches Jules onto the audited PR branch (`startingBranch` = head). Do not open a new PR.

Simulation: **Load sample** on Stage 1 and **Load Demo PR (simulation)** on Stage 2 do not call Jules for a live repo.
