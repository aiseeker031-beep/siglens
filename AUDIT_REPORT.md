# SIGLENS — Full-Stack Security, API, Functionality & Production Audit Report

**Audit Date:** 2026-11-21  
**Target Repository:** `C:\Users\roshi\.gemini\antigravity\scratch\siglens` (`https://github.com/aiseeker031-beep/siglens`)  
**Production Target:** `https://siglens.cc.cd` (Hostcry Shared Hosting, cPanel / CloudLinux Node.js 24 Selector / LiteSpeed Passenger)  
**Audit Scope:** Phases 1–12 (Discovery, API Route Audit, OWASP ASVS/Top 10 Security, Headless Browser UI & Responsive Crawl, Market-Data Integrity, Independent Numerical Indicator Verification, Performance/Memory, cPanel Compatibility, Dependency Supply-Chain, Automated Regression Testing, Safe Remediation & Live Re-Verification)

---

## 1. Executive Summary

SIGLENS is a full-stack multi-asset quantitative market intelligence, real-time arbitrage, and autonomous paper-trading web application built with **React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + Motion + ECharts + Zustand** on the frontend, and **Node.js 24 + Express 4 + Zod 4 + `ws` WebSockets + built-in `node:sqlite`** on the backend.

During this evidence-based audit of both the source repository and the live production deployment (`https://siglens.cc.cd`), **14 concrete, reproducible defects** were discovered across security, backend API validation, runtime trading logic, frontend interaction, responsive layout, dead code, and bundle performance:

- **13 confirmed defects were safely repaired, regression-tested, deployed live to `https://siglens.cc.cd`, and re-verified.**
- **1 operational/hosting limitation** (`api.bybit.com` REST returning HTTP `403` CloudFront US geo-block from the US-hosted cPanel IP) and **1 unconfigured optional integration** (Google OAuth 2.0 awaiting `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in cPanel environment variables) are transparently documented as open items.
- **No claims of "100% secure" or "bug-free" are made.** Measured coverage, verified repairs, unverified workflows, and remaining operational risks are explicitly detailed below.

---

## 2. Verified Architecture Overview

| Layer | Confirmed Implementation |
|---|---|
| Frontend Entry | `index.html` → `src/main.tsx` → `src/App.tsx` |
| Client Routing | `window.history.pushState` / `popstate` SPA routing (`/` → 6-section kinetic `LandingPage`, `/app` → `AppShell` 9-workspace terminal) |
| State Management | Zustand store (`src/store/useAppStore.ts`) + real-time 600ms batched WebSocket ticker updates (`src/hooks/useMarketStream.ts`) |
| Backend Entry | `server.ts` → bundled via `scripts/bundle-server.cjs` (esbuild) to `deploy/server.cjs` + Passenger bootstrap `deploy/app.cjs` (`dns.setDefaultResultOrder('ipv4first')`) |
| Persistence | Native Node 24 `node:sqlite` (`data/cryptolens.db` in `DELETE` journal mode with automatic corruption recovery) |
| Market Data Feeds | Public unauthenticated REST/WS: Binance (`data-api.binance.vision` + `data-stream.binance.vision`), Kraken, Coinbase, Bybit V5 WS/REST, DefiLlama, Alternative.me, Yahoo Finance v8 (`stocks` & `cfds`) |
| Background Automation | 90s screener/alert loop (`src/server/scanner.ts`), 35s autonomous paper-trading loop (`src/server/paperEngine.ts`), plus Hostcry 5-minute cPanel Cron Job (`POST /api/paper/tick`) |
| Authentication | Google OAuth 2.0 (`/api/auth/google`, `/api/auth/google/callback`, `/api/auth/me`, `/api/auth/logout`) backed by SQLite `auth_users` & `auth_sessions` with `HttpOnly; SameSite=Lax; Secure` cookies |
| BYOK AI Security | Client-side WebCrypto `PBKDF2-SHA256` (120,000 iterations) + `AES-GCM-256` (`src/utils/cryptoVault.ts`); raw LLM API keys are never persisted to SQLite |

---

## 3. Tools & Verification Methods Used

- **Static Analysis & Type Checking:** `npx tsc --noEmit`, regex secret & suspicious-code scan across working tree and full `git log` history.
- **Supply-Chain Audit:** `npm audit --json` (`0` vulnerabilities reported across direct and transitive dependencies).
- **Automated Unit, Numerical & Integration Suite:** Node built-in test runner via `tsx --test` (`src/analytics/analytics.test.ts` + `src/server/audit.regression.test.ts`, **27/27 passing**).
- **Live Production API & WebSocket Probes:** 46-route live HTTP probe script against `https://siglens.cc.cd/api/*` + live `wss://siglens.cc.cd/ws` upgrade and stream subscription check.
- **Live Headless Browser Automation:** Playwright `1.65.1` driving local Chrome (`--disable-quic`) against `https://siglens.cc.cd/` and `/app` across all 9 dashboard sections, modal/keyboard interactions, symbol/asset-class switching, and 6 responsive viewports (`360px`, `390px`, `768px`, `1024px`, `1440px`, `1920px`).

---

## 4. Prioritized Findings Ledger

### SIG-001
- **Severity:** High (P1)
- **Category:** Security (SSRF)
- **Affected file:** `src/server/scanner.ts`, `src/server/aiAdapters.ts`, `server.ts`, new `src/server/ssrf.ts`
- **Affected endpoint or component:** `POST /api/alerts`, `PATCH /api/alerts/:id`, `POST /api/ai/test`, `POST /api/ai/analyze`
- **Description:** User-supplied `webhookUrl` in alert rules was only checked with `startsWith('https://')`, permitting SSRF against RFC1918 private IPs, loopback (`127.0.0.1`, `[::1]`), IPv4-mapped IPv6 (`::ffff:127.0.0.1`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), and DNS-rebound hostnames. `aiAdapters.ts` also missed IPv6 private ranges (`fc00::/7`, `fe80::/10`), DNS resolution checks, HTTP redirect blocking, and private non-loopback checks for `ollama`.
- **Evidence:** Code inspection of `src/server/scanner.ts:273` & `src/server/aiAdapters.ts:29-81`; reproduced in regression suite.
- **Root cause:** Verified — missing shared SSRF IP/DNS validator and `redirect: 'error'` on outbound server `fetch()` calls.
- **Fix:** Created `src/server/ssrf.ts` (`isPrivateOrReservedIp`, `assertSafeExternalUrlSync`, `assertSafeExternalUrl` with `dns.lookup(..., { all: true })`). Applied at alert creation/update (`server.ts`), webhook dispatch (`scanner.ts`), and AI provider dispatch (`aiAdapters.ts`), with `redirect: 'error'`.
- **Verification:** `audit.regression.test.ts` SSRF unit + HTTP integration tests pass; live `POST /api/alerts` with metadata IP returns `400`.
- **Status:** Fixed

### SIG-002
- **Severity:** High (P1)
- **Category:** Security (HTTP Headers & Cache Control)
- **Affected file:** `server.ts`
- **Affected endpoint or component:** All HTTP routes (`/` and `/api/*`)
- **Description:** Production server exposed `X-Powered-By: Express`, lacked `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy`, lacked `Cache-Control: no-store` on `/api/*`, and lacked `app.set('trust proxy', 1)` behind LiteSpeed.
- **Evidence:** Baseline `curl -I https://siglens.cc.cd/` showed `X-Powered-By: Express` and none of the OWASP browser security headers.
- **Root cause:** Verified — Express defaults used without security header middleware or `trust proxy`.
- **Fix:** Disabled `x-powered-by`, enabled `trust proxy = 1`, added OWASP-aligned security headers + CSP middleware, `Cache-Control: no-store` on `/api/*`, `no-cache` on `index.html`, and `maxAge: '365d', immutable: true` on hashed `/assets/*`.
- **Verification:** Verified both in local integration tests and live `fetch('https://siglens.cc.cd/')` / `/api/health` header inspection.
- **Status:** Fixed

### SIG-003
- **Severity:** High (P1)
- **Category:** Backend / Trading Logic Bug
- **Affected file:** `src/server/paperEngine.ts:1124`
- **Affected endpoint or component:** `runAutonomousPaperCycle` (`POST /api/paper/tick` & 35s paper bot loop)
- **Description:** Autonomous strategy bot entry referenced `best.lastPrice` on `ScreenerRow` (whose actual property is `best.price`). At runtime `best.lastPrice` was always `undefined`, silently forcing `atrAbs = null` and `trailingAtr = null` on every autonomous bot trade, disabling ATR trailing stops completely.
- **Evidence:** `npx tsc --noEmit` reported `error TS2339: Property 'lastPrice' does not exist on type 'ScreenerRow'` at `src/server/paperEngine.ts(1124,46)` and `(1124,89)`.
- **Root cause:** Verified — mismatched property name between `MarketTicker.lastPrice` and `ScreenerRow.price`.
- **Fix:** Updated line 1124 to read `best.price`.
- **Verification:** `npx tsc --noEmit` exits with `0` errors; production bundle rebuilt and deployed.
- **Status:** Fixed

### SIG-004
- **Severity:** High (P1)
- **Category:** Frontend UI / Accessibility
- **Affected file:** `src/components/ui/GoogleAuthButton.tsx`
- **Affected endpoint or component:** Google OAuth Setup Modal inside sticky `<header>`
- **Description:** Rendering the `fixed inset-0` setup modal inline inside a `<header className="sticky backdrop-blur-xl ...">` caused CSS `backdrop-filter` to trap the modal inside the 64px header containing block, pushing the modal's close button outside the viewport.
- **Evidence:** Baseline Playwright crawl failed to click `button[aria-label="Close modal"]` with `element is outside of the viewport` (`googleModalCloseClickable: false`).
- **Root cause:** Verified — CSS containing-block creation by `backdrop-filter` on ancestor `<header>`.
- **Fix:** Rendered modal via `createPortal(..., document.body)` with `Escape` key handler and `overflow-y-auto`.
- **Verification:** Post-fix Playwright crawl on `https://siglens.cc.cd/` verified `googleModalOpened: true` and `googleModalCloseClickable: true`.
- **Status:** Fixed

### SIG-005
- **Severity:** High (P1)
- **Category:** Frontend UI / Keyboard Navigation
- **Affected file:** `src/components/layout/CommandSearchModal.tsx`
- **Affected endpoint or component:** Global Command Search (`Ctrl+K` / `Cmd+K`)
- **Description:** Both `src/App.tsx` and `src/components/layout/CommandSearchModal.tsx` registered `window.addEventListener('keydown', ...)` toggling `commandSearchOpen` on `Ctrl+K`, causing a single keypress to toggle `false → true → false` synchronously so the shortcut never opened search.
- **Evidence:** Baseline Playwright crawl pressed `Control+k` and measured `commandSearchOpened: false`.
- **Root cause:** Verified — duplicate global `keydown` handler.
- **Fix:** Removed duplicate `Ctrl+K` toggle from `CommandSearchModal.tsx` (retaining `Escape` key handling only).
- **Verification:** Post-fix Playwright crawl on `https://siglens.cc.cd/app` confirmed `commandSearchOpened: true` and `ethSelected: true`.
- **Status:** Fixed

### SIG-006
- **Severity:** Medium (P2)
- **Category:** API Validation, Error Handling & Memory Safety
- **Affected file:** `server.ts`
- **Affected endpoint or component:** `/api/*` (unknown routes, malformed JSON, `/api/markets`, `/api/tickers`, `/api/screener`, `/api/market-breadth`, `/api/market-overview`, `/api/correlation`, `/api/compare`, `/api/arbitrage`, `/api/signals/*`, `PUT /api/settings`, `PATCH /api/alerts/:id`)
- **Description:** Unknown `/api/*` routes fell through to SPA `index.html` (`200 text/html`); several GET routes cast `req.query.exchange` without validation (`exchange=INVALID` returned `200` Coinbase tickers); `PUT /api/settings` merged unvalidated `req.body`; `PATCH /api/alerts/:id` lacked Zod validation; malformed JSON threw Express default HTML errors; rate-limit `hits` Map never pruned expired keys.
- **Evidence:** Live production probe returned `200 text/html` for `/api/nonexistent-route-audit-check` and `200 count=14` for `/api/markets?exchange=INVALID`.
- **Root cause:** Verified — missing router-level 404 handler, missing Zod schemas, and missing Express JSON error middleware.
- **Fix:** Added strict Zod validation for all listed routes, `preferencesPatchSchema.strict()` on `PUT /api/settings`, JSON syntax error middleware (`400`), catch-all JSON `404` on `buildApiRouter()`, and expired-entry pruning on `hits` Map.
- **Verification:** Passed in both `audit.regression.test.ts` and live production probes (`API_404: 404 application/json`, `BAD_EX: 400`, `BAD_ARB: 400`).
- **Status:** Fixed

### SIG-007
- **Severity:** Medium (P2)
- **Category:** Security (CSRF Protection)
- **Affected file:** `server.ts`
- **Affected endpoint or component:** All mutating `/api/*` routes (`POST`, `PUT`, `PATCH`, `DELETE`)
- **Description:** State-changing endpoints accepted cross-origin browser requests without `Origin` validation.
- **Evidence:** Code review of `buildApiRouter()` showed no `Origin` check.
- **Root cause:** Verified — missing Same-Origin middleware.
- **Fix:** Added Same-Origin `Origin` header verification on mutating `/api/*` requests (rejects mismatched cross-site `Origin` with `403 Forbidden`, while keeping server-to-server cPanel cron `POST /api/paper/tick` functional).
- **Verification:** Verified locally and live on `https://siglens.cc.cd/api/settings` (`Origin: https://evil.example` → `403`).
- **Status:** Fixed

### SIG-008
- **Severity:** Medium (P2)
- **Category:** Backend / Schema Integrity
- **Affected file:** `src/server/providers.ts:973-986`
- **Affected endpoint or component:** `GET /api/orderbook?exchange=stocks|cfds`
- **Description:** `fetchOrderBook` for `stocks`/`cfds` returned an invalid `midPrice: 0` field, omitted `bestBid`/`bestAsk`, and reported `spreadPct: 0` instead of `null`.
- **Evidence:** `npx tsc --noEmit` error `TS2353` at `providers.ts:981` + live API inspection.
- **Root cause:** Verified — schema drift in equity/CFD fallback branch.
- **Fix:** Returned `{ bestBid: null, bestAsk: null, spreadPct: null }`.
- **Verification:** Passed `tsc --noEmit`, local regression test, and live `GET /api/orderbook?exchange=stocks&marketType=equity&symbol=AAPL/USD`.
- **Status:** Fixed

### SIG-009
- **Severity:** Medium (P2)
- **Category:** Security & Reliability (WebSocket Hub)
- **Affected file:** `src/server/wsHub.ts`
- **Affected endpoint or component:** `wss://siglens.cc.cd/ws`
- **Description:** Client `subscribe` messages interpolated unvalidated `symbol`/`timeframe` strings directly into upstream Binance WebSocket URLs (including non-Binance equity/CFD symbols), lacked `maxPayload`, and pushed reconnect timers into an array without removing fired timers.
- **Evidence:** Code inspection of `src/server/wsHub.ts:53-57, 89-105, 163`.
- **Root cause:** Verified — missing input allowlist and timer cleanup.
- **Fix:** Enforced `maxPayload: 16384`, validated `exchange`/`symbol`/`timeframe` against strict allowlists before switching Binance kline stream, and migrated `reconnectTimers` to a self-cleaning `Set`.
- **Verification:** Verified TypeScript build and live `wss://siglens.cc.cd/ws` connection & real-time stream.
- **Status:** Fixed

### SIG-010
- **Severity:** Medium (P2)
- **Category:** Frontend State Synchronization
- **Affected file:** `src/views/LiveSignalsView.tsx`, `src/views/ScreenerView.tsx`, `src/views/HeatmapsView.tsx`
- **Affected endpoint or component:** Top header `Crypto | Stocks | CFDs` switcher
- **Description:** Switching asset class in the top `AppShell` bar updated the Zustand store but did not update local `exchange`/`marketType` state in Signals, Screener, or Heatmaps views when already mounted.
- **Evidence:** Code audit of `LiveSignalsView.tsx:25`, `ScreenerView.tsx:59`, `HeatmapsView.tsx:23`.
- **Root cause:** Verified — one-time `useState(globalExchange)` initialization without `useEffect` sync.
- **Fix:** Added `useEffect` hooks syncing local view filters when global `exchange`/`marketType` changes.
- **Verification:** Verified via production build and Playwright asset-class switch test.
- **Status:** Fixed

### SIG-011
- **Severity:** Medium (P2)
- **Category:** Responsive Layout & Perceived Performance
- **Affected file:** `src/views/LandingPage.tsx`
- **Affected endpoint or component:** Landing Page (`/`) at `360px`, `390px`, `768px`
- **Description:** Landing page had horizontal overflow at mobile/tablet widths (`scrollW: 428` at `360px`/`390px`, `793` at `768px`) and blocked Hero live price rendering behind `Promise.all([overview, arbitrage, paper])`.
- **Evidence:** Baseline Playwright viewport audit reported `overflow: true` at `360px`, `390px`, `768px` and `hasLivePrice: false` within 3s.
- **Root cause:** Verified — missing `overflow-x-clip`, wide mobile header controls, and coupled `Promise.all`.
- **Fix:** Added `overflow-x-clip`, responsive mobile navbar sizing, horizontally scrollable segmented tabs wrapper, and independent non-blocking fetches.
- **Verification:** Post-fix Playwright crawl verified `overflow: false` across all 6 viewports (`360px`–`1920px`) on `/` and `/app`, and `hasLivePrice: true`.
- **Status:** Fixed

### SIG-012
- **Severity:** Medium (P2)
- **Category:** Frontend Performance & React Suspense/Motion
- **Affected file:** `src/App.tsx`
- **Affected endpoint or component:** Initial JS bundle & lazy tab transitions
- **Description:** Initial bundle shipped `1,751 kB` (including `1.1 MB` ECharts) synchronously even on the Landing Page. Additionally, wrapping `<AnimatePresence mode="wait">` inside `<Suspense>` stalled rapid transitions between lazy tabs.
- **Evidence:** Vite build report (`1,751.63 kB` entry chunk) and mid-audit Playwright crawl showing stalled tab DOM under outer `<Suspense>`.
- **Root cause:** Verified — synchronous view imports, then Suspense boundary ordering around `AnimatePresence`.
- **Fix:** Lazy-loaded all 9 dashboard views and placed `<Suspense>` inside `<motion.div key={activeSection}>`. Initial Landing Page JS dropped by **75.5%** (`1,751 kB` → `429 kB`, `131 kB` gzip).
- **Verification:** Verified build chunk split and live Playwright crawl across all 9 tabs.
- **Status:** Fixed

### SIG-013
- **Severity:** Low (P3)
- **Category:** Dead Code & Rebranding Hygiene
- **Affected file:** Removed `src/components/layout/MarketBackdropSlideshow.tsx`, `src/utils/marketBackdrop.ts`, `src/utils/marketBackdrop.test.ts`; updated `server.ts`, `package.json`
- **Affected endpoint or component:** `npx tsc --noEmit`, `GET /api/health`
- **Description:** Unused dead backdrop component caused 8 TypeScript errors; `/api/health` returned legacy `"app":"CRYPTOLENS"` and `package.json` used `"react-example"`.
- **Evidence:** `npx tsc --noEmit` & reference grep (`0` active app references).
- **Root cause:** Verified — leftover files from prior UI architecture.
- **Fix:** Removed dead files and updated app identifier to `SIGLENS`.
- **Verification:** `npx tsc --noEmit` exits `0`; live `/api/health` returns `"app":"SIGLENS"`.
- **Status:** Fixed

### SIG-014
- **Severity:** Medium (External Provider US Geo-Block)
- **Category:** Market-Data Integration / Hosting
- **Affected file:** `src/server/providers.ts` (`fetchDerivativesOverview`, `fetchDerivativesDetail`)
- **Affected endpoint or component:** `GET /api/derivatives`, `GET /api/derivatives/:base`
- **Description:** Hostcry's US-located IP (`66.29.138.229`) receives `HTTP 403` from Bybit's CloudFront WAF on REST endpoints (`api.bybit.com`).
- **Evidence:** Baseline live production probe returned `502 {"error":"HTTP 403 from bybit"}` on `/api/derivatives`.
- **Root cause:** Verified — Bybit CloudFront US IP geo-restriction on shared host egress IP.
- **Fix:** Implemented real live unauthenticated **Hyperliquid Public Perpetuals API** (`https://api.hyperliquid.xyz/info`, `metaAndAssetCtxs` + `fundingHistory`) fallback whenever `api.bybit.com` fails, returning 30 live perpetual markets (mark/oracle price, funding rate, open interest, volume) and 48h funding history with zero mock data. (Direct `exchange=bybit` spot REST remains geo-blocked by Bybit CloudFront; Binance, Kraken, Coinbase, Stocks, CFDs, and Hyperliquid Perpetuals are all live.)
- **Verification:** Verified live on `https://siglens.cc.cd/api/derivatives` (`200 OK`, 30 markets) and `/api/derivatives/BTC` (`200 OK`, 48 funding points).
- **Status:** Fixed (Derivatives Fallback Live)

---

## 5. Unverified Areas & Remaining Risks

1. **End-to-End Google OAuth Token Exchange (`GET /api/auth/google/callback`)**: OAuth routes, CSRF state cookie, SQLite session persistence, `APP_URL=https://siglens.cc.cd`, and per-user preferences/watchlist scoping (`src/server/db.ts`) are all deployed and verified up to the honest `503` unconfigured guard, awaiting only the user's own `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Hostcry cPanel Environment Variables.
2. **Cron & Workspace Hardening**: `POST /api/paper/tick` is now protected in production via `CRON_SECRET` (`401` without header, `200` with matching `X-Cron-Secret` from the 5-minute Hostcry Cron Job, while keeping same-origin browser UI clicks working). Preferences and watchlists automatically isolate per Google `user.id` when signed in; paper-trading ledger and alert rules remain shared-instance until multi-tenant user auth is required.
3. **Unused NPM Packages Pruned**: Removed unused `@google/genai`, `three`, `@types/three`, and `lightweight-charts` from `package.json`.
4. **Destructive Stress Testing**: Intentionally omitted against live production per audit safety rules.

