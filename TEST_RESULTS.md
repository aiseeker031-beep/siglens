# SIGLENS — Automated & Live Verification Test Results (`TEST_RESULTS.md`)

**Execution Date:** 2026-11-21  
**Environment:** Local Windows Node.js `v24.22.2` + Live Hostcry cPanel Production (`https://siglens.cc.cd`, Node.js `24.22.3`)

---

## 1. Automated Test Suite Summary (`npm test`)

Command: `tsx --test src/analytics/analytics.test.ts src/server/audit.regression.test.ts`

| Test Suite | Total | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `src/analytics/analytics.test.ts` (10 Indicators, 12 Signal Scenarios, Patterns, S/R, Correlation, NL Screener, Structured Signal Setup) | 22 | **22** | 0 | 0 | ~0.24s |
| `src/server/audit.regression.test.ts` (SSRF IPv4/IPv6/Ollama, Independent Numerical Reference `< 1e-9`, Signal Explanation Consistency, Express Security Headers, JSON 404, Malformed JSON 400, CSRF Origin Guard, Query/Settings Validation, Stocks OrderBook Schema, Auth State) | 5 | **5** | 0 | 0 | ~1.87s |
| **Total Automated Tests** | **27** | **27** | **0** | **0** | **3.03s** |

---

## 2. Static Analysis, Dependency & Build Verification

| Check | Command | Result |
|---|---|---|
| Full-Repo TypeScript Check | `npx tsc --noEmit` | **PASS** (`0` errors — down from 11 pre-audit errors) |
| Dependency Vulnerability Scan | `npm audit --json` | **PASS** (`0` vulnerabilities across all severities) |
| Secret & Suspicious Code Scan | Repo + Git History regex scan | **PASS** (`0` exposed secrets, `0` backdoors) |
| Production Frontend Build | `npm run build` (Vite 8.3.8) | **PASS** (`1.69s`; initial entry chunk `429.92 kB` / `131.94 kB` gzip; ECharts lazy-split to `1,117.36 kB`) |
| Production Server Bundle | `node scripts/bundle-server.cjs` (esbuild) | **PASS** (`180ms`; standalone `deploy/server.cjs` `2.3 MB` + `deploy/app.cjs`) |

---

## 3. Live Production Verification (`https://siglens.cc.cd`)

| Verification Category | Outcome | Key Measured Evidence |
|---|---|---|
| Security Headers (`/` & `/api/health`) | **PASS** | `x-powered-by: null`, `HSTS`, `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`, `CSP`, `Cache-Control: no-store` on `/api/*` |
| API Route Matrix (46 live probes) | **44 PASS / 2 Known Geo-Block** | Binance (`150`), Kraken (`15`), Coinbase (`14`), Stocks (`20`), CFDs (`18`), Arbitrage (`14` spot + `8` stat-arb), Signals (`BTC`/`ETH`/`NVDA`/`XAU`), DefiLlama, Paper Arena, Auth all `200 OK`; unknown `/api/*` → `404 JSON`; invalid exchange/feeBps → `400 JSON`; bad Origin → `403 JSON`; Bybit REST (`markets?exchange=bybit` & `derivatives`) → `502` (US IP 403) |
| Live WebSocket (`wss://siglens.cc.cd/ws`) | **PASS** | Connected (`101`), received `connection:ready` + live `bybit:perpetual:BTC/USDT` & `binance:spot:DOGE/USDT` ticks |
| Playwright Headless Chrome Crawl | **PASS** | `0` console errors, `0` page errors, `0` failed requests; all 6 landing sections live; Google OAuth Portal modal open+close verified; `Ctrl+K` search + `ETH/USDT` + `Stocks` switch verified; `0` horizontal overflow across `360px`–`1920px` on both `/` and `/app` |

---

## 4. Tests Not Executed / Unavailable

- **Live Google OAuth Callback Completion (`/api/auth/google/callback`):** Could not complete real Google sign-in token exchange because `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not yet configured in Hostcry cPanel environment variables. Honest unconfigured guard (`configured: false`, HTTP `503`) was verified live.
- **Live BYOK External LLM Calls (`/api/ai/test`, `/api/ai/analyze` with real paid keys):** Not executed against third-party paid LLM accounts; SSRF & URL validation layers were verified via automated unit tests.
- **Destructive / High-Volume Load Testing Against Production:** Explicitly excluded per audit safety rules to avoid disrupting shared hosting (`720 MB` RAM / 1 vCPU).

