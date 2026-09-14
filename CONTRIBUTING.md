# Contributing to RepoPilot

Thank you for your interest in contributing to RepoPilot!

## Verification Contract & Guidelines

### Local Validation Requirement
All pull requests and branch contributions must be validated locally prior to merging:

```bash
npm ci && npm test && npx tsc --noEmit
```

- **Local Verification Gate**: Execute `npm test` and `npx tsc --noEmit` locally to confirm all unit tests pass and TypeScript types compile cleanly without errors.
- **No Remote CI Execution**: Remote automated CI runs (such as GitHub Actions) are not executed by this repository. GitHub Actions workflows were permanently removed due to runner billing constraints.
- **Authoritative Gate**: Local execution is the sole authoritative acceptance gate for contributions to `main` and feature branches. Historical status checks on older commits are obsolete and do not reflect current branch health.

Thank you for keeping RepoPilot reliable and maintainable!
