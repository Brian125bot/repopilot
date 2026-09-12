# Changelog

## 1.0.0

First curated release of the Jules → audit loop.

- Stage 1 starts empty; **Load sample** restores the rate-limiter contract. Dry-run and Load Demo PR are labeled as simulation.
- Navbar job chrome: idle / watching / PR ready / last verdict.
- Operator copy: dispatch, wait for PR, audit, fix. Two stages remain.
- Session watch (15s, 20 min, tab-visible) and GitHub PR lookup by head branch.
- Gemini User-Agent `RepoPilot/1.0`. Evaluate route `maxDuration` 60s with retryable timeout.
- CI: `npm test`, `tsc --noEmit`, `eslint .`, `next build`.
- LICENSE (MIT), SECURITY.md, [golden path](./docs/GOLDEN_PATH.md).
