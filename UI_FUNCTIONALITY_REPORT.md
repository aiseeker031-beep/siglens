# SIGLENS — Frontend UI & Responsive Functionality Report (`UI_FUNCTIONALITY_REPORT.md`)

**Production URL Tested:** `https://siglens.cc.cd`  
**Browser Automation:** Playwright `1.65.1` driving headless Google Chrome (`--disable-quic`)  
**Audit Date:** 2026-11-21

---

## 1. Audited Pages, Routes & Interactive Workspaces

| Route / Tab | Heading Verified | Controls Detected | Error Boundary | Status |
|---|---|---|---|---|
| `/` (Landing Page — 6 Sections) | `See Beyond the Market` (`#hero`, `#capabilities`, `#markets`, `#arbitrage`, `#arena`, `#architecture`) | 50 buttons, 6 nav/anchor links | None | **Working** (live BTC price, live arbitrage card, live US Stocks switcher, Google OAuth modal) |
| `/app` → `Home` | `Dashboard Overview` | 12 buttons, 2 inputs/selects + ECharts live canvas | None | **Working** (verified symbol switch `BTC/USDT` → `ETH/USDT` & asset class → `Stocks`) |
| `/app` → `Markets` | `Markets Explorer` | Dense toggle, 4 filters, sortable table, watchlist stars | None | **Working** |
| `/app` → `Signals` | `Live Signal Feed` | 3 mode/action buttons, 6 filters + structured signal cards | None | **Working** (synced to top-bar asset class switcher) |
| `/app` → `Screener` | `Advanced Screener` | 45 buttons (20 presets + custom), 23 inputs/selects | None | **Working** (synced to top-bar asset class switcher) |
| `/app` → `Heatmaps` | `Market Heatmaps` | 7 sub-tabs/buttons, 2 selects + ECharts treemap/matrix | None | **Working** (synced to top-bar asset class switcher) |
| `/app` → `Arbitrage` | `Real-Time Arbitrage Scanner` | 3 mode/action buttons, 4 inputs (capital, fee bps, min %, search) | None | **Working** (live Binance/Kraken/Coinbase spreads + 8 Stat-Arb Z-score pairs) |
| `/app` → `Bot Arena` | `Autonomous Bot Arena` | 20 buttons (bots, manual orders, tick, emergency flatten, reset), 4 inputs | None | **Working** (trailing ATR bug `SIG-003` fixed on backend) |
| `/app` → `AI Insights` | `AI Research Insights` | Honest BYOK disabled state + Settings navigation | None | **Working** |
| `/app` → `Settings` | `Settings & Diagnostics` | 6 sub-tabs + preferences, weights, diagnostics, BYOK, export/import | None | **Working** |

---

## 2. Confirmed UI & Interaction Defects Found & Repaired

1. **Google OAuth Modal Trapped Inside Sticky Header (`SIG-004` — High):**
   - *Before:* Clicking `Google Sign in` inside the sticky `backdrop-blur-xl` `<header>` rendered the `fixed inset-0` modal inside the 64px header containing block, pushing `button[aria-label="Close modal"]` outside the viewport (`googleModalCloseClickable: false`).
   - *After:* Migrated modal to `createPortal(..., document.body)` + `Escape` dismissal. Re-verified live: `googleModalOpened: true`, `googleModalCloseClickable: true`.
2. **Global Command Search `Ctrl+K` Broken (`SIG-005` — High):**
   - *Before:* Duplicate `keydown` listeners in `App.tsx` and `CommandSearchModal.tsx` double-toggled `commandSearchOpen` (`false → true → false`), so `Ctrl+K` never opened search (`commandSearchOpened: false`).
   - *After:* Removed duplicate listener from `CommandSearchModal.tsx`. Re-verified live: `Ctrl+K` opens modal, typing `ETH/USDT` and clicking row switches dashboard to `ETH/USDT` (`commandSearchOpened: true`, `ethSelected: true`).
3. **Top Header Asset-Class Switcher Ignored on 3 Views (`SIG-010` — Medium):**
   - *Before:* Switching `Crypto | Stocks | CFDs` in `AppShell` did not update local `exchange`/`marketType` state in `LiveSignalsView`, `ScreenerView`, or `HeatmapsView` while mounted.
   - *After:* Added `useEffect` sync hooks to all three views. Re-verified live (`stocksGlobalSwitched: true`).
4. **Landing Page Mobile & Tablet Horizontal Overflow (`SIG-011` — Medium):**
   - *Before:* Landing page overflowed at `360px` (`scrollW: 428`), `390px` (`scrollW: 428`), and `768px` (`scrollW: 793`).
   - *After:* Tightened mobile navbar layout, added `overflow-x-clip`, and wrapped segmented control in scrollable container. Re-verified live across all 6 viewports: `overflow: false` (`scrollW === innerW`).
5. **Landing Page Hero Live Price Delay & Lazy Suspense Transition (`SIG-011`, `SIG-012` — Medium):**
   - *Before:* `Promise.all` blocked Hero BTC price behind slower arbitrage scans (`hasLivePrice: false` at 3s); initial entry JS was `1,751 kB`; outer `<Suspense>` around `<AnimatePresence mode="wait">` stalled rapid lazy tab transitions.
   - *After:* Decoupled Hero fetches (`hasLivePrice: true`), lazy-loaded dashboard views (`429.9 kB` entry chunk, `-75.5%`), and moved `<Suspense>` inside `<motion.div key={activeSection}>`.

---

## 3. Responsive Layout Verification Matrix (Post-Fix Live Production)

| Viewport | `/` Landing (`scrollW / innerW`) | `/app` Dashboard (`scrollW / innerW`) | Horizontal Overflow |
|---|---|---|---|
| `360px` Mobile | `360 / 360` | `360 / 360` | **None** (fixed from `428px` on `/`) |
| `390px` Mobile | `390 / 390` | `390 / 390` | **None** (fixed from `428px` on `/`) |
| `768px` Tablet | `768 / 768` | `768 / 768` | **None** (fixed from `793px` on `/`) |
| `1024px` Laptop | `1024 / 1024` | `1024 / 1024` | **None** |
| `1440px` Desktop | `1440 / 1440` | `1440 / 1440` | **None** |
| `1920px` Desktop | `1920 / 1920` | `1920 / 1920` | **None** |

---

## 4. Browser Console, Runtime & Network Error Audit (Post-Fix)

- **JavaScript Console Errors:** `0`
- **Uncaught Page Exceptions (`pageerror`):** `0`
- **Unexpected Failed Network Requests (`>= 400`):** `0`
- **React Error Boundary Activations:** `0`
- **Screenshots:** Headless automated DOM & geometry assertions were executed directly against live `https://siglens.cc.cd`; static PNG screenshots were not committed to keep the repository lightweight.

