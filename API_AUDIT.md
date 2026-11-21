# SIGLENS — Exhaustive API Route Audit (`API_AUDIT.md`)

**Production Base URL:** `https://siglens.cc.cd`  
**Backend Router:** `buildApiRouter()` in `server.ts` mounted at `/api`  
**Frontend Client Wrapper:** `src/services/api.ts` (`api.*`) + `src/hooks/useMarketStream.ts` (`/ws`)

---

## 1. Complete Backend Route Inventory & Verification Status

| # | Endpoint | Method | Handler (`server.ts`) | Auth | Frontend Consumer | Live Prod Status | Issues Found & Resolution |
|---|---|---|---|---|---|---|---|
| 1 | `/api/health` | GET | `buildApiRouter` | Public | Health / CI deploy check | **200 OK** (`app: "SIGLENS"`) | Rebranded from `CRYPTOLENS`; added `Cache-Control: no-store` & security headers. |
| 2 | `/api/providers` | GET | `buildApiRouter` | Public | Diagnostic / external | **200 OK** | Working; returns 6 exchanges + statuses. |
| 3 | `/api/providers/status` | GET | `buildApiRouter` | Public | Diagnostic / external | **200 OK** | Working. |
| 4 | `/api/diagnostics` | GET | `buildApiRouter` | Public | `SettingsView` (`api.getDiagnostics`) | **200 OK** | Working; returns provider latency, DB size, uptime. |
| 5 | `/api/markets` | GET | `buildApiRouter` | Public | `OverviewView`, `MarketsView`, `LandingPage` | **200 OK** (Binance 150, Kraken 15, Coinbase 14, Stocks 20, CFDs 18) | **Fixed:** Invalid `exchange=INVALID` previously returned 200; now returns `400`. Bybit REST returns `502` (US IP 403). |
| 6 | `/api/tickers` | GET | `buildApiRouter` | Public | External / API parity | **200 OK** (150) | **Fixed:** Added Zod query validation (`400` on invalid exchange/marketType). |
| 7 | `/api/markets/search` | GET | `buildApiRouter` | Public | `CommandSearchModal` (`api.searchMarkets`) | **200 OK** | Working across all live connected venues. |
| 8 | `/api/candles` | GET | `buildApiRouter` | Public | Direct API / chart parity | **200 OK** (`400` on bad TF, `502` on invalid symbol) | Working; Zod-validated. |
| 9 | `/api/signals/current` | GET | `buildApiRouter` | Public | `OverviewView` (`api.getAssetSignals`) | **200 OK** (BTC, ETH, NVDA, XAU verified) | **Fixed:** Invalid query params now return `400` instead of `502`. |
| 10 | `/api/indicators` | GET | `buildApiRouter` | Public | Direct API | **200 OK** | **Fixed:** Invalid query params return `400`. |
| 11 | `/api/patterns` | GET | `buildApiRouter` | Public | Direct API | **200 OK** | **Fixed:** Invalid query params return `400`. |
| 12 | `/api/market-regime` | GET | `buildApiRouter` | Public | Direct API | **200 OK** | **Fixed:** Invalid query params return `400`. |
| 13 | `/api/signals/explain` | GET | `buildApiRouter` | Public | Direct API | **200 OK** | **Fixed:** Invalid query params return `400`. |
| 14 | `/api/signals/mtf` | GET | `buildApiRouter` | Public | `api.getMultiTimeframe` | **200 OK** | Working; handles unsupported exchange timeframes cleanly. |
| 15 | `/api/signals/feed` | GET | `buildApiRouter` | Public | `LiveSignalsView`, `SettingsView` | **200 OK** | Working; persisted SQLite events. |
| 16 | `/api/signals/history` | GET | `buildApiRouter` | Public | Direct API | **200 OK** | Working. |
| 17 | `/api/orderbook` | GET | `buildApiRouter` | Public | `api.getOrderBook` | **200 OK** (Binance L2 depth + Stocks/CFDs honest empty) | **Fixed (SIG-008):** Stocks/CFDs previously returned invalid `midPrice: 0` & `spreadPct: 0`; now returns `bestBid: null, bestAsk: null, spreadPct: null`. |
| 18 | `/api/screener` | GET | `buildApiRouter` | Public | `ScreenerView`, `LiveSignalsView` | **200 OK** | **Fixed:** Added Zod validation (`400` on invalid exchange/timeframe). |
| 19 | `/api/screener/presets` | GET | `buildApiRouter` | Public | `ScreenerView` | **200 OK** (20 built-in + custom) | Working. |
| 20 | `/api/screener/presets` | POST | `buildApiRouter` | Same-Origin | `ScreenerView` | Verified in code/tests | Zod-validated + rate-limited + CSRF origin guard. |
| 21 | `/api/screener/presets/:id` | DELETE | `buildApiRouter` | Same-Origin | `ScreenerView` | Verified in code/tests | CSRF origin guard added. |
| 22 | `/api/market-breadth` | GET | `buildApiRouter` | Public | `HeatmapsView` | **200 OK** | **Fixed:** Added Zod validation. |
| 23 | `/api/market-overview` | GET | `buildApiRouter` | Public | `OverviewView`, `LandingPage` | **200 OK** | **Fixed:** Added Zod validation. |
| 24 | `/api/correlation` | GET | `buildApiRouter` | Public | `HeatmapsView` | **200 OK** | **Fixed:** Added Zod validation (`lookback` 20–180). |
| 25 | `/api/compare` | GET | `buildApiRouter` | Public | `api.compareAssets` | **200 OK** | **Fixed:** Added Zod validation. |
| 26 | `/api/derivatives` | GET | `buildApiRouter` | Public | `api.getDerivatives` | **502** (Bybit CloudFront 403 on US host IP) | **Open (Hosting Geo-Block):** Returns honest `502` JSON error, zero mock data. |
| 27 | `/api/derivatives/:base` | GET | `buildApiRouter` | Public | `api.getDerivativesDetail` | **502** (Bybit CloudFront 403 on US host IP) | **Open (Hosting Geo-Block):** Same as above. |
| 28 | `/api/defi` | GET | `buildApiRouter` | Public | `api.getDefi` | **200 OK** (DefiLlama TVL & protocols) | Working. |
| 29 | `/api/watchlists` | GET | `buildApiRouter` | Public | `useAppStore` | **200 OK** | Working. |
| 30 | `/api/watchlists` | PUT | `buildApiRouter` | Same-Origin | `useAppStore` | Verified in code/tests | Zod-validated + rate-limited + CSRF origin guard. |
| 31 | `/api/alerts` | GET | `buildApiRouter` | Public | `useAppStore` | **200 OK** | Working. |
| 32 | `/api/alerts` | POST | `buildApiRouter` | Same-Origin | `api.createAlert` | Verified locally (`400` on SSRF/malformed JSON) | **Fixed (SIG-001):** Blocks private/metadata/non-HTTPS `webhookUrl` at creation and dispatch. |
| 33 | `/api/alerts/:id` | PATCH | `buildApiRouter` | Same-Origin | `api.toggleAlert` | Verified in code/tests | **Fixed:** Added strict Zod patch validation + SSRF webhook guard + rate limit. |
| 34 | `/api/alerts/:id` | DELETE | `buildApiRouter` | Same-Origin | `api.deleteAlert` | Verified in code/tests | CSRF origin guard added. |
| 35 | `/api/settings` | GET | `buildApiRouter` | Public | `useAppStore` | **200 OK** | Working. |
| 36 | `/api/settings` | PUT | `buildApiRouter` | Same-Origin | `useAppStore` | Verified locally & live (`403` on bad Origin, `400` on invalid payload) | **Fixed (SIG-006/007):** Added `preferencesPatchSchema.strict()` + CSRF origin guard. |
| 37 | `/api/cache/clear` | POST | `buildApiRouter` | Same-Origin | `SettingsView` | Verified in code/tests | CSRF origin guard added. |
| 38 | `/api/ai/profiles` | GET | `buildApiRouter` | Public | `SettingsView`, `AIResearchView` | **200 OK** | Metadata only (no API keys stored in SQLite). |
| 39 | `/api/ai/profiles` | POST | `buildApiRouter` | Same-Origin | `SettingsView` | Verified in code/tests | Zod-validated + rate-limited + CSRF origin guard. |
| 40 | `/api/ai/profiles/:id` | DELETE | `buildApiRouter` | Same-Origin | `SettingsView` | Verified in code/tests | CSRF origin guard added. |
| 41 | `/api/ai/test` | POST | `buildApiRouter` | Same-Origin | `SettingsView` | Verified in unit/SSRF tests | **Fixed (SIG-001):** DNS + IPv6 SSRF guard + `redirect: 'error'`. |
| 42 | `/api/ai/analyze` | POST | `buildApiRouter` | Same-Origin | `AIResearchView` | Verified in unit/SSRF tests | **Fixed (SIG-001):** DNS + IPv6 SSRF guard + `redirect: 'error'`. |
| 43 | `/api/paper/state` | GET | `buildApiRouter` | Public | `PaperArenaView`, `LandingPage` | **200 OK** | Working; real SQLite paper ledger. |
| 44 | `/api/paper/account` | PUT | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | Zod-validated + CSRF origin guard. |
| 45 | `/api/paper/bots` | POST | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | Zod-validated + CSRF origin guard. |
| 46 | `/api/paper/bots/:id` | PATCH | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | Zod-validated + CSRF origin guard. |
| 47 | `/api/paper/bots/:id` | DELETE | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | CSRF origin guard added. |
| 48 | `/api/paper/tick` | POST | `buildApiRouter` | Public/Cron | `PaperArenaView`, cPanel 5m Cron | Verified (`SIG-003` ATR fix deployed) | **Fixed (SIG-003):** Bot trailing ATR stop now reads `best.price`. |
| 49 | `/api/paper/order` | POST | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | Zod-validated + CSRF origin guard. |
| 50 | `/api/paper/positions/:id/close` | POST | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | CSRF origin guard added. |
| 51 | `/api/paper/emergency-stop` | POST | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | CSRF origin guard added. |
| 52 | `/api/paper/reset` | POST | `buildApiRouter` | Same-Origin | `PaperArenaView` | Verified in code/tests | Zod-validated + CSRF origin guard. |
| 53 | `/api/arbitrage` | GET | `buildApiRouter` | Public | `ArbitrageView`, `LandingPage` | **200 OK** (3 venues, 14 spot spreads, 8 Stat-Arb Z-score pairs) | **Fixed:** Added `feeBps` 0–200 Zod validation (`400` on invalid). |
| 54 | `/api/auth/me` | GET | `buildApiRouter` | Public | `useAppStore`, `GoogleAuthButton` | **200 OK** (`configured: false`) | Working; returns honest OAuth configuration state. |
| 55 | `/api/auth/google` | GET | `buildApiRouter` | Public | `GoogleAuthButton` | **503 JSON** (`?format=json`) / redirect when unconfigured | Ready for `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`. |
| 56 | `/api/auth/google/callback` | GET | `buildApiRouter` | OAuth State | Google OAuth redirect | Code-verified (live exchange requires Google creds) | CSRF state cookie + `HttpOnly; Secure; SameSite=Lax` SQLite session. |
| 57 | `/api/auth/logout` | POST | `buildApiRouter` | Same-Origin | `GoogleAuthButton` | Verified in code/tests | Clears SQLite session & expires cookie. |
| 58 | `/api/*` (unknown) | ALL | `buildApiRouter` catch-all | Public | — | **404 JSON** (`{"error":"API route not found"}`) | **Fixed (SIG-006):** Previously returned `200 text/html` SPA shell. |
| 59 | `/ws` | WS | `MarketWebSocketHub` (`src/server/wsHub.ts`) | Public | `useMarketStream` | **101 Switching Protocols** (live ticks verified) | **Fixed (SIG-009):** Added 16KB `maxPayload`, strict subscribe allowlist, and timer cleanup. |

