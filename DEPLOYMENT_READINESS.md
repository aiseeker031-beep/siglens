# SIGLENS — Production Deployment Readiness Checklist (`DEPLOYMENT_READINESS.md`)

**Target Hosting Stack:** Hostcry Shared Hosting — cPanel + CloudLinux Node.js Selector + LiteSpeed Passenger  
**Production Domain:** `https://siglens.cc.cd`  
**App Root:** `/home/<cpanel-user>/siglens`

---

## 1. Runtime & Build Requirements

| Requirement | Verified Value |
|---|---|
| Node.js Version | **Node.js 24.x** (required for built-in `node:sqlite` `DatabaseSync`; verified on `24.22.3` in production) |
| Install Command (Local / CI) | `npm install --legacy-peer-deps --no-audit --no-fund` |
| Typecheck Command | `npm run lint` (`npx tsc --noEmit` — passes with `0` errors) |
| Test Command | `npm test` (`27/27` passing across analytics, numerical reference, SSRF, and API security suites) |
| Frontend Build Command | `npm run build` (Vite 8 → `dist/`, code-split with `429 kB` entry chunk & lazy ECharts) |
| Server Bundle Command | `node scripts/bundle-server.cjs` (esbuild → self-contained `deploy/server.cjs` + `deploy/app.cjs` + `deploy/dist/`; **zero `node_modules` required on cPanel**) |
| Production Startup File (cPanel) | `app.cjs` (sets `dns.setDefaultResultOrder('ipv4first')`, `NODE_ENV=production`, then loads `./server.cjs`) |

---

## 2. Environment Variables (Names Only — Never Commit Values)

Configure in **cPanel → Setup Node.js App → Environment Variables**:

| Variable Name | Required? | Purpose |
|---|---|---|
| `NODE_ENV` | Auto-set in `app.cjs` | Set to `production` to serve static `dist/` and enable strict security checks. |
| `PORT` | Managed by Passenger | Listening port injected by LiteSpeed Passenger (falls back to `3000`). |
| `APP_URL` | **Configured on cPanel** | Canonical public origin (`https://siglens.cc.cd`) used for Google OAuth redirect URI & Same-Origin checks. |
| `CRON_SECRET` | **Configured on cPanel + Cron** | Shared secret sent via `X-Cron-Secret` header by the 5-minute Hostcry Cron Job to authorize `POST /api/paper/tick`. |
| `GOOGLE_CLIENT_ID` | Optional (Required for Google Sign-In) | Google Cloud OAuth 2.0 Web Client ID. |
| `GOOGLE_CLIENT_SECRET` | Optional (Required for Google Sign-In) | Google Cloud OAuth 2.0 Web Client Secret. |
| `ALLOW_LOCAL_OLLAMA` | Optional (`false` by default) | Keep unset/`false` on shared hosting to prevent local loopback AI proxying. |

**Google Cloud Authorized Redirect URI:** `https://siglens.cc.cd/api/auth/google/callback`

---

## 3. cPanel, Reverse Proxy & WebSocket Compatibility

- **LiteSpeed Passenger Proxy:** `app.set('trust proxy', 1)` is enabled so `req.ip` (rate limiting) and `x-forwarded-proto` (`Secure` cookies & HSTS) work accurately behind LiteSpeed TLS termination.
- **WebSocket Support (`wss://siglens.cc.cd/ws`):** **Verified LIVE** on Hostcry LiteSpeed (`101 Switching Protocols` confirmed with real-time `connection:ready`, `bybit:perpetual`, and `binance:spot` ticker broadcasts).
- **Static Asset Caching & SPA Routing:**
  - `/assets/*` served with `Cache-Control: public, max-age=31536000, immutable`.
  - `/` and `/app` served with `Cache-Control: no-cache` so deploys take effect immediately.
  - Unknown `/api/*` paths return `404 application/json` (never swallowed by SPA fallback).
- **Writable Paths:** SQLite database stored at `/home/<user>/siglens/data/cryptolens.db` (`PRAGMA journal_mode = DELETE` to avoid shared-hosting `-wal`/`-shm` lock issues).
- **Scheduled Cron Job:** 5-minute cPanel cron (`*/5 * * * *`) triggers `POST https://siglens.cc.cd/api/paper/tick` to keep autonomous paper-trading bots executing even when no browser is open.
- **CI/CD Automation:** `.github/workflows/deploy.yml` builds locally on GitHub Actions (`ubuntu-latest`, Node 24), uploads compressed `siglens-deploy.zip`, extracts cleanly, restarts CloudLinux Node.js app, and verifies `/api/health`. Requires GitHub Secrets: `CPANEL_HOST`, `CPANEL_USER`, `CPANEL_PASS`.

---

## 4. Rollback Procedure

1. Identify the last known good Git commit (`git log --oneline`).
2. Check out that commit locally (`git checkout <sha>`), run `npm run build && node scripts/bundle-server.cjs`, compress `deploy/` (`app.cjs`, `server.cjs`, `dist/`), remove `/home/<user>/siglens/dist`, upload and extract the zip into `/home/<user>/siglens`, and restart the app via **cPanel → Setup Node.js App → Restart**.
3. Do **not** delete `/home/<user>/siglens/data/cryptolens.db` during rollback so paper positions, alert rules, and user settings remain intact.

---

## 5. Known Open Items / Production Blockers

1. **Google OAuth Credentials Not Yet Set (Optional Blocker for Google Sign-In):** App degrades gracefully with a guided setup modal; add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in cPanel and restart to activate one-click Google login.
2. **Bybit REST US Geo-Block (External Hosting Limitation):** `api.bybit.com` returns `HTTP 403` from Hostcry's US egress IP (`66.29.138.229`), affecting `/api/markets?exchange=bybit` and `/api/derivatives`. All other venues (Binance via `data-api.binance.vision`, Kraken, Coinbase, US Stocks, Global CFDs, DefiLlama, Arbitrage) are verified live.
3. **Single-Tenant Shared Workspace State:** Recommended to add per-user authentication guards and `user_id` partitioning before public multi-user launch.

