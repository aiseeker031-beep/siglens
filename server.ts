import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import {
  ALL_EXCHANGES,
  BUILT_IN_SCREENER_PRESETS,
  defaultMarketTypeFor,
  EXCHANGE_MARKET_TYPES,
  EXCHANGE_TIMEFRAMES,
  MTF_TIMEFRAMES,
} from './src/shared/constants';
import type {
  AlertRule,
  ExchangeId,
  MarketOverviewPayload,
  MarketType,
  MultiTimeframeRow,
  MultiTimeframeSummary,
  Timeframe,
} from './src/shared/types';
import { signalLabel } from './src/shared/format';
import { buildCorrelationMatrix, buildNormalizedPerformance, computeMarketBreadth } from './src/analytics/correlation';
import { filterScreenerRows, parseNaturalLanguageToScreenerFilters } from './src/analytics/screenerRules';
import { runFullAssetAnalysis } from './src/analytics/signals';
import { invokeAIProvider } from './src/server/aiAdapters';
import {
  clearCandlesCache,
  deleteAIProfile,
  deleteAlertRule,
  deleteCustomPreset,
  getDb,
  getStorageStats,
  getStoredPreferences,
  getWatchlist,
  listAIProfiles,
  listAlertEvents,
  listAlertRules,
  listCustomPresets,
  listSignalEvents,
  saveAIProfile,
  saveCustomPreset,
  saveStoredPreferences,
  saveWatchlist,
  upsertAlertRule,
} from './src/server/db';
import {
  clearMemoryCache,
  fetchCandles,
  fetchDefiOverview,
  fetchDerivativesDetail,
  fetchDerivativesOverview,
  fetchFearAndGreed,
  fetchOrderBook,
  getMarketTickers,
  getProviderStatuses,
  parseCanonicalId,
} from './src/server/providers';
import { runScreenerScan, startBackgroundScanner } from './src/server/scanner';
import { getMarketIntelligence } from './src/server/marketIntel';
import { runQuantSignalScan } from './src/server/quantSignals';
import {
  buildPaperArenaSnapshot,
  closePaperPosition,
  createPaperBot,
  deletePaperBot,
  emergencyStopAndFlatten,
  openPaperOrder,
  resetPaperAccount,
  runAutonomousPaperCycle,
  startAutonomousPaperLoop,
  topUpPaperFunds,
  updatePaperAccountConfig,
  updatePaperBot,
  updatePaperPositionTpSl,
} from './src/server/paperEngine';
import { wsHub } from './src/server/wsHub';
import { scanLiveArbitrage } from './src/server/arbitrage';
import { assertSafeExternalUrlSync } from './src/server/ssrf';
import {
  buildAuthStateResponse,
  buildGoogleAuthUrl,
  createOAuthState,
  deleteSessionFromReq,
  ensureAuthTables,
  exchangeGoogleCodeAndCreateSession,
  getGoogleCallbackUrl,
  getSessionUserFromReq,
  isGoogleOAuthConfigured,
  isSecureRequest,
  parseCookies,
  serializeCookie,
  SESSION_COOKIE,
  STATE_COOKIE,
} from './src/server/auth';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function shouldEnforceGoogleAuth(): boolean {
  if (process.env.SIGLENS_REQUIRE_AUTH === 'true') return true;
  return process.env.NODE_ENV === 'production' && isGoogleOAuthConfigured();
}

function resolveLandingHtmlPath(): string {
  const distLanding = path.resolve(process.cwd(), 'dist', 'landing.html');
  if (fs.existsSync(distLanding)) return distLanding;
  return path.resolve(process.cwd(), 'public', 'landing.html');
}

const exchangeSchema = z.enum([
  'binance',
  'bybit',
  'okx',
  'kucoin',
  'gateio',
  'mexc',
  'bitget',
  'htx',
  'cryptocom',
  'hyperliquid',
  'kraken',
  'coinbase',
  'stocks',
  'cfds',
]);
const exchangeOrAllSchema = z.enum([
  'binance',
  'bybit',
  'okx',
  'kucoin',
  'gateio',
  'mexc',
  'bitget',
  'htx',
  'cryptocom',
  'hyperliquid',
  'kraken',
  'coinbase',
  'stocks',
  'cfds',
  'all',
]);
const marketTypeSchema = z.enum(['spot', 'perpetual', 'equity', 'cfd']);
const marketTypeOrAllSchema = z.enum(['spot', 'perpetual', 'equity', 'cfd', 'all']);
const timeframeSchema = z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w']);

const preferencesPatchSchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    timezone: z.enum(['UTC', 'local']).optional(),
    decimalPrecision: z.union([z.literal('auto'), z.literal(2), z.literal(4), z.literal(6)]).optional(),
    defaultExchange: exchangeSchema.optional(),
    defaultMarketType: marketTypeSchema.optional(),
    defaultPair: z.string().min(3).max(24).optional(),
    defaultTimeframe: timeframeSchema.optional(),
    denseMode: z.boolean().optional(),
    sidebarCollapsed: z.boolean().optional(),
    defaultChartMode: z.enum(['2d', '3d']).optional(),
    showLiveProvisional: z.boolean().optional(),
    reducedMotion: z.boolean().optional(),
    weights: z
      .object({
        ema: z.number().min(0).max(100).optional(),
        macd: z.number().min(0).max(100).optional(),
        rsi: z.number().min(0).max(100).optional(),
        adx: z.number().min(0).max(100).optional(),
        bollinger: z.number().min(0).max(100).optional(),
        stochRsi: z.number().min(0).max(100).optional(),
        obv: z.number().min(0).max(100).optional(),
        vwap: z.number().min(0).max(100).optional(),
        rvol: z.number().min(0).max(100).optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        strongBullish: z.number().min(10).max(100).optional(),
        bullish: z.number().min(1).max(95).optional(),
        bearish: z.number().min(-95).max(-1).optional(),
        strongBearish: z.number().min(-100).max(-10).optional(),
      })
      .strict()
      .optional(),
    minCoveragePct: z.number().min(10).max(100).optional(),
    minAgreementForStrongPct: z.number().min(20).max(100).optional(),
  })
  .strict();

export function buildApiRouter(): express.Router {
  const router = express.Router();

  // Never cache dynamic/sensitive API responses in shared proxies or browsers
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Same-Origin CSRF guard on state-changing routes when Origin header is present
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).host.toLowerCase();
        const requestHost = String(req.headers['x-forwarded-host'] || req.get('host') || '')
          .split(',')[0]
          .trim()
          .toLowerCase();
        const appUrlHost = process.env.APP_URL ? new URL(process.env.APP_URL).host.toLowerCase() : '';
        if (originHost !== requestHost && (!appUrlHost || originHost !== appUrlHost)) {
          return res.status(403).json({ error: 'Cross-origin state-changing request rejected.' });
        }
      } catch {
        return res.status(403).json({ error: 'Invalid Origin header.' });
      }
    }
    return next();
  });

  // Strict Google OAuth session gate for all app API endpoints when auth is enforced
  router.use((req, res, next) => {
    if (!shouldEnforceGoogleAuth()) return next();
    const p = req.path;
    if (
      p === '/health' ||
      p === '/auth/me' ||
      p === '/auth/google' ||
      p === '/auth/google/callback' ||
      p === '/auth/logout'
    ) {
      return next();
    }
    if (p === '/paper/tick' && process.env.CRON_SECRET) {
      const headerSecret = String(req.headers['x-cron-secret'] || '');
      const authHeader = String(req.headers.authorization || '');
      if (
        headerSecret === process.env.CRON_SECRET ||
        authHeader === `Bearer ${process.env.CRON_SECRET}`
      ) {
        return next();
      }
    }
    const user = getSessionUserFromReq(req);
    if (!user) {
      return res.status(401).json({
        error: 'Authentication required. Please sign in with Google to use SigLens.',
        authRequired: true,
        loginUrl: '/api/auth/google',
      });
    }
    return next();
  });

  // Bounded in-memory rate limit guard for mutation/AI routes (prunes expired keys)
  const hits = new Map<string, { count: number; resetAt: number }>();
  const rateLimit = (maxPerMin: number): express.RequestHandler => (req, res, next) => {
    const now = Date.now();
    if (hits.size > 2000) {
      for (const [k, v] of hits.entries()) {
        if (now > v.resetAt) hits.delete(k);
      }
    }
    const key = `${req.ip}:${req.path}`;
    const cur = hits.get(key);
    if (!cur || now > cur.resetAt) {
      hits.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (cur.count >= maxPerMin) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
    }
    cur.count++;
    return next();
  };

  // --- Health & Diagnostics ---
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'SIGLENS',
      timestamp: Date.now(),
      providers: getProviderStatuses().map((p) => ({ id: p.id, status: p.status, wsConnected: p.wsConnected })),
    });
  });

  router.get('/providers', (_req, res) => {
    res.json({
      exchanges: ALL_EXCHANGES.map((id) => ({
        id,
        marketTypes: EXCHANGE_MARKET_TYPES[id],
        timeframes: EXCHANGE_TIMEFRAMES[id],
      })),
      statuses: getProviderStatuses(),
    });
  });

  router.get('/providers/status', (_req, res) => {
    res.json({ statuses: getProviderStatuses(), timestamp: Date.now() });
  });

  router.get('/diagnostics', (_req, res) => {
    res.json({
      providers: getProviderStatuses(),
      storage: getStorageStats(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
  });

  // --- Markets & Tickers ---
  const marketsQuerySchema = z.object({
    exchange: exchangeOrAllSchema.default('binance'),
    marketType: marketTypeOrAllSchema.default('spot'),
  });

  router.get('/markets', async (req, res) => {
    const parsed = marketsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid exchange or marketType parameter' });
    }
    try {
      const tickers = await getMarketTickers(parsed.data.exchange, parsed.data.marketType);
      res.json({ markets: tickers, count: tickers.length, timestamp: Date.now() });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load markets' });
    }
  });

  router.get('/tickers', async (req, res) => {
    const parsed = marketsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid exchange or marketType parameter' });
    }
    try {
      const tickers = await getMarketTickers(parsed.data.exchange, parsed.data.marketType);
      res.json({ tickers, count: tickers.length, timestamp: Date.now() });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch tickers' });
    }
  });

  router.get('/markets/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toUpperCase();
      const tickers = await getMarketTickers('all', 'all');
      const filtered = q
        ? tickers.filter(
            (t) =>
              t.displaySymbol.includes(q) ||
              t.baseAsset.includes(q) ||
              t.exchange.toUpperCase().includes(q) ||
              t.canonicalId.toUpperCase().includes(q) ||
              t.source.toUpperCase().includes(q),
          )
        : tickers.slice(0, 30);
      res.json({ results: filtered.slice(0, 40) });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  // --- Candles, Indicators, Signals, Patterns, Market Regime ---
  const assetQuerySchema = z.object({
    exchange: exchangeSchema.default('binance'),
    marketType: marketTypeSchema.default('spot'),
    symbol: z.string().min(3).default('BTC/USDT'),
    timeframe: timeframeSchema.default('15m'),
    limit: z.coerce.number().int().min(30).max(500).default(260),
  });

  router.get('/candles', async (req, res) => {
    const parsed = assetQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    const { exchange, marketType, symbol, timeframe, limit } = parsed.data;
    try {
      const data = await fetchCandles(exchange, marketType, symbol.toUpperCase(), timeframe, limit);
      res.json({
        canonicalId: `${exchange}:${marketType}:${symbol.toUpperCase()}`,
        exchange,
        marketType,
        symbol: symbol.toUpperCase(),
        timeframe,
        ...data,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Unable to fetch candles from provider' });
    }
  });

  async function computeAssetBundle(query: Record<string, unknown>) {
    const parsed = assetQuerySchema.parse(query);
    const sym = parsed.symbol.toUpperCase();
    const canonicalId = `${parsed.exchange}:${parsed.marketType}:${sym}`;
    const prefs = getStoredPreferences();
    const { candles, source, freshness } = await fetchCandles(
      parsed.exchange,
      parsed.marketType,
      sym,
      parsed.timeframe,
      parsed.limit,
    );

    // Fetch higher timeframe bias context if different from current
    let higherTimeframeBias = null;
    const htf: Timeframe | null =
      parsed.timeframe === '1m' || parsed.timeframe === '3m' || parsed.timeframe === '5m'
        ? '1h'
        : parsed.timeframe === '15m' || parsed.timeframe === '30m'
          ? '4h'
          : parsed.timeframe === '1h' || parsed.timeframe === '2h'
            ? '1d'
            : null;

    if (htf && EXCHANGE_TIMEFRAMES[parsed.exchange].includes(htf)) {
      try {
        const htfCandles = await fetchCandles(parsed.exchange, parsed.marketType, sym, htf, 120);
        const htfAnalysis = runFullAssetAnalysis(htfCandles.candles, {
          canonicalId,
          exchange: parsed.exchange,
          marketType: parsed.marketType,
          displaySymbol: sym,
          timeframe: htf,
          freshness: htfCandles.freshness,
          weights: prefs.weights,
          thresholds: prefs.thresholds,
        });
        higherTimeframeBias = htfAnalysis.confirmed.classification;
      } catch {
        // non-blocking
      }
    }

    const analysis = runFullAssetAnalysis(candles, {
      canonicalId,
      exchange: parsed.exchange,
      marketType: parsed.marketType,
      displaySymbol: sym,
      timeframe: parsed.timeframe,
      freshness,
      weights: prefs.weights,
      thresholds: prefs.thresholds,
      minCoveragePct: prefs.minCoveragePct,
      minAgreementForStrongPct: prefs.minAgreementForStrongPct,
      higherTimeframeBias,
    });

    return { candles, source, freshness, analysis, canonicalId, sym, parsed };
  }

  router.get('/signals/current', async (req, res) => {
    const check = assetQuerySchema.safeParse(req.query);
    if (!check.success) return res.status(400).json({ error: 'Invalid query parameters' });
    try {
      const bundle = await computeAssetBundle(check.data);
      res.json({
        canonicalId: bundle.canonicalId,
        source: bundle.source,
        freshness: bundle.freshness,
        candles: bundle.candles,
        ...bundle.analysis,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Signal calculation failed' });
    }
  });

  // --- Live Market Intelligence (Macro Calendar, News Catalysts, Social & Funding Sentiment) ---
  router.get('/intel/overview', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    try {
      const snapshot = await getMarketIntelligence(forceRefresh);
      res.json(snapshot);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Market intelligence fetch failed',
      });
    }
  });

  // --- 4-Pillar Multi-Factor Quant Alpha Signals ---
  const quantQuerySchema = z.object({
    exchange: exchangeSchema.default('binance'),
    marketType: marketTypeSchema.optional(),
    timeframe: timeframeSchema.default('15m'),
    refresh: z.string().optional(),
  });

  router.get('/signals/quant', async (req, res) => {
    const parsed = quantQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid quant signal parameters', details: parsed.error.issues });
    }
    const { exchange, timeframe, refresh } = parsed.data;
    const allowedMarkets = EXCHANGE_MARKET_TYPES[exchange];
    const marketType: MarketType =
      parsed.data.marketType && allowedMarkets.includes(parsed.data.marketType)
        ? parsed.data.marketType
        : defaultMarketTypeFor(exchange);

    const supportedTfs = EXCHANGE_TIMEFRAMES[exchange];
    const resolvedTf: Timeframe = supportedTfs.includes(timeframe)
      ? timeframe
      : supportedTfs.includes('15m')
        ? '15m'
        : supportedTfs[0];

    try {
      const payload = await runQuantSignalScan(
        exchange,
        marketType,
        resolvedTf,
        refresh === 'true' || refresh === '1',
      );
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Quant signal scan failed',
      });
    }
  });

  router.get('/indicators', async (req, res) => {
    const check = assetQuerySchema.safeParse(req.query);
    if (!check.success) return res.status(400).json({ error: 'Invalid query parameters' });
    try {
      const bundle = await computeAssetBundle(check.data);
      res.json({
        canonicalId: bundle.canonicalId,
        source: bundle.source,
        indicators: bundle.analysis.confirmed.indicators,
        series: bundle.analysis.series,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Indicator calculation failed' });
    }
  });

  router.get('/patterns', async (req, res) => {
    const check = assetQuerySchema.safeParse(req.query);
    if (!check.success) return res.status(400).json({ error: 'Invalid query parameters' });
    try {
      const bundle = await computeAssetBundle(check.data);
      res.json({
        canonicalId: bundle.canonicalId,
        patterns: bundle.analysis.patterns,
        supportResistance: bundle.analysis.supportResistance,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Pattern detection failed' });
    }
  });

  router.get('/market-regime', async (req, res) => {
    const check = assetQuerySchema.safeParse(req.query);
    if (!check.success) return res.status(400).json({ error: 'Invalid query parameters' });
    try {
      const bundle = await computeAssetBundle(check.data);
      res.json({ canonicalId: bundle.canonicalId, regime: bundle.analysis.confirmed.regime });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Regime classification failed' });
    }
  });

  router.get('/signals/explain', async (req, res) => {
    const check = assetQuerySchema.safeParse(req.query);
    if (!check.success) return res.status(400).json({ error: 'Invalid query parameters' });
    try {
      const bundle = await computeAssetBundle(check.data);
      const c = bundle.analysis.confirmed;
      res.json({
        canonicalId: bundle.canonicalId,
        classification: c.classification,
        directionalScore: c.directionalScore,
        marketCondition: c.marketCondition,
        supportingEvidence: c.supportingEvidence,
        contradictoryEvidence: c.contradictoryEvidence,
        invalidationConditions: c.invalidationConditions,
        safeguardNotes: c.safeguardNotes,
        metadata: c.metadata,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Explanation failed' });
    }
  });

  // Multi-Timeframe independent matrix
  router.get('/signals/mtf', async (req, res) => {
    const parsed = assetQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query parameters' });
    const { exchange, marketType, symbol } = parsed.data;
    const sym = symbol.toUpperCase();
    const canonicalId = `${exchange}:${marketType}:${sym}`;
    const prefs = getStoredPreferences();
    const supported = new Set(EXCHANGE_TIMEFRAMES[exchange]);

    const rows: MultiTimeframeRow[] = await Promise.all(
      MTF_TIMEFRAMES.map(async (tf) => {
        if (!supported.has(tf)) {
          return {
            timeframe: tf,
            classification: 'INSUFFICIENT_DATA',
            label: 'Unsupported TF',
            directionalScore: 0,
            trendStrength: 'Unavailable',
            bullishCount: 0,
            bearishCount: 0,
            totalActive: 0,
            agreementPct: 0,
            rsi: null,
            adx: null,
            regime: 'Unsupported',
            available: false,
            error: `${exchange} does not natively support ${tf}`,
          };
        }
        try {
          const { candles, freshness } = await fetchCandles(exchange, marketType, sym, tf, 210);
          const analysis = runFullAssetAnalysis(candles, {
            canonicalId,
            exchange,
            marketType,
            displaySymbol: sym,
            timeframe: tf,
            freshness,
            weights: prefs.weights,
            thresholds: prefs.thresholds,
          });
          const c = analysis.confirmed;
          const rsiVal = (c.indicators.find((i) => i.id === 'rsi')?.rawValues.rsi14 as number | null) ?? null;
          const adxVal = (c.indicators.find((i) => i.id === 'adx')?.rawValues.adx14 as number | null) ?? null;
          return {
            timeframe: tf,
            classification: c.classification,
            label: c.label,
            directionalScore: c.directionalScore,
            trendStrength:
              adxVal === null ? 'Unavailable' : adxVal >= 28 ? 'Strong' : adxVal >= 20 ? 'Moderate' : 'Weak',
            bullishCount: c.agreement.bullishCount,
            bearishCount: c.agreement.bearishCount,
            totalActive: c.agreement.totalDirectional - c.agreement.unavailableCount,
            agreementPct: c.agreement.agreementPct,
            rsi: rsiVal,
            adx: adxVal,
            regime: c.regime.trendRegime,
            available: c.classification !== 'INSUFFICIENT_DATA',
          };
        } catch (err) {
          return {
            timeframe: tf,
            classification: 'INSUFFICIENT_DATA',
            label: 'Unavailable',
            directionalScore: 0,
            trendStrength: 'Unavailable',
            bullishCount: 0,
            bearishCount: 0,
            totalActive: 0,
            agreementPct: 0,
            rsi: null,
            adx: null,
            regime: 'Unavailable',
            available: false,
            error: err instanceof Error ? err.message : 'Fetch error',
          };
        }
      }),
    );

    const validRows = rows.filter((r) => r.available);
    const bullRows = validRows.filter((r) => r.classification.includes('BULLISH'));
    const bearRows = validRows.filter((r) => r.classification.includes('BEARISH'));
    const dominant = Math.max(bullRows.length, bearRows.length);
    const consistencyScore = validRows.length > 0 ? Math.round((dominant / validRows.length) * 100) : 0;

    const shortTf = rows.find((r) => r.timeframe === '15m');
    const highTf = rows.find((r) => r.timeframe === '4h') ?? rows.find((r) => r.timeframe === '1d');
    const conflictWarnings: string[] = [];
    if (
      shortTf?.available &&
      highTf?.available &&
      ((shortTf.classification.includes('BULLISH') && highTf.classification.includes('BEARISH')) ||
        (shortTf.classification.includes('BEARISH') && highTf.classification.includes('BULLISH')))
    ) {
      conflictWarnings.push(
        `Short-term ${shortTf.timeframe} (${shortTf.label}) conflicts with higher-timeframe ${highTf.timeframe} (${highTf.label}).`,
      );
    }

    const summary: MultiTimeframeSummary = {
      rows,
      alignmentSummary:
        bullRows.length > bearRows.length && consistencyScore >= 60
          ? `Bullish multi-timeframe alignment (${bullRows.length}/${validRows.length} timeframes bullish).`
          : bearRows.length > bullRows.length && consistencyScore >= 60
            ? `Bearish multi-timeframe alignment (${bearRows.length}/${validRows.length} timeframes bearish).`
            : `Mixed multi-timeframe structure (${bullRows.length} bullish, ${bearRows.length} bearish, ${validRows.length - bullRows.length - bearRows.length} neutral).`,
      conflictWarnings,
      consistencyScore,
      higherTimeframeContext: highTf?.available
        ? `${highTf.timeframe} trend is ${highTf.label} (${highTf.regime}, score ${highTf.directionalScore}).`
        : 'Higher-timeframe context unavailable.',
    };

    res.json(summary);
  });

  // --- Signal Feed & History ---
  router.get('/signals/feed', (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 250);
    const events = listSignalEvents(limit);
    res.json({ events, count: events.length, timestamp: Date.now() });
  });

  router.get('/signals/history', (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 250);
    const canonicalId = req.query.canonicalId ? String(req.query.canonicalId) : null;
    const all = listSignalEvents(limit);
    const filtered = canonicalId ? all.filter((e) => e.canonicalId === canonicalId) : all;
    res.json({ history: filtered, count: filtered.length });
  });

  // --- Order Book ---
  router.get('/orderbook', async (req, res) => {
    const parsed = assetQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query parameters' });
    const { exchange, marketType, symbol } = parsed.data;
    try {
      const book = await fetchOrderBook(exchange, marketType, symbol.toUpperCase(), 25);
      res.json(book);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Order book unavailable' });
    }
  });

  // --- Screener & Presets ---
  const screenerQuerySchema = z.object({
    exchange: exchangeSchema.default('binance'),
    marketType: marketTypeSchema.optional(),
    timeframe: timeframeSchema.default('1h'),
    refresh: z.string().optional(),
    presetId: z.string().optional(),
  });

  router.get('/screener', async (req, res) => {
    const parsed = screenerQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid screener query parameters' });
    try {
      const exchange = parsed.data.exchange;
      const marketType = parsed.data.marketType ?? defaultMarketTypeFor(exchange);
      const timeframe = parsed.data.timeframe;
      const force = parsed.data.refresh === 'true';
      const scan = await runScreenerScan(exchange, marketType, timeframe, force);
      const presetId = parsed.data.presetId;
      const rows = presetId ? filterScreenerRows(scan.rows, { presetId }) : scan.rows;
      res.json({
        rows,
        totalScanned: scan.rows.length,
        universeSize: scan.universeSize,
        completedCount: scan.completedCount,
        inProgress: scan.inProgress,
        scannedAt: scan.scannedAt,
        exchange,
        marketType,
        timeframe,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Screener scan failed' });
    }
  });

  router.get('/screener/presets', (_req, res) => {
    res.json({ presets: [...BUILT_IN_SCREENER_PRESETS, ...listCustomPresets()] });
  });

  router.post('/screener/presets', rateLimit(30), (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(60),
      description: z.string().max(240).default('Custom user filter preset'),
      category: z.string().max(40).default('Custom'),
      filters: z.record(z.string(), z.unknown()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid preset payload' });
    const saved = saveCustomPreset({
      id: `custom-${Date.now()}`,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      filters: parsed.data.filters,
    });
    res.status(201).json({ preset: saved });
  });

  router.delete('/screener/presets/:id', (req, res) => {
    deleteCustomPreset(req.params.id);
    res.json({ ok: true });
  });

  // --- Market Overview & Market Breadth ---
  router.get('/market-breadth', async (req, res) => {
    const parsed = z
      .object({
        exchange: exchangeSchema.default('binance'),
        timeframe: timeframeSchema.default('1h'),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid market breadth query parameters' });
    try {
      const { exchange, timeframe } = parsed.data;
      const scan = await runScreenerScan(exchange, defaultMarketTypeFor(exchange), timeframe, false);
      const breadth = computeMarketBreadth(scan.rows);
      res.json({
        ...breadth,
        universeNote: `Calculated across top ${scan.rows.length} liquid instruments on ${exchange} (${timeframe}).`,
        scannedAt: scan.scannedAt,
        rows: scan.rows,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Market breadth unavailable' });
    }
  });

  router.get('/market-overview', async (req, res) => {
    const parsed = z
      .object({
        exchange: exchangeSchema.default('binance'),
        marketType: marketTypeSchema.optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid market overview query parameters' });
    try {
      const exchange = parsed.data.exchange;
      const marketType = parsed.data.marketType ?? defaultMarketTypeFor(exchange);
      const [tickers, fng, scan] = await Promise.all([
        getMarketTickers(exchange, marketType),
        fetchFearAndGreed(),
        runScreenerScan(exchange, marketType, '1h', false),
      ]);

      const usdtTickers =
        exchange === 'stocks' || exchange === 'cfds'
          ? tickers
          : tickers.filter((t) => t.quoteAsset === 'USDT' || t.quoteAsset === 'USD');
      const totalVol = usdtTickers.reduce((s, t) => s + t.quoteVolume24h, 0);
      const primaryBase = exchange === 'stocks' ? 'NVDA' : exchange === 'cfds' ? 'US500' : 'BTC';
      const secondaryBase = exchange === 'stocks' ? 'AAPL' : exchange === 'cfds' ? 'XAU' : 'ETH';
      const btcTicker = usdtTickers.find((t) => t.baseAsset === primaryBase) ?? usdtTickers[0];
      const ethTicker = usdtTickers.find((t) => t.baseAsset === secondaryBase) ?? usdtTickers[1];

      const breadth = computeMarketBreadth(scan.rows);
      const btcRow = scan.rows.find((r) => r.baseAsset === primaryBase) ?? scan.rows[0];
      const ethRow = scan.rows.find((r) => r.baseAsset === secondaryBase) ?? scan.rows[1];

      const avgRvol =
        scan.rows.length > 0
          ? scan.rows.reduce((s, r) => s + (r.rvol20 ?? 1), 0) / scan.rows.length
          : 1;
      const avgAtr =
        scan.rows.length > 0
          ? scan.rows.reduce((s, r) => s + (r.atrPct ?? 1), 0) / scan.rows.length
          : 1;

      // Leader sparklines from real 1h candles (last 24 bars)
      const leaderBases =
        exchange === 'stocks'
          ? ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META']
          : exchange === 'cfds'
            ? ['US500', 'NAS100', 'XAU', 'WTI', 'EUR', 'GBP']
            : ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
      const leaders = (
        await Promise.all(
          leaderBases.map(async (base) => {
            const ticker = usdtTickers.find((t) => t.baseAsset === base);
            if (!ticker) return null;
            const row = scan.rows.find((r) => r.baseAsset === base);
            let sparkline: number[] = [];
            try {
              const c = await fetchCandles(ticker.exchange, ticker.marketType, ticker.displaySymbol, '1h', 30);
              sparkline = c.candles.slice(-24).map((x) => x.close);
            } catch {
              sparkline = [ticker.low24h, ticker.lastPrice];
            }
            return {
              ticker,
              sparkline,
              signal: row?.classification ?? 'NEUTRAL',
              score: row?.directionalScore ?? 0,
            };
          }),
        )
      ).filter((x): x is NonNullable<typeof x> => x !== null);

      const payload: MarketOverviewPayload = {
        fearAndGreed: fng,
        exchangeCoverageNote: `Exchange-scoped aggregates computed from ${usdtTickers.length} liquid ${exchange.toUpperCase()} ${marketType} markets; technical breadth covers top ${scan.rows.length} pairs on 1h.`,
        aggregateStats: {
          trackedAssets: usdtTickers.length,
          analyzedAssets: scan.rows.length,
          bullishCount: breadth.bullishCount,
          bearishCount: breadth.bearishCount,
          neutralCount: breadth.neutralCount,
          breadthScore: breadth.breadthScore,
          exchangeVolume24hUsd: totalVol,
          btcDominanceProxy: btcTicker && totalVol > 0 ? Number(((btcTicker.quoteVolume24h / totalVol) * 100).toFixed(1)) : null,
          ethDominanceProxy: ethTicker && totalVol > 0 ? Number(((ethTicker.quoteVolume24h / totalVol) * 100).toFixed(1)) : null,
          aboveEma50Pct: breadth.aboveEma50Pct,
          aboveEma200Pct: breadth.aboveEma200Pct,
        },
        marketPulse: {
          overallBias:
            breadth.breadthScore >= 25
              ? 'Bullish Breadth'
              : breadth.breadthScore <= -25
                ? 'Bearish Breadth'
                : 'Mixed / Rotational',
          btcTrend: btcRow ? `${signalLabel(btcRow.classification)} (${btcRow.regime})` : 'Loading',
          ethTrend: ethRow ? `${signalLabel(ethRow.classification)} (${ethRow.regime})` : 'Loading',
          volumeCondition:
            avgRvol >= 1.3 ? `Elevated (${avgRvol.toFixed(2)}x avg RVOL)` : avgRvol <= 0.8 ? `Subdued (${avgRvol.toFixed(2)}x avg RVOL)` : `Normal (${avgRvol.toFixed(2)}x avg RVOL)`,
          volatilityRegime:
            avgAtr >= 2.2 ? `Elevated (Avg 1h ATR ${avgAtr.toFixed(2)}%)` : avgAtr <= 0.8 ? `Compressed (Avg 1h ATR ${avgAtr.toFixed(2)}%)` : `Moderate (Avg 1h ATR ${avgAtr.toFixed(2)}%)`,
          sentiment: fng ? `${fng.value} — ${fng.classification}` : 'Unavailable',
          freshness: 'LIVE',
        },
        topGainers: [...usdtTickers].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 8),
        topLosers: [...usdtTickers].sort((a, b) => a.change24hPct - b.change24hPct).slice(0, 8),
        highestVolume: [...usdtTickers].sort((a, b) => b.quoteVolume24h - a.quoteVolume24h).slice(0, 8),
        unusualVolume: [...scan.rows].sort((a, b) => (b.rvol20 ?? 0) - (a.rvol20 ?? 0)).slice(0, 8),
        strongestMomentum: [...scan.rows].sort((a, b) => b.directionalScore - a.directionalScore).slice(0, 8),
        strongestDowntrend: [...scan.rows].sort((a, b) => a.directionalScore - b.directionalScore).slice(0, 8),
        leaders,
        recentSignals: listSignalEvents(15),
        updatedAt: Date.now(),
      };

      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Overview load failed' });
    }
  });

  // --- Correlation & Multi-Asset Comparison ---
  router.get('/correlation', async (req, res) => {
    const parsed = z
      .object({
        symbols: z.string().optional(),
        exchange: exchangeSchema.default('binance'),
        timeframe: timeframeSchema.default('1h'),
        lookback: z.coerce.number().int().min(20).max(180).default(60),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid correlation query parameters' });
    try {
      const symbolsParam =
        parsed.data.symbols ||
        'BTC/USDT,ETH/USDT,SOL/USDT,XRP/USDT,BNB/USDT,LINK/USDT,AVAX/USDT,DOGE/USDT';
      const { exchange, timeframe, lookback } = parsed.data;
      const symbols = symbolsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 10);

      const fetched = await Promise.all(
        symbols.map(async (symbol) => {
          const c = await fetchCandles(exchange, defaultMarketTypeFor(exchange), symbol, timeframe, lookback + 20);
          return { symbol, candles: c.candles };
        }),
      );

      const corr = buildCorrelationMatrix(fetched, lookback);
      res.json({ ...corr, exchange, timeframe, lookback, updatedAt: Date.now() });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Correlation calculation failed' });
    }
  });

  router.get('/compare', async (req, res) => {
    const parsed = z
      .object({
        symbols: z.string().optional(),
        exchange: exchangeSchema.default('binance'),
        marketType: marketTypeSchema.optional(),
        timeframe: timeframeSchema.default('1h'),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid comparison query parameters' });
    try {
      const symbolsParam = parsed.data.symbols || 'BTC/USDT,ETH/USDT,SOL/USDT';
      const exchange = parsed.data.exchange;
      const marketType = parsed.data.marketType ?? defaultMarketTypeFor(exchange);
      const timeframe = parsed.data.timeframe;
      const symbols = symbolsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 5);
      const prefs = getStoredPreferences();

      const assetBundles = await Promise.all(
        symbols.map(async (symbol) => {
          const { candles, freshness } = await fetchCandles(exchange, marketType, symbol, timeframe, 210);
          const canonicalId = `${exchange}:${marketType}:${symbol}`;
          const analysis = runFullAssetAnalysis(candles, {
            canonicalId,
            exchange,
            marketType,
            displaySymbol: symbol,
            timeframe,
            freshness,
            weights: prefs.weights,
            thresholds: prefs.thresholds,
          });
          return { symbol, canonicalId, candles, analysis };
        }),
      );

      const normalized = buildNormalizedPerformance(
        assetBundles.map((b) => ({ symbol: b.symbol, candles: b.candles })),
        100,
      );
      const correlation = buildCorrelationMatrix(
        assetBundles.map((b) => ({ symbol: b.symbol, candles: b.candles })),
        60,
      );

      res.json({
        exchange,
        marketType,
        timeframe,
        normalized,
        correlation,
        assets: assetBundles.map((b) => ({
          symbol: b.symbol,
          canonicalId: b.canonicalId,
          close: b.candles[b.candles.length - 1]?.close ?? null,
          periodReturnPct:
            normalized.series[b.symbol]?.length > 0
              ? normalized.series[b.symbol][normalized.series[b.symbol].length - 1]
              : null,
          confirmed: b.analysis.confirmed,
          supportResistance: b.analysis.supportResistance,
        })),
        updatedAt: Date.now(),
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Comparison failed' });
    }
  });

  // --- Derivatives (Bybit V5 Public) ---
  router.get('/derivatives', async (_req, res) => {
    try {
      const data = await fetchDerivativesOverview();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Derivatives data unavailable' });
    }
  });

  router.get('/derivatives/:base', async (req, res) => {
    try {
      const detail = await fetchDerivativesDetail(req.params.base);
      res.json(detail);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Derivatives detail unavailable' });
    }
  });

  // --- DeFi Intelligence (DefiLlama Free Public API) ---
  router.get('/defi', async (_req, res) => {
    try {
      const data = await fetchDefiOverview();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'DefiLlama API unavailable' });
    }
  });

  // --- Watchlists (automatically scoped per Google OAuth user when signed in) ---
  router.get('/watchlists', (req, res) => {
    const user = getSessionUserFromReq(req);
    res.json({ items: getWatchlist(user?.id) });
  });

  router.put('/watchlists', rateLimit(60), (req, res) => {
    const schema = z.object({ items: z.array(z.string().min(5)).max(100) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid watchlist array' });
    const user = getSessionUserFromReq(req);
    const saved = saveWatchlist(parsed.data.items, user?.id);
    res.json({ items: saved });
  });

  // --- Alerts ---
  router.get('/alerts', (_req, res) => {
    res.json({ rules: listAlertRules(), events: listAlertEvents(50) });
  });

  router.post('/alerts', rateLimit(30), (req, res) => {
    const schema = z.object({
      canonicalId: z.string().min(5),
      timeframe: timeframeSchema.default('1h'),
      condition: z.string().min(3),
      threshold: z.number().nullable().optional(),
      cooldownMinutes: z.number().int().min(1).max(1440).default(15),
      recurring: z.boolean().default(true),
      webhookUrl: z.string().url().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid alert rule payload' });

    if (parsed.data.webhookUrl) {
      try {
        assertSafeExternalUrlSync(parsed.data.webhookUrl, { allowHttpLocalhost: false });
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid or unsafe webhook URL',
        });
      }
    }

    const meta = parseCanonicalId(parsed.data.canonicalId);
    const rule: AlertRule = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      canonicalId: parsed.data.canonicalId,
      displaySymbol: meta.displaySymbol,
      exchange: meta.exchange,
      marketType: meta.marketType,
      timeframe: parsed.data.timeframe,
      condition: parsed.data.condition as AlertRule['condition'],
      threshold: parsed.data.threshold ?? null,
      enabled: true,
      cooldownMinutes: parsed.data.cooldownMinutes,
      recurring: parsed.data.recurring,
      webhookUrl: parsed.data.webhookUrl ?? null,
      lastTriggeredAt: null,
      createdAt: Date.now(),
    };
    upsertAlertRule(rule);
    res.status(201).json({ rule });
  });

  router.patch('/alerts/:id', rateLimit(30), (req, res) => {
    const patchSchema = z
      .object({
        enabled: z.boolean().optional(),
        threshold: z.number().finite().nullable().optional(),
        cooldownMinutes: z.number().int().min(1).max(1440).optional(),
        webhookUrl: z.string().url().nullable().optional(),
      })
      .strict();
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid alert update payload' });
    if (parsed.data.webhookUrl) {
      try {
        assertSafeExternalUrlSync(parsed.data.webhookUrl, { allowHttpLocalhost: false });
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid or unsafe webhook URL',
        });
      }
    }
    const rules = listAlertRules();
    const existing = rules.find((r) => r.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Alert not found' });
    const updated: AlertRule = {
      ...existing,
      enabled: parsed.data.enabled ?? existing.enabled,
      threshold: parsed.data.threshold !== undefined ? parsed.data.threshold : existing.threshold,
      cooldownMinutes: parsed.data.cooldownMinutes ?? existing.cooldownMinutes,
      webhookUrl: parsed.data.webhookUrl !== undefined ? parsed.data.webhookUrl : existing.webhookUrl,
    };
    upsertAlertRule(updated);
    res.json({ rule: updated });
  });

  router.delete('/alerts/:id', (req, res) => {
    deleteAlertRule(req.params.id);
    res.json({ ok: true });
  });

  // --- Settings & Data Management (scoped per Google OAuth user when signed in) ---
  router.get('/settings', (req, res) => {
    const user = getSessionUserFromReq(req);
    res.json({ preferences: getStoredPreferences(user?.id) });
  });

  router.put('/settings', rateLimit(60), (req, res) => {
    const parsed = preferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid preferences payload' });
    }
    const user = getSessionUserFromReq(req);
    const current = getStoredPreferences(user?.id);
    const next = {
      ...current,
      ...parsed.data,
      weights: { ...current.weights, ...(parsed.data.weights ?? {}) },
      thresholds: { ...current.thresholds, ...(parsed.data.thresholds ?? {}) },
    };
    saveStoredPreferences(next, user?.id);
    res.json({ preferences: next });
  });

  router.post('/cache/clear', (_req, res) => {
    clearMemoryCache();
    clearCandlesCache();
    res.json({ ok: true, clearedAt: Date.now() });
  });

  // --- AI Provider Profiles (Metadata only; keys stay in client session / WebCrypto encrypted storage) ---
  router.get('/ai/profiles', (_req, res) => {
    res.json({ profiles: listAIProfiles() });
  });

  router.post('/ai/profiles', rateLimit(30), (req, res) => {
    const schema = z.object({
      id: z.string().optional(),
      name: z.string().min(1).max(80),
      providerType: z.enum(['openai', 'openai_compatible', 'anthropic', 'gemini', 'groq', 'ollama']),
      model: z.string().min(1).max(120),
      baseUrl: z.string().max(300).default(''),
      temperature: z.number().min(0).max(1.5).default(0.2),
      maxTokens: z.number().int().min(128).max(8192).default(1024),
      timeoutMs: z.number().int().min(3000).max(60000).default(25000),
      enabled: z.boolean().default(true),
      storageMode: z.enum(['session', 'encrypted_local']).default('session'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid AI profile configuration' });
    const saved = saveAIProfile({
      ...parsed.data,
      id: parsed.data.id || `ai-${Date.now()}`,
    });
    res.status(201).json({ profile: saved });
  });

  router.delete('/ai/profiles/:id', (req, res) => {
    deleteAIProfile(req.params.id);
    res.json({ ok: true });
  });

  router.post('/ai/test', rateLimit(15), async (req, res) => {
    const schema = z.object({
      providerType: z.enum(['openai', 'openai_compatible', 'anthropic', 'gemini', 'groq', 'ollama']),
      model: z.string().min(1),
      baseUrl: z.string().default(''),
      apiKey: z.string().optional(),
      timeoutMs: z.number().int().default(15000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid connection test payload' });
    try {
      const result = await invokeAIProvider({
        ...parsed.data,
        temperature: 0,
        maxTokens: 32,
        systemPrompt: 'Respond with exactly: CONNECTION_OK',
        userPrompt: 'Ping',
      });
      res.json({ ok: true, modelUsed: result.modelUsed, sample: result.text.slice(0, 60) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  });

  router.post('/ai/analyze', rateLimit(20), async (req, res) => {
    const schema = z.object({
      prompt: z.string().min(2).max(2000),
      mode: z.enum(['explain', 'nl_screen']).default('explain'),
      canonicalId: z.string().default('binance:spot:BTC/USDT'),
      timeframe: timeframeSchema.default('15m'),
      provider: z.object({
        providerType: z.enum(['openai', 'openai_compatible', 'anthropic', 'gemini', 'groq', 'ollama']),
        model: z.string().min(1),
        baseUrl: z.string().default(''),
        apiKey: z.string().optional(),
        temperature: z.number().min(0).max(1.5).default(0.2),
        maxTokens: z.number().int().min(128).max(4096).default(1024),
        timeoutMs: z.number().int().default(25000),
      }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid AI analysis request' });

    try {
      const { prompt, mode, canonicalId, timeframe, provider } = parsed.data;
      let contextPayload: Record<string, unknown> = {};
      let screenerResults = null;

      if (mode === 'nl_screen') {
        const nl = parseNaturalLanguageToScreenerFilters(prompt);
        const scan = await runScreenerScan('binance', 'spot', timeframe, false);
        const matched = filterScreenerRows(scan.rows, nl.filters);
        screenerResults = {
          interpretedRules: nl.interpretedRules,
          filters: nl.filters,
          matchedCount: matched.length,
          scannedUniverse: scan.rows.length,
          matches: matched.slice(0, 15),
        };
        contextPayload = screenerResults;
      } else {
        const meta = parseCanonicalId(canonicalId);
        const bundle = await computeAssetBundle({
          exchange: meta.exchange,
          marketType: meta.marketType,
          symbol: meta.displaySymbol,
          timeframe,
          limit: 220,
        });
        contextPayload = {
          canonicalId,
          timeframe,
          source: bundle.source,
          confirmedSignal: {
            classification: bundle.analysis.confirmed.classification,
            directionalScore: bundle.analysis.confirmed.directionalScore,
            agreement: bundle.analysis.confirmed.agreement,
            regime: bundle.analysis.confirmed.regime,
            marketCondition: bundle.analysis.confirmed.marketCondition,
            supportingEvidence: bundle.analysis.confirmed.supportingEvidence,
            contradictoryEvidence: bundle.analysis.confirmed.contradictoryEvidence,
            invalidationConditions: bundle.analysis.confirmed.invalidationConditions,
            indicators: bundle.analysis.confirmed.indicators.map((i) => ({
              name: i.name,
              bias: i.bias,
              evidence: Number(i.evidence.toFixed(2)),
              rawValues: i.rawValues,
            })),
            calculatedAt: bundle.analysis.confirmed.metadata.calculatedAt,
          },
          patterns: bundle.analysis.patterns.slice(0, 5),
          supportResistance: bundle.analysis.supportResistance,
        };
      }

      const systemPrompt = [
        'You are the CRYPTOLENS Quantitative Research Explainer.',
        'STRICT RULES:',
        '1. Deterministic engine calculates; you ONLY explain the provided verified JSON context.',
        '2. NEVER invent prices, indicator values, win rates, or trading instructions.',
        '3. NEVER overwrite or contradict the deterministic signal classification.',
        '4. Explicitly separate measured facts from analytical interpretation and mention contradictory evidence.',
        '5. Always cite the pair, exchange, timeframe, and analysis timestamp.',
        '6. This is strictly an analytics platform — never provide buy/sell order execution instructions.',
      ].join('\n');

      const userPrompt = `User question: ${prompt}\n\nVerified Deterministic Analytics Context (JSON):\n${JSON.stringify(contextPayload, null, 2)}`;

      const aiRes = await invokeAIProvider({
        ...provider,
        systemPrompt,
        userPrompt,
      });

      res.json({
        response: aiRes.text,
        modelUsed: aiRes.modelUsed,
        contextUsed: contextPayload,
        screenerResults,
        timestamp: Date.now(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'AI analysis failed' });
    }
  });

  // --- Autonomous Paper-Trading Bot & Strategy Arena ---
  router.get('/paper/state', async (req, res) => {
    try {
      const refresh = req.query.refresh !== 'false';
      const snapshot = await buildPaperArenaSnapshot(refresh);
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load paper arena state' });
    }
  });

  router.put('/paper/account', rateLimit(30), (req, res) => {
    const schema = z.object({
      maxRiskPerTradePct: z.number().min(0.25).max(10).optional(),
      maxOpenPositions: z.number().int().min(1).max(20).optional(),
      maxDailyDrawdownPct: z.number().min(1).max(50).optional(),
      defaultLeverage: z.number().min(1).max(10).optional(),
      feeBps: z.number().min(0).max(50).optional(),
      slippageBps: z.number().min(0).max(50).optional(),
      killSwitchTriggered: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid account config' });
    const account = updatePaperAccountConfig(parsed.data);
    res.json({ account });
  });

  router.post('/paper/bots', rateLimit(30), (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(60),
      description: z.string().max(240).optional(),
      exchange: exchangeSchema,
      marketType: marketTypeSchema.optional(),
      timeframe: timeframeSchema,
      enabled: z.boolean().optional(),
      directionMode: z.enum(['BOTH', 'LONG_ONLY', 'SHORT_ONLY']).optional(),
      minScore: z.number().min(20).max(90).optional(),
      minAgreementPct: z.number().min(40).max(95).optional(),
      riskPerTradePct: z.number().min(0.25).max(10).optional(),
      leverage: z.number().min(1).max(10).optional(),
      trailingStopAtrMult: z.number().min(0.5).max(5).nullable().optional(),
      partialTp1Pct: z.number().min(0).max(80).optional(),
      cooldownMinutes: z.number().int().min(5).max(1440).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid strategy bot payload' });
    const bot = createPaperBot(parsed.data);
    res.status(201).json({ bot });
  });

  router.patch('/paper/bots/:id', rateLimit(40), (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(60).optional(),
      enabled: z.boolean().optional(),
      directionMode: z.enum(['BOTH', 'LONG_ONLY', 'SHORT_ONLY']).optional(),
      minScore: z.number().min(20).max(90).optional(),
      minAgreementPct: z.number().min(40).max(95).optional(),
      riskPerTradePct: z.number().min(0.25).max(10).optional(),
      leverage: z.number().min(1).max(10).optional(),
      trailingStopAtrMult: z.number().min(0.5).max(5).nullable().optional(),
      partialTp1Pct: z.number().min(0).max(80).optional(),
      cooldownMinutes: z.number().int().min(5).max(1440).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid bot update payload' });
    const bot = updatePaperBot(req.params.id, parsed.data);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json({ bot });
  });

  router.delete('/paper/bots/:id', rateLimit(30), (req, res) => {
    deletePaperBot(req.params.id);
    res.json({ ok: true });
  });

  router.post('/paper/tick', rateLimit(20), async (req, res) => {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret && !req.headers.origin) {
      const provided = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
      if (provided !== cronSecret) {
        return res.status(401).json({ error: 'Missing or invalid X-Cron-Secret header.' });
      }
    }
    try {
      const result = await runAutonomousPaperCycle(true);
      const snapshot = await buildPaperArenaSnapshot(false);
      res.json({ result, snapshot });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Autonomous cycle failed' });
    }
  });

  router.post('/paper/order', rateLimit(40), async (req, res) => {
    const schema = z.object({
      exchange: exchangeSchema,
      marketType: marketTypeSchema.optional(),
      symbol: z.string().min(3).max(24),
      timeframe: timeframeSchema.optional(),
      side: z.enum(['LONG', 'SHORT']),
      riskPct: z.number().min(0.25).max(10).optional(),
      notionalUsd: z.number().min(10).max(5_000_000).optional(),
      leverage: z.number().min(1).max(50).optional(),
      stopLoss: z.number().positive().nullable().optional(),
      tp1: z.number().positive().nullable().optional(),
      tp2: z.number().positive().nullable().optional(),
      tp3: z.number().positive().nullable().optional(),
      skipAutoSlTp: z.boolean().optional(),
      entryReason: z.string().max(240).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid paper order payload' });
    try {
      const position = await openPaperOrder(parsed.data);
      const snapshot = await buildPaperArenaSnapshot(false);
      res.status(201).json({ position, snapshot });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to open paper order' });
    }
  });

  router.patch('/paper/positions/:id/tpsl', rateLimit(40), async (req, res) => {
    const schema = z.object({
      stopLoss: z.number().positive().nullable().optional(),
      tp1: z.number().positive().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid TP/SL payload' });
    try {
      const position = updatePaperPositionTpSl(req.params.id, parsed.data);
      const snapshot = await buildPaperArenaSnapshot(false);
      res.json({ position, snapshot });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update TP/SL' });
    }
  });

  router.post('/paper/positions/:id/close', rateLimit(40), async (req, res) => {
    try {
      const position = await closePaperPosition(req.params.id, 'MANUAL_CLOSE');
      const snapshot = await buildPaperArenaSnapshot(false);
      res.json({ position, snapshot });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to close position' });
    }
  });

  router.post('/paper/emergency-stop', rateLimit(15), async (_req, res) => {
    try {
      const summary = await emergencyStopAndFlatten();
      const snapshot = await buildPaperArenaSnapshot(false);
      res.json({ summary, snapshot });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Emergency stop failed' });
    }
  });

  router.post('/paper/topup', rateLimit(15), async (req, res) => {
    const schema = z.object({ amountUsd: z.number().min(100).max(1_000_000).default(10000) });
    const parsed = schema.safeParse(req.body ?? {});
    const amt = parsed.success ? parsed.data.amountUsd : 10000;
    topUpPaperFunds(amt);
    const snapshot = await buildPaperArenaSnapshot(false);
    res.json({ snapshot });
  });

  router.post('/paper/reset', rateLimit(10), async (req, res) => {
    const schema = z.object({ startingBalanceUsd: z.number().min(100).max(10_000_000).default(10000) });
    const parsed = schema.safeParse(req.body ?? {});
    const bal = parsed.success ? parsed.data.startingBalanceUsd : 10000;
    resetPaperAccount(bal);
    const snapshot = await buildPaperArenaSnapshot(false);
    res.json({ snapshot });
  });

  // --- Real-Time Arbitrage Scanner (Cross-Exchange Spot + Multi-Asset Stat-Arb Z-Score) ---
  router.get('/arbitrage', async (req, res) => {
    const parsed = z
      .object({
        feeBps: z.coerce.number().min(0).max(200).default(20),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid feeBps parameter (expected 0 to 200)' });
    }
    try {
      const payload = await scanLiveArbitrage(parsed.data.feeBps);
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Live arbitrage scan failed',
      });
    }
  });

  // --- Google OAuth 2.0 Authentication ---
  router.get('/auth/me', (req, res) => {
    res.json(buildAuthStateResponse(req));
  });

  router.get('/auth/google', (req, res) => {
    if (!isGoogleOAuthConfigured()) {
      if (req.query.format === 'json') {
        return res.status(503).json({
          error: 'Google OAuth is not configured on the server.',
          callbackUrl: getGoogleCallbackUrl(req),
          requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
        });
      }
      return res.redirect('/?auth_error=google_not_configured');
    }
    const state = createOAuthState();
    res.setHeader(
      'Set-Cookie',
      serializeCookie(STATE_COOKIE, state, {
        maxAgeSeconds: 600,
        httpOnly: true,
        secure: isSecureRequest(req),
        sameSite: 'Lax',
      }),
    );
    return res.redirect(buildGoogleAuthUrl(req, state));
  });

  router.get('/auth/google/callback', async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const error = String(req.query.error || '');

    if (error) {
      return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
    }

    const cookies = parseCookies(req);
    const expectedState = cookies[STATE_COOKIE];
    if (!code || !state || !expectedState || state !== expectedState) {
      return res.redirect('/?auth_error=invalid_state');
    }

    try {
      const redirectUri = getGoogleCallbackUrl(req);
      const { sessionToken } = await exchangeGoogleCodeAndCreateSession(code, redirectUri);
      const secure = isSecureRequest(req);
      res.setHeader('Set-Cookie', [
        serializeCookie(STATE_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true, secure, sameSite: 'Lax' }),
        serializeCookie(SESSION_COOKIE, sessionToken, {
          maxAgeSeconds: 14 * 24 * 60 * 60,
          httpOnly: true,
          secure,
          sameSite: 'Lax',
        }),
      ]);
      return res.redirect('/app');
    } catch (err) {
      console.error('[SIGLENS AUTH] Google callback failed:', err);
      return res.redirect('/?auth_error=oauth_exchange_failed');
    }
  });

  router.post('/auth/logout', (req, res) => {
    deleteSessionFromReq(req);
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, '', {
        maxAgeSeconds: 0,
        httpOnly: true,
        secure: isSecureRequest(req),
        sameSite: 'Lax',
      }),
    );
    res.json({ ok: true });
  });

  // Catch-all JSON 404 for unknown /api/* paths so SPA fallback never returns 200 HTML for missing API routes
  router.use((_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  return router;
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Production security headers middleware (OWASP ASVS aligned)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (isSecureRequest(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const isLandingPage = req.path === '/' || req.path === '/landing.html';
    res.setHeader(
      'Content-Security-Policy',
      isLandingPage
        ? [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            "img-src 'self' data: https://images.pexels.com https://cdn.jsdelivr.net https://lh3.googleusercontent.com",
            "connect-src 'self' https://api.coingecko.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self' https://accounts.google.com",
          ].join('; ')
        : [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            "img-src 'self' data: https://lh3.googleusercontent.com",
            "connect-src 'self' ws: wss:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self' https://accounts.google.com",
          ].join('; '),
    );
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Return clean JSON 400 on malformed JSON bodies instead of HTML stack traces
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 400) {
      return res.status(400).json({ error: 'Malformed JSON request body' });
    }
    return next(err);
  });

  app.use('/api', buildApiRouter());

  // Public SigLens landing page at /
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolveLandingHtmlPath());
  });

  // Prevent direct static bypass of the /app auth gate via /index.html
  app.get('/index.html', (_req, res) => {
    return res.redirect(302, '/app');
  });

  // Strict server-side Google login gate for /app and all sub-routes
  app.get(['/app', '/app/*'], (req, res, next) => {
    if (shouldEnforceGoogleAuth() && !getSessionUserFromReq(req)) {
      return res.redirect(302, '/?auth_required=1');
    }
    return next();
  });

  // Final error fallback (never expose stack traces in production)
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[SIGLENS] Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function bootstrap() {
  // Initialize SQLite database & migrations immediately
  getDb();
  ensureAuthTables();

  const app = createApp();
  const server = http.createServer(app);
  wsHub.attach(server);

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '365d',
        immutable: true,
      }),
    );
    app.use(
      express.static(distDir, {
        index: false,
        maxAge: '1h',
      }),
    );
    app.get(['/app', '/app/*'], (req, res) => {
      if (shouldEnforceGoogleAuth() && !getSessionUserFromReq(req)) {
        return res.redirect(302, '/?auth_required=1');
      }
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(distDir, 'index.html'));
    });
    app.get('*', (_req, res) => {
      return res.redirect(302, '/');
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SIGLENS] Server listening on http://0.0.0.0:${PORT}`);
    startBackgroundScanner();
    startAutonomousPaperLoop();
  });
}

if (process.env.SIGLENS_NO_AUTOSTART !== 'true') {
  bootstrap().catch((err) => {
    console.error('[SIGLENS] Fatal startup error:', err);
    process.exit(1);
  });
}
