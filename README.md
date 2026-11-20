# CRYPTOLENS — See Beyond the Market

**CRYPTOLENS** is an open-source, strictly **analytics-only** cryptocurrency market intelligence platform combining real-time multi-exchange market data, a transparent 10-indicator deterministic signal engine, synchronized 2D professional charting (TradingView Lightweight Charts v5), and an interactive WebGL 3D Financial Chart Studio (Three.js).

> **Strictly Analytics-Only**: CRYPTOLENS contains zero trading execution, zero buy/sell order forms, zero exchange account connections, zero wallet custody, and zero paper-trading simulations.

---

## Key Capabilities

- **Zero Paid APIs Required**: Operates out-of-the-box using free, unauthenticated public endpoints from Binance, Bybit V5, Kraken, Coinbase, DefiLlama, and Alternative.me.
- **Real-Time Streaming + Local Persistence**: Backend WebSocket aggregator (`/ws`) fans out live Binance Spot and Bybit Linear Perpetual tickers & forming candles while persisting cached OHLCV bars, signal snapshots, confirmed signal transitions, watchlists, custom screener presets, alert rules, and user preferences in SQLite (`data/cryptolens.db` via Node 22 `node:sqlite`).
- **Deterministic 10-Indicator Signal Engine (`v1.0.0`)**:
  - Evaluates EMA Stack (`9/20/50/100/200`), RSI (`14`), MACD (`12/26/9`), ADX/DMI (`14`), Bollinger Bands (`20, 2`), Stochastic RSI, On-Balance Volume (OBV), UTC-Session VWAP, Relative Volume (`RVOL 20`), and ATR (`14` non-directional volatility quality modifier).
  - Strictly separates **Confirmed** (closed candle) signals from **Provisional** (forming live bar) estimates.
  - Exposes raw indicator calculations, supporting evidence, contradictory evidence, invalidation thresholds, market regime classification, candlestick & structural pattern detection, support/resistance pivot zones, and causal non-repainting historical validation across `1/3/5/10`-bar horizons.
- **2D Professional Chart + Interactive 3D Chart Studio**:
  - 2D Lightweight Charts v5: Candlestick, Heikin-Ashi, Bars, Line, Area, Volume histogram, EMA 20/50/200, VWAP, Bollinger Bands, S/R horizontal lines, PNG export.
  - 3D Three.js WebGL Studio: 5 analytical modes — 3D Candlesticks (selectable Z-axis: Volume, Volatility, RSI Strength), 3D Volume Landscape, Observed Volatility Surface, Live Market Depth Order Book Walls, and Indicator Landscape — with raycast candle inspection, Perspective/Orthographic camera toggle, and automatic 2D fallback.
- **13 Complete Analytical Workspaces**: Overview, Markets, Asset Explorer, Live Signal Feed, Advanced Screener (20 executable built-in presets + custom presets), 3D Chart Studio, Market Heatmaps & Pearson Correlation Matrix, Derivatives Analytics (Bybit V5), DeFi Intelligence (DefiLlama), Compare Assets (up to 5), Smart Alerts (SQLite rules + browser notifications + optional HTTPS webhooks), Optional BYOK AI Research Assistant, and Settings & Diagnostics.

---

## Quick Start

### Prerequisites
- **Node.js 22+** (uses built-in `node:sqlite` for zero-compilation disk-backed SQLite persistence)

### Local Development
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

### Production Build & Start
```bash
npm run build
npm start
```

### Run Deterministic Analytics Unit Tests
```bash
npm test
```

### Docker Deployment
```bash
docker compose up --build -d
```
SQLite data persists in the named `cryptolens_data` volume mounted at `/app/data`.

---

## Signal Engine Mathematical Specification

1. **Directional Indicator Evidence ($e_i \in [-1, +1]$)**:
   - Each of the 9 directional families (`EMA`, `MACD`, `ADX/DMI`, `RSI`, `Bollinger`, `StochRSI`, `OBV`, `VWAP`, `RVOL`) outputs a bounded evidence score $e_i \in [-1, +1]$ plus availability flags.
2. **Dynamic Weight Normalization**:
   - Let $A$ be the set of available directional indicators and $w_i$ be the configured weights (default sum = `100`: EMA `20`, MACD `15`, ADX `15`, RSI `10`, Bollinger `10`, StochRSI `10`, OBV `8`, VWAP `7`, RVOL `5`).
   - Effective weight: $\tilde{w}_i = w_i / \sum_{j \in A} w_j$.
   - Raw weighted score: $S_{\text{raw}} = 100 \cdot \sum_{i \in A} \tilde{w}_i e_i$.
3. **ATR (14) Volatility Quality Modifier ($m_{\text{vol}} \in [0.5, 1.0]$)**:
   - ATR is strictly non-directional. Extreme ATR% volatility dampens directional conviction rather than flipping direction: $S_{\text{final}} = S_{\text{raw}} \cdot m_{\text{vol}}$.
   - In low-ADX range regimes (`Sideways / Range` with `ADX < 16`), a range damping factor (`0.55`) reduces whipsaw false positives.
4. **Safeguards & Classification Thresholds**:
   - Coverage below minimum (`65%` default) or insufficient candle history returns `INSUFFICIENT_DATA`.
   - `STRONG_BULLISH` ($\ge +60$) and `STRONG_BEARISH` ($\le -60$) require indicator directional agreement $\ge 60\%$ (otherwise capped at `BULLISH` / `BEARISH`).
   - `BULLISH`: $[+25, +60)$, `NEUTRAL`: $(-25, +25)$, `BEARISH`: $(-60, -25]$.
5. **Non-Repainting Causal Validation**:
   - Historical validation evaluates every bar $t$ using strictly candles $[0 \dots t]$ and measures forward close returns at $t+1, t+3, t+5, t+10$ without look-ahead bias.

---

## REST & WebSocket API Reference

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/market-overview` | `GET` | Aggregate market pulse, Fear & Greed index, movers, leaders, recent signal events |
| `/api/markets` | `GET` | Live spot/perpetual tickers (`exchange`, `marketType`) |
| `/api/markets/search` | `GET` | Cross-exchange symbol search (`q`) |
| `/api/signals/current` | `GET` | Confirmed + Provisional signal reports, series, patterns, S/R zones, historical validation |
| `/api/signals/mtf` | `GET` | Multi-timeframe alignment matrix (`5m`, `15m`, `1h`, `4h`, `1d`) |
| `/api/signals/feed` | `GET` | Persisted deduplicated confirmed signal event stream |
| `/api/orderbook` | `GET` | Live bid/ask depth snapshot for 3D Market Depth mode |
| `/api/screener` | `GET` | Multi-asset deterministic scan rows (`exchange`, `marketType`, `timeframe`, `refresh`) |
| `/api/screener/presets` | `GET/POST/DELETE` | Built-in and persisted custom screener presets |
| `/api/market-breadth` | `GET` | Universe breadth percentages (Bullish/Bearish, >EMA50, >EMA200) |
| `/api/correlation` | `GET` | Aligned log-return Pearson correlation matrix & sample counts |
| `/api/compare` | `GET` | Normalized multi-asset return overlay, signals, and pairwise correlation |
| `/api/derivatives` | `GET` | Bybit V5 perpetual funding, open interest, basis spread, observations |
| `/api/derivatives/:base` | `GET` | Historical funding, open interest, and account long/short ratio |
| `/api/defi` | `GET` | DefiLlama global TVL, historical TVL, chains, protocols, stablecoins, DEX volume |
| `/api/watchlists` | `GET/PUT` | Persisted user watchlist |
| `/api/alerts` | `GET/POST/PATCH/DELETE` | Persistent alert rules and triggered event log |
| `/api/settings` | `GET/PUT` | Persisted workspace preferences & signal engine weights |
| `/api/diagnostics` | `GET` | Live provider health, latency, WebSocket status, SQLite storage stats |
| `/api/ai/profiles`, `/api/ai/test`, `/api/ai/analyze` | `GET/POST/DELETE` | Optional BYOK AI provider metadata and grounded analytical relay |
| `/ws` | `WebSocket` | Real-time ticker, forming-candle, and triggered-alert broadcast stream |

---

## Optional BYOK AI Privacy Model

AI functionality is **disabled by default**. If a user chooses to connect OpenAI, Anthropic, Google Gemini, Groq, OpenAI-compatible endpoints, or local Ollama:
- API keys are never persisted on the server or in SQLite.
- Keys live only in browser `sessionStorage` or an optional client-side Web Crypto **AES-GCM 256-bit** vault encrypted with a user-supplied PBKDF2 passphrase.
- Outbound AI requests include SSRF protection blocking private/internal IP ranges unless `ALLOW_LOCAL_OLLAMA=true` is explicitly enabled.

---

## Public Data Providers & Open-Source Attribution

- **Market Data**: Binance Public Market Data API, Bybit V5 Public API, Kraken Public REST API, Coinbase Exchange Public API, DefiLlama Public API, Alternative.me Crypto Fear & Greed Index.
- **Open-Source Libraries**: React, Vite, Express, TypeScript, Tailwind CSS, TradingView Lightweight Charts (Apache-2.0), Three.js (MIT), Apache ECharts (Apache-2.0), Zustand (MIT), Zod (MIT), Lucide React (ISC), `ws` (MIT).
