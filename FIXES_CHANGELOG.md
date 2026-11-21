# SIGLENS — Fixes Changelog (`FIXES_CHANGELOG.md`)

All modifications made during the Full-Stack Security, API, Functionality & Production Audit (2026-11-21).

---

## 1. Shared SSRF Validator & Webhook/AI Outbound Hardening (`SIG-001`)
- **Original problem:** Alert webhooks (`src/server/scanner.ts`) only verified `startsWith('https://')`, permitting SSRF against RFC1918, loopback, link-local, IPv6 private, and cloud metadata IPs. `src/server/aiAdapters.ts` lacked IPv6 private blocking, DNS lookup verification, and HTTP redirect blocking.
- **Files changed:** Created `src/server/ssrf.ts`; updated `src/server/aiAdapters.ts`, `src/server/scanner.ts`, `server.ts`.
- **Root cause:** No centralized IPv4/IPv6/DNS SSRF validator or `redirect: 'error'` policy on outbound `fetch()` calls.
- **Implemented solution:** Added `isPrivateOrReservedIp`, `assertSafeExternalUrlSync`, and async `assertSafeExternalUrl` (`dns.lookup(..., { all: true })`). Enforced at alert creation/update (`POST /api/alerts`, `PATCH /api/alerts/:id`), webhook dispatch, and AI provider execution with `redirect: 'error'`.
- **Tests added:** `src/server/audit.regression.test.ts` (IPv4/IPv6/metadata unit tests, Ollama prod guard test, HTTP `400` test on `POST /api/alerts` with `169.254.169.254`).
- **Regression outcome:** Passed (`npm test` 27/27).

## 2. Production Security Headers, CSP, Cache-Control & Proxy Trust (`SIG-002`)
- **Original problem:** Production responses exposed `X-Powered-By: Express`, omitted OWASP browser security headers (`HSTS`, `CSP`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`), omitted `Cache-Control: no-store` on API routes, and omitted `trust proxy`.
- **Files changed:** `server.ts`.
- **Root cause:** Express defaults used without security header middleware or proxy configuration.
- **Implemented solution:** Added `app.disable('x-powered-by')`, `app.set('trust proxy', 1)`, OWASP headers + CSP middleware, `Cache-Control: no-store` on `/api/*`, `no-cache` on `index.html`, and `maxAge: '365d', immutable: true` on hashed `/assets/*`.
- **Tests added:** Header assertions in `src/server/audit.regression.test.ts` + live `https://siglens.cc.cd` header probe.
- **Regression outcome:** Passed locally and live in production.

## 3. Autonomous Bot Trailing ATR Stop Runtime Bug (`SIG-003`)
- **Original problem:** `src/server/paperEngine.ts:1124` read `best.lastPrice` on `ScreenerRow` (whose actual field is `best.price`), silently evaluating to `undefined` and disabling trailing ATR stops on every autonomous bot entry.
- **Files changed:** `src/server/paperEngine.ts`.
- **Root cause:** Property name mismatch (`ScreenerRow.price` vs `MarketTicker.lastPrice`).
- **Implemented solution:** Updated line 1124 to use `best.price`.
- **Tests added:** Enforced via strict `npx tsc --noEmit`.
- **Regression outcome:** `tsc --noEmit` exits `0`.

## 4. Google OAuth Modal Viewport Trap Fix (`SIG-004`)
- **Original problem:** Rendering the `fixed inset-0` setup modal inside `<header className="sticky backdrop-blur-xl">` trapped it in the 64px header containing block, pushing the close button outside the viewport.
- **Files changed:** `src/components/ui/GoogleAuthButton.tsx`.
- **Root cause:** CSS `backdrop-filter` creates a new containing block for `position: fixed` descendants.
- **Implemented solution:** Rendered modal via `createPortal(..., document.body)` with `Escape` key handler and `overflow-y-auto`.
- **Tests added:** Verified via headless Chrome Playwright crawl on `https://siglens.cc.cd/`.
- **Regression outcome:** `googleModalOpened: true` and `googleModalCloseClickable: true`.

## 5. Duplicate `Ctrl+K` Command Search Race Condition (`SIG-005`)
- **Original problem:** Pressing `Ctrl+K` failed to open Global Command Search because both `App.tsx` and `CommandSearchModal.tsx` registered global `keydown` listeners toggling `commandSearchOpen`, cancelling each other out (`false → true → false`).
- **Files changed:** `src/components/layout/CommandSearchModal.tsx`.
- **Root cause:** Duplicate `window.addEventListener('keydown')` registration.
- **Implemented solution:** Removed duplicate `Ctrl+K` toggle from `CommandSearchModal.tsx` while keeping `Escape` dismissal.
- **Tests added:** Verified via Playwright `Control+k` + `ETH/USDT` search & selection on `https://siglens.cc.cd/app`.
- **Regression outcome:** `commandSearchOpened: true` and `ethSelected: true`.

## 6. Strict API Validation, JSON 404, Malformed JSON 400, Same-Origin CSRF & Rate-Limiter Pruning (`SIG-006`, `SIG-007`)
- **Original problem:** Unknown `/api/*` paths returned `200 text/html`; several GET endpoints lacked Zod validation (`exchange=INVALID` returned 200); `PUT /api/settings` & `PATCH /api/alerts/:id` lacked strict validation; malformed JSON threw Express default error output; mutating API routes lacked Same-Origin CSRF checks; rate limiter `Map` never pruned expired keys.
- **Files changed:** `server.ts`.
- **Root cause:** Missing Zod schemas, missing API catch-all 404, missing JSON syntax error middleware, missing Origin guard, and missing Map eviction.
- **Implemented solution:** Added strict Zod schemas for all GET/PATCH/PUT routes (`preferencesPatchSchema.strict()`), JSON `404` catch-all on `buildApiRouter()`, JSON `400` syntax error handler, Same-Origin `Origin` CSRF guard (`403` on cross-origin browser mutations), and expired-entry eviction in `rateLimit`.
- **Tests added:** 8 HTTP integration assertions in `src/server/audit.regression.test.ts` + live probes on `https://siglens.cc.cd`.
- **Regression outcome:** All passed locally and live.

## 7. Equity/CFD OrderBook Schema Compliance (`SIG-008`)
- **Original problem:** `fetchOrderBook` for `stocks`/`cfds` returned invalid `midPrice: 0`, omitted `bestBid`/`bestAsk`, and returned `spreadPct: 0` instead of `null`.
- **Files changed:** `src/server/providers.ts`.
- **Root cause:** Schema mismatch against `OrderBookSnapshot`.
- **Implemented solution:** Returned `{ bestBid: null, bestAsk: null, spreadPct: null }`.
- **Tests added:** `audit.regression.test.ts` + live `/api/orderbook?exchange=stocks...` probe + `tsc --noEmit`.
- **Regression outcome:** Passed locally and live.

## 8. WebSocket Hub Input Validation & Timer Cleanup (`SIG-009`)
- **Original problem:** Untrusted WS `subscribe` frames interpolated raw `symbol`/`timeframe` into upstream Binance WS URLs (even for stocks/CFDs), lacked `maxPayload`, and leaked reconnect timer handles in an array.
- **Files changed:** `src/server/wsHub.ts`.
- **Root cause:** Unvalidated WS JSON payload and uncleaned timer array.
- **Implemented solution:** Added `maxPayload: 16384`, strict allowlists for exchange/symbol/timeframe, Binance-only kline switching, and self-cleaning `Set<NodeJS.Timeout>`.
- **Tests added:** Verified via `tsc --noEmit`, bundle build, and live `wss://siglens.cc.cd/ws` stream probe.
- **Regression outcome:** Passed.

## 9. Global Asset Class Header Sync Across Views (`SIG-010`)
- **Original problem:** Clicking `Crypto | Stocks | CFDs` in the top `AppShell` bar did not update `LiveSignalsView`, `ScreenerView`, or `HeatmapsView` while mounted.
- **Files changed:** `src/views/LiveSignalsView.tsx`, `src/views/ScreenerView.tsx`, `src/views/HeatmapsView.tsx`.
- **Root cause:** Local state initialized once from store without `useEffect` sync.
- **Implemented solution:** Added `useEffect` hooks syncing local exchange/marketType state to global store changes.
- **Tests added:** Verified via Playwright asset-class switch & build.
- **Regression outcome:** Passed.

## 10. Landing Page Mobile/Tablet Overflow, Instant Hero Data & Code-Splitting (`SIG-011`, `SIG-012`)
- **Original problem:** Landing page overflowed horizontally at `360px` (`428px`), `390px` (`428px`), and `768px` (`793px`); Hero waited for `Promise.all` before rendering live BTC price; single `1,751 kB` entry bundle loaded ECharts (`1.1 MB`) synchronously on Landing Page; outer `<Suspense>` around `<AnimatePresence mode="wait">` stalled rapid lazy tab transitions.
- **Files changed:** `src/views/LandingPage.tsx`, `src/App.tsx`.
- **Root cause:** Missing `overflow-x-clip`, wide mobile header spacing, coupled `Promise.all`, synchronous heavy view imports, and `Suspense` wrapping `AnimatePresence`.
- **Implemented solution:** Tightened mobile Landing Page navbar + `overflow-x-clip` + scrollable segmented tabs, decoupled the 3 live fetches, lazy-loaded all 9 dashboard views (cutting entry JS by **75.5%** to `429.9 kB` / `131.9 kB` gzip), and moved `<Suspense>` inside `<motion.div key={activeSection}>`.
- **Tests added:** Verified via Vite build output & live Playwright 6-viewport + 9-tab crawl.
- **Regression outcome:** Verified live.

## 11. Dead Code Removal & Rebranding Hygiene (`SIG-013`)
- **Original problem:** Unused `MarketBackdropSlideshow.tsx` caused 8 TypeScript errors; `/api/health` returned `"app":"CRYPTOLENS"`; `package.json` used `"react-example"`.
- **Files changed:** Deleted `src/components/layout/MarketBackdropSlideshow.tsx`, `src/utils/marketBackdrop.ts`, `src/utils/marketBackdrop.test.ts`; updated `server.ts` and `package.json`.
- **Root cause:** Leftover files from removed backdrop slideshow feature.
- **Implemented solution:** Removed dead files (0 active app references) and updated brand metadata to `SIGLENS`.
- **Tests added:** `npx tsc --noEmit` + `audit.regression.test.ts` (`/api/health` asserts `app === 'SIGLENS'`).
- **Regression outcome:** Passed (`0` TS errors).

