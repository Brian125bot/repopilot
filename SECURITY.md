# Security & Credential Vault Specification

RepoPilot 1.0.2 operates as a **zero-auth, zero-server-state control plane**. The Next.js server infrastructure on Vercel persists nothing: no user API keys, credentials, blueprint databases, or audit reports are stored on the server.

---

## Zero-Server Secret Isolation Guarantee

- **Zero Server Persistence**: User API keys (`jules_key`, `gemini_key`, `github_pat`) reside exclusively in client browser memory or encrypted IndexedDB storage. They are **never** transmitted to or stored on Vercel server databases, environment stores, or server-side disk.
- **Payload Attribute Filtering**: Server endpoints such as `/api/vault` strictly handle blueprint and contract metadata. Endpoints reject all secret key payload attributes and fail closed if key material is submitted in body payloads.
- **Per-Request Ephemeral Forwarding**: When performing dispatches or evaluations, the client UI attaches credentials strictly in HTTPS request headers (`x-jules-api-key`, `x-gemini-api-key`, `x-github-pat`). Same-origin `/api/*` routes forward these credentials directly to upstream provider endpoints (Google Jules, Google Gemini, GitHub) without persisting them.

---

## WebCrypto Credential Vault Architecture

To protect user provider keys on client machines, RepoPilot implements an encrypted WebCrypto client-side vault:

- **Encryption Mechanism**: Credentials (`julesKey`, `geminiKey`, `githubPat`) are encrypted using **WebCrypto AES-GCM 256-bit** encryption with a randomly generated 12-byte IV per wrap operation.
- **Key Derivation (PBKDF2-SHA256)**: Key Encryption Keys (KEK) are derived from a user-supplied passphrase via **PBKDF2-SHA256** using **210,000 iterations** and a 16-byte cryptographically random salt (`getRandomValues`).
- **IndexedDB Storage Key**: Encrypted envelopes containing ciphertext, salt, IV, and version metadata are stored in IndexedDB under database `repopilot-credential-vault` with key `vault-v1`.
- **In-Memory Unlocked State**: Unwrapping credentials loads plainkeys exclusively into a non-persisted in-memory vault (`MemoryVault`). Browser DevTools local storage inspection reveals zero plaintext secrets when locked.

---

## Session Locking & Automatic Plaintext Wipe

- **20-Minute Idle Lock Timer**: An active session timer (`VAULT_IDLE_TIMEOUT_MS = 1,200,000ms`) tracks user interaction (clicks, keypresses, scrolls, focus). Reaching 20 minutes of inactivity automatically locks the vault and purges memory keys.
- **Instant Tab Hide & Close Lock**: The vault instantly locks and clears in-memory credentials upon browser tab hide or window closure events (`visibilitychange` with state `hidden`, `pagehide`, and `beforeunload`).
- **Automatic Plaintext Wipe & Migration**: On setup or login with a passphrase, RepoPilot executes a one-shot migration of any legacy plaintext credentials in `localStorage` (`repopilot_jules_key`, `repopilot_gemini_key`, `repopilot_github_pat`), encrypting them into the WebCrypto vault and purging the legacy plaintext keys from `localStorage`.

---

## Public Vercel Deployment Rules

Public Vercel deployment instances MUST leave `JULES_API_KEY`, `GEMINI_API_KEY`, and `GITHUB_PAT` environment variables unset. Every visitor brings their own provider keys via the in-app Settings modal, ensuring strict multi-tenant credential isolation.

---

## What the Server Must Not Log

API routes strictly log operational error messages and request identifiers. They **must never** log header values (`x-jules-api-key`, `x-gemini-api-key`, `x-github-pat`) or secret credential strings. Centralized safe logging utility `lib/safe-log.ts` redacts key-like patterns before emitting JSON log lines.

---

## Operator Recommendations

1. **Jules API Keys**: Generate keys specifically at [jules.google.com/settings](https://jules.google.com/settings) (do not substitute Gemini AI Studio keys).
2. **GitHub Personal Access Tokens**: Use fine-grained GitHub PATs scoped strictly to the target repositories being audited.
3. **Shared Terminals**: Explicitly click **Lock Vault** or clear site data when operating on shared devices.
4. **Credential Rotation**: Treat any exposed or compromised key as immediately invalid and rotate it via the respective provider dashboard.

---

## Scope & Reporting

See `ARCHITECTURE.md` for the full system threat matrix. Report security vulnerabilities via the repository issue tracker.
