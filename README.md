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

RepoPilot **1.0.3** documentation:

- 🚀 **[Golden path (6 steps)](./docs/GOLDEN_PATH.md)**: WebCrypto vault setup → connected repo → dispatch → wait/audit PR → evaluate → same-branch fix.
- 📖 **[Google Jules User Guide & Automation Playbook](./docs/USER_GUIDE_JULES_AUTOMATION.md)**: How RepoPilot organizes task contracts and the review loop with Jules.
- ⚙️ **[Technical Systems Specification](./docs/TECHNICAL_SPECIFICATION.md)**: Architecture, diff parsing, glob compilation, hydration, Gemini schema, threat model.
- 🧪 **[Testing Strategy Guide](./docs/TESTING_STRATEGY.md)**: Vitest conventions. Verify locally with `npm ci && npm test && npm run lint && npm run build && npx tsc --noEmit`.
- 📐 **[System Architecture](./ARCHITECTURE.md)**: Sequence flows and anti-drift rules.
- 🔐 **[SECURITY.md](./SECURITY.md)**: WebCrypto vault specification, PBKDF2/AES-GCM isolation, session locking, and zero-server secret policy.
- 📝 **[CHANGELOG](./CHANGELOG.md)**: Release history including 1.0.3, plus 1.0.2 and 1.0.1 tag references.
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

RepoPilot includes a comprehensive test suite built on **Vitest**. All test files reside in `__tests__/` and run without external dependencies via isolated API mocks.

### Verification Gate

The authoritative local acceptance gate for RepoPilot is:

```bash
npm ci && npm test && npm run lint && npm run build && npx tsc --noEmit
```

- **No Remote CI**: GitHub Actions workflows are intentionally omitted; local execution serves as the single verification authority.
- All changes must be verified locally using the command above.

---

## License

Designed and maintained for mission-critical autonomous agent workflows.
Built with Next.js, Tailwind CSS, Lucide Icons, Vitest, and Google Gemini.
Licensed under MIT.
