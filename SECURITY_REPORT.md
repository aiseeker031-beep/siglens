# SIGLENS — Application Security & Supply-Chain Report (`SECURITY_REPORT.md`)

**Assessment Reference:** OWASP ASVS v4.0 & OWASP Top 10 (2021)  
**Audit Date:** 2026-11-21

---

## 1. Confirmed Security Vulnerabilities & Remediation Status

| ID | OWASP Category | Severity | Affected Area | Root Cause | Remediation | Status |
|---|---|---|---|---|---|---|
| **SIG-001** | A10:2021 SSRF | High | `src/server/scanner.ts`, `src/server/aiAdapters.ts`, `server.ts` | Alert webhooks only checked `startsWith('https://')`; AI adapter missed IPv6 private ranges, DNS lookup validation, and redirect blocking. | Built shared `src/server/ssrf.ts` blocking IPv4/IPv6 private, loopback, link-local, CGNAT, multicast, metadata IPs + async `dns.lookup(..., { all: true })` validation + `redirect: 'error'` on outbound fetches. | **Fixed & Tested** |
| **SIG-002** | A05:2021 Security Misconfiguration | High | `server.ts` | Exposed `X-Powered-By: Express`, lacked CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` on `/api/*`, and `trust proxy`. | Disabled `x-powered-by`, set `trust proxy = 1`, added full OWASP security headers + CSP + strict API `no-store` caching. | **Fixed & Verified Live** |
| **SIG-006** | A03/A04 Validation & Error Leakage | Medium | `server.ts` | Unvalidated `PUT /api/settings`, `PATCH /api/alerts/:id`, unvalidated GET query params, malformed JSON returned default Express error output, unbounded rate-limiter `Map`. | Added strict Zod schemas (`preferencesPatchSchema.strict()`), clean JSON `400` syntax error handler, JSON `404` API catch-all, and expired-key pruning in rate limiter. | **Fixed & Verified Live** |
| **SIG-007** | A01/A05 CSRF | Medium | `server.ts` (`POST`/`PUT`/`PATCH`/`DELETE` `/api/*`) | Mutating endpoints accepted cross-origin `Origin` headers without verification. | Added Same-Origin `Origin` verification rejecting mismatched browser origins with `403 Forbidden`. | **Fixed & Verified Live** |
| **SIG-009** | A03 Input Validation (WebSocket) | Medium | `src/server/wsHub.ts` | Untrusted WS `subscribe` frames interpolated directly into upstream Binance WS stream URL without allowlist; no `maxPayload` limit. | Enforced `maxPayload: 16384`, strict regex/Set allowlist for exchange/symbol/timeframe, and self-cleaning reconnect timer `Set`. | **Fixed & Deployed** |

---

## 2. Authentication & Authorization Assessment

- **Google OAuth 2.0 Implementation (`src/server/auth.ts`)**:
  - Uses standard Authorization Code flow (`https://accounts.google.com/o/oauth2/v2/auth` → `https://oauth2.googleapis.com/token` → `https://www.googleapis.com/oauth2/v3/userinfo`).
  - Generates 192-bit cryptographic CSRF `state` (`crypto.randomBytes(24)`), stored in an `HttpOnly; SameSite=Lax; Secure` cookie (10-minute TTL) and verified on callback before token exchange.
  - Session tokens are 256-bit random hex (`crypto.randomBytes(32)`) stored in SQLite `auth_sessions` with 14-day expiration and `HttpOnly; SameSite=Lax; Secure` cookie attributes.
  - Fails closed and reports honestly (`configured: false` / HTTP `503`) when `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is absent — zero mock login or bypass paths.
- **BYOK AI Vault (`src/utils/cryptoVault.ts`)**:
  - Uses WebCrypto `PBKDF2` (SHA-256, 120,000 iterations, random 16-byte salt) + `AES-GCM-256` (random 12-byte IV) with user-supplied passphrase. No hardcoded encryption key exists. Raw keys are never sent to `/api/ai/profiles` or written to SQLite.
- **Residual Authorization Risk (Single-Tenant Workspace)**:
  - Currently, dashboard endpoints (`/api/settings`, `/api/watchlists`, `/api/alerts`, `/api/paper/*`, `/api/cache/clear`) do not require a Google session so anonymous visitors can immediately explore the terminal and the Hostcry 5-minute cron job can call `POST /api/paper/tick`.
  - **Recommendation:** Before opening SIGLENS to untrusted multi-user public traffic, scope SQLite tables by `user_id`, require a valid session cookie on mutating workspace endpoints, and guard `POST /api/paper/tick` with an `X-Cron-Secret` header matched against an environment variable.

---

## 3. Secret Exposure & Suspicious Code Investigation (Phase 3.5 & 3.7)

- **Repository & Git History Secret Scan:** Searched all tracked source files and full git commit history for API keys (`AIza*`, `sk-*`, `ghp_*`, `AKIA*`), PEM private keys, and hosting credentials.
  - **Result:** **0 exposed secrets** found in source code, `dist/` bundles, `.github/workflows/deploy.yml` (uses `${{ secrets.* }}`), or git commit history.
  - **Deployment Note:** Ensure local temporary cPanel cookie jars are always deleted after manual deployments (verified cleaned).
- **Suspicious Code / Backdoor Audit:** Scanned for `eval(`, `new Function(`, `dangerouslySetInnerHTML`, `innerHTML =`, `child_process`, `execSync`, `spawn(`, hidden admin routes, obfuscated JS, and unauthorized telemetry.
  - **Result:** **0 confirmed backdoors or unauthorized remote execution paths.** All outbound network calls go exclusively to documented public market-data APIs, Google OAuth endpoints, or SSRF-validated user-configured webhooks/BYOK AI providers.
- **SQL Injection Audit:** All SQLite queries across `src/server/db.ts`, `src/server/paperEngine.ts`, and `src/server/auth.ts` use parameterized prepared statements (`?` placeholders) via Node 24 `DatabaseSync`. Zero dynamic SQL string concatenation from user input was found.

---

## 4. Dependency & Supply-Chain Audit (Phase 9)

- **Tool Run:** `npm audit --json`
- **Result:** `0` vulnerabilities (`info: 0, low: 0, moderate: 0, high: 0, critical: 0`).
- **Known Dependency Debt (Low Risk):**
  - Peer dependency version mismatch between `esbuild@^0.25.0` and `vite@^8.3.0` requires `npm install --legacy-peer-deps`.
  - Unused packages present in `package.json`: `@google/genai`, `three`, `@types/three`, `lightweight-charts` (not imported in production bundles; recommended to prune in a future maintenance PR).

