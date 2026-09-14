# Security

RepoPilot 1.0 is a **stateless hosted control plane**. The Next.js server does not persist API keys, blueprints, or audit reports.

## Public Vercel deploy

Public Production and Preview Vercel projects MUST leave `JULES_API_KEY`, `GEMINI_API_KEY`, and `GITHUB_PAT` unset. Setting a shared provider key on a public Vercel deployment is a security blocker for v1 because every visitor would share one provider account. Visitors supply their own credentials via the in-app Settings modal, which transmits them via per-request headers (`x-jules-api-key`, `x-gemini-api-key`, `x-github-pat`).

## Where credentials live

- **Browser `localStorage` only:** Jules API key, Gemini API key, and GitHub PAT are entered in Settings and stored in that browser (`repopilot_jules_key`, `repopilot_gemini_key`, `repopilot_github_pat`).
- **Per-request headers:** The UI sends `x-jules-api-key`, `x-gemini-api-key`, and `x-github-pat` over HTTPS to same-origin `/api/*` routes. Those routes forward credentials to Jules, Gemini, or GitHub. They are not written to a database or the filesystem.
- **Optional server defaults:** `JULES_API_KEY`, `GEMINI_API_KEY`, and `GITHUB_PAT` in the environment are optional. A public Vercel deploy can run with none of them set.

## What the server must not log

API routes log error **messages** only. They must not log request header values or credential strings.

## What you should do

- Use a Jules key from [jules.google.com/settings](https://jules.google.com/settings), not a Gemini / AI Studio key.
- Prefer a fine-grained GitHub PAT limited to the repos you audit.
- Clear Settings (or site data) on a shared computer.
- Treat a leaked Jules or Gemini key as compromised and rotate it.

## Scope of this note

This is not a bounty program or a full threat model. See `ARCHITECTURE.md` for the product threat table. Report issues via the GitHub repository.
