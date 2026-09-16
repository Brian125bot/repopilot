# RepoPilot: Autonomous Agent Orchestrator & PR Audit Engine

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-5.0.0-brightgreen?style=flat-square&logo=vitest)](https://vitest.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-PR%20Audit%20Engine-8E75B2?style=flat-square&logo=google)](https://ai.google.dev/)
[![Jules](https://img.shields.io/badge/Google%20Jules-Async%20Cloud%20Agent-4285F4?style=flat-square&logo=googlecloud)](https://jules.google.com/)

**Decoupled Autonomous Agent Control Plane with WebCrypto Credential Isolation, Deterministic Anti-Drift Boundary Enforcement, and Click-Gated Operator Remediation**

</div>

---

## 📚 Documentation Hub

RepoPilot **1.0.2** documentation:

- 🚀 **[Golden path (6 steps)](./docs/GOLDEN_PATH.md)**: WebCrypto vault setup → connected repo → dispatch → wait/audit PR → evaluate → same-branch fix.
- 📖 **[Google Jules User Guide & Automation Playbook](./docs/USER_GUIDE_JULES_AUTOMATION.md)**: How RepoPilot organizes task contracts and the review loop with Jules.
- ⚙️ **[Technical Systems Specification](./docs/TECHNICAL_SPECIFICATION.md)**: Architecture, diff parsing, glob compilation, hydration, Gemini schema, threat model.
- 🧪 **[Testing Strategy Guide](./docs/TESTING_STRATEGY.md)**: Vitest conventions. Verify locally:
added 464 packages, and audited 465 packages in 21s

165 packages are looking for funding
  run `npm fund` for details

2 vulnerabilities (1 moderate, 1 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

> repopilot@1.0.1 test
> vitest run


[1m[30m[46m RUN [49m[39m[22m [36mv5.0.0 [39m[90m/app[39m

 [32m✓[39m __tests__/audit-grade.test.ts [2m([22m[2m34 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m __tests__/remediation-prompt-quality.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 73[2mms[22m[39m
 [32m✓[39m __tests__/outcome-memory.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 23[2mms[22m[39m
 [32m✓[39m __tests__/jules-dispatch.test.ts [2m([22m[2m50 tests[22m[2m)[22m[32m 84[2mms[22m[39m
 [32m✓[39m __tests__/audit-engine.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 57[2mms[22m[39m
 [32m✓[39m __tests__/settings-verify.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 48[2mms[22m[39m
 [32m✓[39m __tests__/validation.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 60[2mms[22m[39m
 [32m✓[39m __tests__/merge-readiness.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 43[2mms[22m[39m
 [32m✓[39m __tests__/jules-session.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 49[2mms[22m[39m
 [32m✓[39m __tests__/dispatch-gate.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 70[2mms[22m[39m
 [32m✓[39m __tests__/vault.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 66[2mms[22m[39m
 [32m✓[39m __tests__/jules-message.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 46[2mms[22m[39m
 [32m✓[39m __tests__/prompt-compiler.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 13[2mms[22m[39m
 [32m✓[39m __tests__/diff-sanitizer.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m __tests__/audit-server-grade.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m __tests__/gemini-scoring.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32m✓[39m __tests__/github-status.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m __tests__/diff-sanitizer-extended.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 43[2mms[22m[39m
 [32m✓[39m __tests__/repo-inspect-deep.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 46[2mms[22m[39m
 [32m✓[39m __tests__/tree-grounding.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m __tests__/first-pass-analytics.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32m✓[39m __tests__/contract-lint.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 19[2mms[22m[39m
 [32m✓[39m __tests__/audited-sha-persist.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m __tests__/blueprint-vault.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 10[2mms[22m[39m
 [32m✓[39m __tests__/scoring-extended.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32m✓[39m __tests__/credential-vault-migration.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 405[2mms[22m[39m
 [32m✓[39m __tests__/remediation-workflow.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/jules-github-helpers.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32m✓[39m __tests__/security-headers.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m __tests__/criteria-generate-balance.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 58[2mms[22m[39m
 [32m✓[39m __tests__/github-pr-lookup.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32m✓[39m __tests__/outcome-log.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m __tests__/outcome-grade.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32m✓[39m __tests__/session-poll.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m __tests__/job-status.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/scorecard-smoke.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/credential-vault-crypto.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 1969[2mms[22m[39m
   [32m✓[39m credential vault AES-GCM round-trip [2m(11)[22m
     [33m[2m✓[22m[39m fails closed with a fixed sentence on wrong passphrase[33m 385[2mms[22m[39m
 [32m✓[39m __tests__/settings-keys.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m __tests__/first-pass-storage.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m __tests__/stage-handoff.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/api-routes-extended.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 169[2mms[22m[39m
 [32m✓[39m __tests__/infra.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m __tests__/credential-vault-lock.test.ts [2m([22m[2m8 tests[22m[2m)[22m[33m 417[2mms[22m[39m
 [32m✓[39m __tests__/v1-release.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/sample-contract.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/evaluate-timeout.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 7[2mms[22m[39m

[2m Test Files [22m [1m[32m46 passed[39m[22m[90m (46)[39m
[2m      Tests [22m [1m[32m453 passed[39m[22m[90m (453)[39m
[2m   Start at [22m 13:53:08
[2m   Duration [22m 6.56s[2m (import 39%, tests 38%, transform 19%, worker 4%)[22m

[2m    Isolate [22m [33m46 workers spawned[39m[2m · ~161ms startup each (spawn + environment, per file)[22m
[2m            [22m [2mat least ~2.31s faster with [22m[33misolate: false[39m[2m — reuses workers across files instead of one per file[22m


> repopilot@1.0.1 lint
> eslint .


/app/hooks/use-credential-vault.ts
   72:6  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
   83:6  warning  React Hook React.useCallback has a missing dependency: 'vaultRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps
  140:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  174:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  192:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  199:6  warning  React Hook React.useCallback has a missing dependency: 'storeRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps
  217:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  225:5  warning  React Hook React.useCallback has a missing dependency: 'vaultRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps
  233:6  warning  React Hook React.useCallback has a missing dependency: 'storeRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps

✖ 9 problems (0 errors, 9 warnings)


> repopilot@1.0.1 build
> next build

   ▲ Next.js 15.5.25

   Creating an optimized production build ...
 ✓ Compiled successfully in 3.9s
   Linting and checking validity of types ...
   Collecting page data ...
   Generating static pages (0/17) ...
   Generating static pages (4/17)
   Generating static pages (8/17)
   Generating static pages (12/17)
 ✓ Generating static pages (17/17)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                                 Size  First Load JS
┌ ○ /                                    85.6 kB         188 kB
├ ○ /_not-found                            991 B         104 kB
├ ƒ /api/audit/evaluate                    153 B         103 kB
├ ƒ /api/audit/fetch-diff                  153 B         103 kB
├ ƒ /api/criteria/generate                 153 B         103 kB
├ ƒ /api/github/status                     153 B         103 kB
├ ƒ /api/jules/dispatch                    153 B         103 kB
├ ƒ /api/jules/message                     153 B         103 kB
├ ƒ /api/jules/session                     153 B         103 kB
├ ƒ /api/jules/sources                     153 B         103 kB
├ ƒ /api/repo/inspect                      153 B         103 kB
├ ƒ /api/settings/verify-gemini            153 B         103 kB
├ ƒ /api/settings/verify-github            153 B         103 kB
├ ƒ /api/settings/verify-jules             153 B         103 kB
└ ƒ /api/vault                             153 B         103 kB
+ First Load JS shared by all             103 kB
  ├ chunks/255-37e0f0325134c4d7.js       46.4 kB
  ├ chunks/4bd1b696-c023c6e3521b1417.js  54.2 kB
  └ other shared chunks (total)           1.9 kB


○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand.
- 📐 **[System Architecture](./ARCHITECTURE.md)**: Sequence flows and anti-drift rules.
- 🔐 **[SECURITY.md](./SECURITY.md)**: WebCrypto vault specification, PBKDF2/AES-GCM isolation, session locking, and zero-server secret policy.
- 📝 **[CHANGELOG](./CHANGELOG.md)**: Release history including 1.0.2 and 1.0.1 tag references.
- 📄 **[LICENSE](./LICENSE)**: MIT.

---

## Executive Summary: Precision Control Plane for Google Jules

**Google Jules** is Google's cloud-native asynchronous coding agent designed to autonomously tackle engineering tasks directly on GitHub repositories. While Jules provides remarkable raw capabilities, running autonomous agents without guardrails introduces severe challenges:

- **Scope Drift & Hallucinations**: Agents frequently edit out-of-scope files, alter root dependency manifests (), and modify build configurations.
- **High Review Friction**: Human reviewers must manually inspect sprawling diffs across dozens of files to verify if all acceptance criteria were met.
- **Rogue Multi-Turn Branches**: Re-prompting Jules manually often creates new divergent branches rather than committing directly to the active pull request.

**RepoPilot** is the **precision control plane and automated quality assurance layer** for Google Jules, introducing a strictly decoupled two-stage lifecycle:

1. **Stage 1: Intent, Scope & Jules Cloud Dispatch**: Developers formulate crisp acceptance criteria and declared file boundary globs. RepoPilot compiles an anti-drift markdown contract (with embedded blueprint metadata) and dispatches asynchronously to Google Jules Cloud Agents with fail-closed error handling.
2. **Stage 2: Gemini PR Audit & Operator-Approved Remediation**: Upon PR creation, RepoPilot fetches the diff, sanitizes lockfiles and build noise, reconstitutes criteria from embedded PR comments, and executes an automated audit using Gemini structured outputs reconciled with deterministic scoring algorithms. If blockers exist, the operator picks one of two explicit paths — **Continue Jules session** (posts the FailureBrief back into the same session via ) or **New session with brief** (remediation dispatch on the same PR branch,  = PR head,  omitted). Nothing is sent to Jules without an explicit click.

---

## Why Use RepoPilot with Google Jules?

| Challenge with Raw Jules Prompts | How RepoPilot Helps | What the Operator Reviews |
| :--- | :--- | :--- |
| **Agent touches unrelated files** | Strict glob boundaries (, ) parsed via regex without false prefix matches | Scorecard flags out-of-scope files; deterministic sanitizer forces a −35 scope penalty (never READY) |
| **Vague acceptance criteria** | Structures requirements into atomic criteria across functional, security, and performance categories | Per-criterion evidence and status (, , ) in the audit report for review |
| **Manual PR review bottleneck** | Automated Gemini evaluation produces per-criterion verdicts with line citations | Structured audit report with recommendations and blocker breakdown — the operator still decides |
| **Remediation creates rogue branches** | Continue posts to the same session; new sessions lock  to the PR head branch | The operator picks **Continue Jules session** or **New session with brief**; each send is a click |
| **Lockfiles blow out token context** | Automatically strips , , and minified assets from diff payloads | Smaller, focused diffs forwarded to LLM evaluation |

---

## Key Capabilities

### 1. WebCrypto Client-Side Credential Vault & Zero-Server Policy
- **AES-GCM Encryption**: User credentials (, , ) are encrypted locally with WebCrypto AES-GCM 256-bit encryption.
- **PBKDF2-SHA256 Derivation**: Keys are derived from a passphrase using **PBKDF2-SHA256** with **210,000 iterations** and a 16-byte random salt.
- **IndexedDB Isolation**: Ciphertext envelopes are stored in IndexedDB (). Credentials exist in unlocked memory only.
- **Session Lock & Legacy Wipe**: Auto-locks after 20 minutes of idle time or on tab hide/close (, , ). Automatically migrates and purges legacy plaintext  secrets (, , ).
- **Zero-Server Guarantee**: User keys are sent via HTTPS request headers to  routes and forwarded directly to upstream services. Server routes like  reject all secret key payload attributes.

### 2. Deterministic Diff Sanitizer Priority
- Mechanically checks touched files against declared glob boundaries.
- **Sanitizer Outranks LLM**: Sanitizer detection of unauthorized paths outranks LLM evaluation, applying a **−35 scope penalty** and capping the verdict at  or  (never ).
- Automatically strips , minified assets, and generated build outputs from diff context.

### 3. Decoupled Two-Stage Lifecycle & Gemini PR Audit
- Clear decoupling between Stage 1 (Scope Dispatch) and Stage 2 (Gemini PR Audit & Operator Remediation).
- Automated evaluation using strict JSON schema validation; the server authors score and verdict.
- Per-criterion verification (, , ) with satisfied aspects and line-level citations validated against diff facts.

### 4. Operator-in-the-Loop Continue-with-Brief Remediation
- Click-gated remediation choices when a PR needs revision:
  - **Continue Jules session**: Posts the structured  back into the live session ().
  - **New session with brief**: Remediation dispatch targeting the PR head branch ( = head,  omitted).
- Both paths preserve the audited branch so Jules commits fixes directly to the active PR rather than opening rogue branches.

### 5. Local Outcome Analytics
- Tracks first-pass  outcome logging sourced strictly from local browser storage ().
- Operates entirely client-side without external telemetry or aggregate reporting.

---

## Test Suite & Quality Assurance

RepoPilot includes a comprehensive test suite built on **Vitest**. All test files reside in  and run without external dependencies via isolated API mocks.

### Verification Gate

The authoritative local acceptance gate for RepoPilot is:


added 464 packages, and audited 465 packages in 20s

165 packages are looking for funding
  run `npm fund` for details

2 vulnerabilities (1 moderate, 1 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

> repopilot@1.0.1 test
> vitest run


[1m[30m[46m RUN [49m[39m[22m [36mv5.0.0 [39m[90m/app[39m

 [32m✓[39m __tests__/audit-grade.test.ts [2m([22m[2m34 tests[22m[2m)[22m[32m 27[2mms[22m[39m
 [32m✓[39m __tests__/remediation-prompt-quality.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 72[2mms[22m[39m
 [32m✓[39m __tests__/jules-dispatch.test.ts [2m([22m[2m50 tests[22m[2m)[22m[32m 81[2mms[22m[39m
 [32m✓[39m __tests__/outcome-memory.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 24[2mms[22m[39m
 [32m✓[39m __tests__/audit-engine.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 65[2mms[22m[39m
 [32m✓[39m __tests__/settings-verify.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 53[2mms[22m[39m
 [32m✓[39m __tests__/validation.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 62[2mms[22m[39m
 [32m✓[39m __tests__/merge-readiness.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32m✓[39m __tests__/jules-session.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 58[2mms[22m[39m
 [32m✓[39m __tests__/dispatch-gate.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 54[2mms[22m[39m
 [32m✓[39m __tests__/vault.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 66[2mms[22m[39m
 [32m✓[39m __tests__/jules-message.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m __tests__/prompt-compiler.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 13[2mms[22m[39m
 [32m✓[39m __tests__/diff-sanitizer.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32m✓[39m __tests__/gemini-scoring.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32m✓[39m __tests__/audit-server-grade.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 16[2mms[22m[39m
 [32m✓[39m __tests__/github-status.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 47[2mms[22m[39m
 [32m✓[39m __tests__/diff-sanitizer-extended.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 40[2mms[22m[39m
 [32m✓[39m __tests__/repo-inspect-deep.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 59[2mms[22m[39m
 [32m✓[39m __tests__/tree-grounding.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m __tests__/first-pass-analytics.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32m✓[39m __tests__/contract-lint.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32m✓[39m __tests__/audited-sha-persist.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 30[2mms[22m[39m
 [32m✓[39m __tests__/blueprint-vault.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 10[2mms[22m[39m
 [32m✓[39m __tests__/scoring-extended.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m __tests__/credential-vault-migration.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 396[2mms[22m[39m
 [32m✓[39m __tests__/remediation-workflow.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m __tests__/jules-github-helpers.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32m✓[39m __tests__/security-headers.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m __tests__/criteria-generate-balance.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 45[2mms[22m[39m
 [32m✓[39m __tests__/github-pr-lookup.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m __tests__/outcome-log.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m __tests__/outcome-grade.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m __tests__/session-poll.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/job-status.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/scorecard-smoke.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/settings-keys.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/credential-vault-crypto.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 1921[2mms[22m[39m
   [32m✓[39m credential vault AES-GCM round-trip [2m(11)[22m
     [33m[2m✓[22m[39m fails closed with a fixed sentence on wrong passphrase[33m 388[2mms[22m[39m
 [32m✓[39m __tests__/first-pass-storage.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/stage-handoff.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m __tests__/api-routes-extended.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 166[2mms[22m[39m
 [32m✓[39m __tests__/infra.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m __tests__/credential-vault-lock.test.ts [2m([22m[2m8 tests[22m[2m)[22m[33m 404[2mms[22m[39m
 [32m✓[39m __tests__/v1-release.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m __tests__/sample-contract.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m __tests__/evaluate-timeout.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m

[2m Test Files [22m [1m[32m46 passed[39m[22m[90m (46)[39m
[2m      Tests [22m [1m[32m453 passed[39m[22m[90m (453)[39m
[2m   Start at [22m 13:54:42
[2m   Duration [22m 6.59s[2m (import 40%, tests 37%, transform 19%, worker 4%)[22m

[2m    Isolate [22m [33m46 workers spawned[39m[2m · ~161ms startup each (spawn + environment, per file)[22m
[2m            [22m [2mat least ~2.31s faster with [22m[33misolate: false[39m[2m — reuses workers across files instead of one per file[22m


> repopilot@1.0.1 lint
> eslint .


/app/hooks/use-credential-vault.ts
   72:6  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
   83:6  warning  React Hook React.useCallback has a missing dependency: 'vaultRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps
  140:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  174:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  192:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  199:6  warning  React Hook React.useCallback has a missing dependency: 'storeRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps
  217:5  warning  React Hook React.useCallback has missing dependencies: 'storeRef' and 'vaultRef'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
  225:5  warning  React Hook React.useCallback has a missing dependency: 'vaultRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps
  233:6  warning  React Hook React.useCallback has a missing dependency: 'storeRef'. Either include it or remove the dependency array                   react-hooks/exhaustive-deps

✖ 9 problems (0 errors, 9 warnings)


> repopilot@1.0.1 build
> next build

   ▲ Next.js 15.5.25

   Creating an optimized production build ...
 ✓ Compiled successfully in 3.5s
   Linting and checking validity of types ...
   Collecting page data ...
   Generating static pages (0/17) ...
   Generating static pages (4/17)
   Generating static pages (8/17)
   Generating static pages (12/17)
 ✓ Generating static pages (17/17)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                                 Size  First Load JS
┌ ○ /                                    85.6 kB         188 kB
├ ○ /_not-found                            991 B         104 kB
├ ƒ /api/audit/evaluate                    153 B         103 kB
├ ƒ /api/audit/fetch-diff                  153 B         103 kB
├ ƒ /api/criteria/generate                 153 B         103 kB
├ ƒ /api/github/status                     153 B         103 kB
├ ƒ /api/jules/dispatch                    153 B         103 kB
├ ƒ /api/jules/message                     153 B         103 kB
├ ƒ /api/jules/session                     153 B         103 kB
├ ƒ /api/jules/sources                     153 B         103 kB
├ ƒ /api/repo/inspect                      153 B         103 kB
├ ƒ /api/settings/verify-gemini            153 B         103 kB
├ ƒ /api/settings/verify-github            153 B         103 kB
├ ƒ /api/settings/verify-jules             153 B         103 kB
└ ƒ /api/vault                             153 B         103 kB
+ First Load JS shared by all             103 kB
  ├ chunks/255-37e0f0325134c4d7.js       46.4 kB
  ├ chunks/4bd1b696-c023c6e3521b1417.js  54.2 kB
  └ other shared chunks (total)           1.9 kB


○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

- **No Remote CI**: GitHub Actions workflows are intentionally omitted; local execution serves as the single verification authority.
- All changes must be verified locally using the command above.

---

## License

Designed and maintained for mission-critical autonomous agent workflows.
Built with Next.js, Tailwind CSS, Lucide Icons, Vitest, and Google Gemini.
Licensed under MIT.
