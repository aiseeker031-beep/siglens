import { CFD_UNIVERSE, CORE_UNIVERSE_BASES, STOCK_UNIVERSE, TIMEFRAME_MS, type TraditionalInstrument } from '../shared/constants';
import type {
  Candle,
  DefiOverview,
  DerivativesMarket,
  ExchangeId,
  MarketTicker,
  MarketType,
  OrderBookSnapshot,
  ProviderStatus,
  Timeframe,
} from '../shared/types';
import { getCachedCandles, upsertCachedCandles } from './db';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number): T {
  memCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function clearMemoryCache(): void {
  memCache.clear();
}

const providerHealth: Record<ProviderStatus['id'], ProviderStatus> = {
  binance: {
    id: 'binance',
    name: 'Binance Public Market Data',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: ['spot'],
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit V5 Public API',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: ['spot', 'perpetual'],
  },
  kraken: {
    id: 'kraken',
    name: 'Kraken Public API',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: ['spot'],
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Exchange Public API',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: ['spot'],
  },
  stocks: {
    id: 'stocks',
    name: 'US Equities & ETFs (Yahoo Finance Public)',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: ['equity'],
  },
  cfds: {
    id: 'cfds',
    name: 'Global Indices, Metals & FX CFDs (Yahoo Finance Public)',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: ['cfd'],
  },
  defillama: {
    id: 'defillama',
    name: 'DefiLlama Public API',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: [],
  },
  alternative_me: {
    id: 'alternative_me',
    name: 'Alternative.me Fear & Greed',
    status: 'DELAYED',
    wsConnected: false,
    lastRestSuccessAt: null,
    lastWsMessageAt: null,
    latencyMs: null,
    requestCount: 0,
    errorCount: 0,
    lastError: null,
    supportedMarkets: [],
  },
};

export function updateWsProviderHealth(id: ExchangeId, connected: boolean, messageTs?: number): void {
  const p = providerHealth[id];
  if (!p) return;
  p.wsConnected = connected;
  if (messageTs) {
    p.lastWsMessageAt = messageTs;
    p.status = 'LIVE';
  } else if (!connected && p.status === 'LIVE') {
    p.status = 'RECONNECTING';
  }
}

export function getProviderStatuses(): ProviderStatus[] {
  const now = Date.now();
  return Object.values(providerHealth).map((p) => {
    let status = p.status;
    if (p.wsConnected && p.lastWsMessageAt && now - p.lastWsMessageAt < 25_000) {
      status = 'LIVE';
    } else if (p.lastRestSuccessAt && now - p.lastRestSuccessAt < 90_000) {
      status = 'LIVE';
    } else if (p.lastRestSuccessAt && now - p.lastRestSuccessAt < 300_000) {
      status = 'DELAYED';
    } else if (p.lastError && !p.lastRestSuccessAt) {
      status = 'UNAVAILABLE';
    }
    return { ...p, status };
  });
}

async function fetchJsonWithMetrics<T>(
  providerId: ProviderStatus['id'],
  url: string,
  timeoutMs = 8000,
  userAgent = 'SIGLENS-Analytics/1.0',
): Promise<T> {
  const stat = providerHealth[providerId];
  stat.requestCount++;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${providerId}`);
    }
    const json = (await res.json()) as T;
    stat.latencyMs = Date.now() - t0;
    stat.lastRestSuccessAt = Date.now();
    stat.status = 'LIVE';
    stat.lastError = null;
    return json;
  } catch (err) {
    stat.errorCount++;
    stat.lastError = err instanceof Error ? err.message : String(err);
    if (!stat.lastRestSuccessAt) stat.status = 'UNAVAILABLE';
    throw err;
  }
}

export function parseCanonicalId(canonicalId: string): {
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  baseAsset: string;
  quoteAsset: string;
} {
  const parts = canonicalId.split(':');
  const exchange = (parts[0] || 'binance') as ExchangeId;
  const marketType = (parts[1] || 'spot') as MarketType;
  const displaySymbol = parts[2] || 'BTC/USDT';
  const [baseAsset = 'BTC', quoteAsset = 'USDT'] = displaySymbol.split('/');
  return { exchange, marketType, displaySymbol, baseAsset, quoteAsset };
}

export function toNativeSymbol(exchange: ExchangeId, base: string, quote: string): string {
  const b = base.toUpperCase();
  const q = (quote || 'USD').toUpperCase();
  if (exchange === 'stocks') {
    const found = STOCK_UNIVERSE.find((x) => x.base === b || x.displaySymbol === `${b}/${q}`);
    return found ? found.nativeSymbol : b;
  }
  if (exchange === 'cfds') {
    const found = CFD_UNIVERSE.find(
      (x) => x.displaySymbol === `${b}/${q}` || (x.base === b && x.quote === q) || x.base === b,
    );
    return found ? found.nativeSymbol : `${b}${q}=X`;
  }
  if (exchange === 'coinbase') return `${b}-${q === 'USDT' ? 'USD' : q}`;
  if (exchange === 'kraken') {
    const kb = b === 'BTC' ? 'XBT' : b;
    const kq = q === 'USDT' ? 'USD' : q;
    return `${kb}${kq}`;
  }
  return `${b}${q}`;
}

// =========================================================================
// 1. TICKERS & MARKETS (BINANCE, BYBIT, KRAKEN, COINBASE)
// =========================================================================

async function fetchBinanceSpotTickers(): Promise<MarketTicker[]> {
  const key = 'tickers:binance:spot';
  const cached = getCached<MarketTicker[]>(key);
  if (cached) return cached;

  let raw: Record<string, string>[];
  try {
    raw = await fetchJsonWithMetrics<Record<string, string>[]>(
      'binance',
      'https://data-api.binance.vision/api/v3/ticker/24hr',
      9000,
    );
  } catch {
    raw = await fetchJsonWithMetrics<Record<string, string>[]>(
      'binance',
      'https://api.binance.com/api/v3/ticker/24hr',
      9000,
    );
  }

  const now = Date.now();
  const allowedQuotes = new Set(['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH']);
  const tickers: MarketTicker[] = [];

  for (const item of raw) {
    const sym = item.symbol;
    if (!sym) continue;
    let base = '';
    let quote = '';
    for (const q of allowedQuotes) {
      if (sym.endsWith(q) && sym.length > q.length) {
        base = sym.slice(0, sym.length - q.length);
        quote = q;
        break;
      }
    }
    if (!base || !quote) continue;
    const lastPrice = Number(item.lastPrice);
    const quoteVol = Number(item.quoteVolume);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0 || quoteVol < 250_000) continue;

    const bid = Number(item.bidPrice) || null;
    const ask = Number(item.askPrice) || null;
    const spreadPct = bid && ask && bid > 0 ? ((ask - bid) / bid) * 100 : null;
    const displaySymbol = `${base}/${quote}`;

    tickers.push({
      canonicalId: `binance:spot:${displaySymbol}`,
      exchange: 'binance',
      marketType: 'spot',
      baseAsset: base,
      quoteAsset: quote,
      displaySymbol,
      nativeSymbol: sym,
      lastPrice,
      bid,
      ask,
      spreadPct,
      change24h: Number(item.priceChange) || 0,
      change24hPct: Number(item.priceChangePercent) || 0,
      high24h: Number(item.highPrice) || lastPrice,
      low24h: Number(item.lowPrice) || lastPrice,
      baseVolume24h: Number(item.volume) || 0,
      quoteVolume24h: quoteVol,
      timestamp: now,
      freshness: 'LIVE',
      source: 'Binance Public REST',
    });
  }

  tickers.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  return setCached(key, tickers.slice(0, 150), 15_000);
}

async function fetchBybitTickers(marketType: MarketType): Promise<MarketTicker[]> {
  const category = marketType === 'perpetual' ? 'linear' : 'spot';
  const key = `tickers:bybit:${marketType}`;
  const cached = getCached<MarketTicker[]>(key);
  if (cached) return cached;

  const res = await fetchJsonWithMetrics<{
    result?: { list?: Record<string, string>[] };
  }>('bybit', `https://api.bybit.com/v5/market/tickers?category=${category}`, 9000);

  const list = res.result?.list ?? [];
  const now = Date.now();
  const tickers: MarketTicker[] = [];

  for (const item of list) {
    const sym = item.symbol;
    if (!sym || !sym.endsWith('USDT')) continue;
    const base = sym.slice(0, -4);
    const quote = 'USDT';
    const lastPrice = Number(item.lastPrice);
    const quoteVol = Number(item.turnover24h);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0 || quoteVol < 250_000) continue;

    const bid = Number(item.bid1Price) || null;
    const ask = Number(item.ask1Price) || null;
    const spreadPct = bid && ask && bid > 0 ? ((ask - bid) / bid) * 100 : null;
    const pct = (Number(item.price24hPcnt) || 0) * 100;
    const displaySymbol = `${base}/${quote}`;

    tickers.push({
      canonicalId: `bybit:${marketType}:${displaySymbol}`,
      exchange: 'bybit',
      marketType,
      baseAsset: base,
      quoteAsset: quote,
      displaySymbol,
      nativeSymbol: sym,
      lastPrice,
      bid,
      ask,
      spreadPct,
      change24h: lastPrice - (Number(item.prevPrice24h) || lastPrice),
      change24hPct: pct,
      high24h: Number(item.highPrice24h) || lastPrice,
      low24h: Number(item.lowPrice24h) || lastPrice,
      baseVolume24h: Number(item.volume24h) || 0,
      quoteVolume24h: quoteVol,
      timestamp: now,
      freshness: 'LIVE',
      source: `Bybit V5 Public (${category})`,
    });
  }

  tickers.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  return setCached(key, tickers.slice(0, 120), 15_000);
}

const KRAKEN_PAIRS: { base: string; quote: string; native: string }[] = [
  { base: 'BTC', quote: 'USD', native: 'XBTUSD' },
  { base: 'ETH', quote: 'USD', native: 'ETHUSD' },
  { base: 'SOL', quote: 'USD', native: 'SOLUSD' },
  { base: 'XRP', quote: 'USD', native: 'XRPUSD' },
  { base: 'ADA', quote: 'USD', native: 'ADAUSD' },
  { base: 'DOGE', quote: 'USD', native: 'XDGUSD' },
  { base: 'LINK', quote: 'USD', native: 'LINKUSD' },
  { base: 'DOT', quote: 'USD', native: 'DOTUSD' },
  { base: 'AVAX', quote: 'USD', native: 'AVAXUSD' },
  { base: 'LTC', quote: 'USD', native: 'LTCUSD' },
  { base: 'UNI', quote: 'USD', native: 'UNIUSD' },
  { base: 'ATOM', quote: 'USD', native: 'ATOMUSD' },
  { base: 'AAVE', quote: 'USD', native: 'AAVEUSD' },
  { base: 'NEAR', quote: 'USD', native: 'NEARUSD' },
  { base: 'SUI', quote: 'USD', native: 'SUIUSD' },
];

async function fetchKrakenTickers(): Promise<MarketTicker[]> {
  const key = 'tickers:kraken:spot';
  const cached = getCached<MarketTicker[]>(key);
  if (cached) return cached;

  const pairParam = KRAKEN_PAIRS.map((p) => p.native).join(',');
  const res = await fetchJsonWithMetrics<{
    result?: Record<string, Record<string, string[] | string>>;
  }>('kraken', `https://api.kraken.com/0/public/Ticker?pair=${pairParam}`, 9000);

  const result = res.result ?? {};
  const now = Date.now();
  const tickers: MarketTicker[] = [];

  for (const [kKey, val] of Object.entries(result)) {
    const matched = KRAKEN_PAIRS.find(
      (p) => kKey.includes(p.native) || kKey.includes(p.base) || (p.base === 'BTC' && kKey.includes('XXBT')),
    );
    if (!matched) continue;
    const lastPrice = Number((val.c as string[])?.[0]);
    const open = Number(val.o);
    const ask = Number((val.a as string[])?.[0]) || null;
    const bid = Number((val.b as string[])?.[0]) || null;
    const baseVol = Number((val.v as string[])?.[1]) || 0;
    const high24h = Number((val.h as string[])?.[1]) || lastPrice;
    const low24h = Number((val.l as string[])?.[1]) || lastPrice;
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

    const change24h = open > 0 ? lastPrice - open : 0;
    const change24hPct = open > 0 ? ((lastPrice - open) / open) * 100 : 0;
    const displaySymbol = `${matched.base}/${matched.quote}`;

    tickers.push({
      canonicalId: `kraken:spot:${displaySymbol}`,
      exchange: 'kraken',
      marketType: 'spot',
      baseAsset: matched.base,
      quoteAsset: matched.quote,
      displaySymbol,
      nativeSymbol: matched.native,
      lastPrice,
      bid,
      ask,
      spreadPct: bid && ask && bid > 0 ? ((ask - bid) / bid) * 100 : null,
      change24h,
      change24hPct,
      high24h,
      low24h,
      baseVolume24h: baseVol,
      quoteVolume24h: baseVol * lastPrice,
      timestamp: now,
      freshness: 'LIVE',
      source: 'Kraken Public REST',
    });
  }

  tickers.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  return setCached(key, tickers, 20_000);
}

const COINBASE_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'UNI', 'SUI', 'AAVE', 'NEAR'];

async function fetchCoinbaseTickers(): Promise<MarketTicker[]> {
  const key = 'tickers:coinbase:spot';
  const cached = getCached<MarketTicker[]>(key);
  if (cached) return cached;

  const now = Date.now();
  const settled = await Promise.allSettled(
    COINBASE_BASES.map(async (base) => {
      const productId = `${base}-USD`;
      const stats = await fetchJsonWithMetrics<Record<string, string>>(
        'coinbase',
        `https://api.exchange.coinbase.com/products/${productId}/stats`,
        6000,
      );
      const lastPrice = Number(stats.last);
      const open = Number(stats.open);
      const baseVol = Number(stats.volume) || 0;
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
      const change24h = open > 0 ? lastPrice - open : 0;
      const change24hPct = open > 0 ? ((lastPrice - open) / open) * 100 : 0;
      const displaySymbol = `${base}/USD`;
      const t: MarketTicker = {
        canonicalId: `coinbase:spot:${displaySymbol}`,
        exchange: 'coinbase',
        marketType: 'spot',
        baseAsset: base,
        quoteAsset: 'USD',
        displaySymbol,
        nativeSymbol: productId,
        lastPrice,
        bid: null,
        ask: null,
        spreadPct: null,
        change24h,
        change24hPct,
        high24h: Number(stats.high) || lastPrice,
        low24h: Number(stats.low) || lastPrice,
        baseVolume24h: baseVol,
        quoteVolume24h: baseVol * lastPrice,
        timestamp: now,
        freshness: 'LIVE',
        source: 'Coinbase Exchange Public REST',
      };
      return t;
    }),
  );

  const tickers = settled
    .filter((s): s is PromiseFulfilledResult<MarketTicker | null> => s.status === 'fulfilled')
    .map((s) => s.value)
    .filter((t): t is MarketTicker => t !== null)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

  return setCached(key, tickers, 25_000);
}

const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        regularMarketTime?: number;
        shortName?: string;
        exchangeName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

async function fetchYahooChart(
  providerId: 'stocks' | 'cfds',
  nativeSymbol: string,
  interval: string,
  range: string,
): Promise<NonNullable<NonNullable<YahooChartResponse['chart']>['result']>[0] | null> {
  const pathStr = `/v8/finance/chart/${encodeURIComponent(nativeSymbol)}?interval=${interval}&range=${range}`;
  let res: YahooChartResponse;
  try {
    res = await fetchJsonWithMetrics<YahooChartResponse>(
      providerId,
      `https://query1.finance.yahoo.com${pathStr}`,
      9000,
      YAHOO_UA,
    );
  } catch {
    res = await fetchJsonWithMetrics<YahooChartResponse>(
      providerId,
      `https://query2.finance.yahoo.com${pathStr}`,
      9000,
      YAHOO_UA,
    );
  }
  return res.chart?.result?.[0] ?? null;
}

async function fetchTraditionalUniverseTickers(
  exchange: 'stocks' | 'cfds',
  marketType: 'equity' | 'cfd',
  universe: TraditionalInstrument[],
): Promise<MarketTicker[]> {
  const key = `tickers:${exchange}:${marketType}`;
  const cached = getCached<MarketTicker[]>(key);
  if (cached) return cached;

  const tickers: MarketTicker[] = [];
  const now = Date.now();
  const batchSize = 6;

  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (inst) => {
        const result = await fetchYahooChart(exchange, inst.nativeSymbol, '1d', '5d');
        const meta = result?.meta;
        const lastPrice = Number(meta?.regularMarketPrice);
        if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

        const rawCloses = (result?.indicators?.quote?.[0]?.close ?? []).filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
        );
        const prevClose =
          rawCloses.length >= 2
            ? rawCloses[rawCloses.length - 2]
            : Number(meta?.previousClose ?? meta?.chartPreviousClose ?? lastPrice);
        const change24h = lastPrice - prevClose;
        const change24hPct = prevClose > 0 ? (change24h / prevClose) * 100 : 0;
        const high24h = Number(meta?.regularMarketDayHigh) || lastPrice;
        const low24h = Number(meta?.regularMarketDayLow) || lastPrice;
        const baseVol = Number(meta?.regularMarketVolume) || 0;
        const quoteVol = baseVol > 0 ? baseVol * lastPrice : 0;

        const tk: MarketTicker = {
          canonicalId: `${exchange}:${marketType}:${inst.displaySymbol}`,
          exchange,
          marketType,
          baseAsset: inst.base,
          quoteAsset: inst.quote,
          displaySymbol: inst.displaySymbol,
          nativeSymbol: inst.nativeSymbol,
          lastPrice,
          bid: null,
          ask: null,
          spreadPct: null,
          change24h,
          change24hPct,
          high24h,
          low24h,
          baseVolume24h: baseVol,
          quoteVolume24h: quoteVol,
          timestamp: meta?.regularMarketTime ? meta.regularMarketTime * 1000 : now,
          freshness: 'LIVE',
          source: `${inst.category} · ${inst.name}`,
        };
        return tk;
      }),
    );

    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        tickers.push(s.value);
      }
    }
  }

  if (exchange === 'stocks') {
    tickers.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  }
  return setCached(key, tickers, 45_000);
}

export async function getMarketTickers(
  exchange: ExchangeId | 'all' = 'binance',
  marketType: MarketType | 'all' = 'spot',
): Promise<MarketTicker[]> {
  if (exchange === 'all') {
    const tasks: Promise<MarketTicker[]>[] = [];
    if (marketType === 'all' || marketType === 'spot') {
      tasks.push(fetchBinanceSpotTickers().catch(() => []));
      tasks.push(fetchBybitTickers('spot').catch(() => []));
      tasks.push(fetchKrakenTickers().catch(() => []));
      tasks.push(fetchCoinbaseTickers().catch(() => []));
    }
    if (marketType === 'all' || marketType === 'perpetual') {
      tasks.push(fetchBybitTickers('perpetual').catch(() => []));
    }
    if (marketType === 'all' || marketType === 'equity') {
      tasks.push(fetchTraditionalUniverseTickers('stocks', 'equity', STOCK_UNIVERSE).catch(() => []));
    }
    if (marketType === 'all' || marketType === 'cfd') {
      tasks.push(fetchTraditionalUniverseTickers('cfds', 'cfd', CFD_UNIVERSE).catch(() => []));
    }
    const all = (await Promise.all(tasks)).flat();
    return all.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  }

  if (exchange === 'binance') return fetchBinanceSpotTickers();
  if (exchange === 'bybit') return fetchBybitTickers(marketType === 'perpetual' ? 'perpetual' : 'spot');
  if (exchange === 'kraken') return fetchKrakenTickers();
  if (exchange === 'stocks') return fetchTraditionalUniverseTickers('stocks', 'equity', STOCK_UNIVERSE);
  if (exchange === 'cfds') return fetchTraditionalUniverseTickers('cfds', 'cfd', CFD_UNIVERSE);
  return fetchCoinbaseTickers();
}

// =========================================================================
// 2. HISTORICAL OHLCV CANDLES (MULTI-EXCHANGE NORMALIZED)
// =========================================================================

const BYBIT_INTERVAL_MAP: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
};

const KRAKEN_INTERVAL_MAP: Partial<Record<Timeframe, number>> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

const COINBASE_GRANULARITY_MAP: Partial<Record<Timeframe, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '1d': 86400,
};

export async function fetchCandles(
  exchange: ExchangeId,
  marketType: MarketType,
  displaySymbol: string,
  timeframe: Timeframe,
  limit = 260,
): Promise<{ candles: Candle[]; source: string; freshness: MarketTicker['freshness'] }> {
  const canonicalId = `${exchange}:${marketType}:${displaySymbol}`;
  const cacheKey = `candles:${canonicalId}:${timeframe}:${limit}`;
  const ttl = timeframe === '1m' ? 8_000 : timeframe === '5m' ? 15_000 : 25_000;
  const cached = getCached<{ candles: Candle[]; source: string; freshness: MarketTicker['freshness'] }>(cacheKey);
  if (cached) return cached;

  const [base, quote] = displaySymbol.split('/');
  const native = toNativeSymbol(exchange, base, quote);
  const now = Date.now();
  const intervalMs = TIMEFRAME_MS[timeframe];

  try {
    let candles: Candle[] = [];
    let source = '';

    if (exchange === 'binance') {
      const urlPath = `/api/v3/klines?symbol=${encodeURIComponent(native)}&interval=${timeframe}&limit=${Math.min(limit, 500)}`;
      let raw: unknown[][];
      try {
        raw = await fetchJsonWithMetrics<unknown[][]>('binance', `https://data-api.binance.vision${urlPath}`, 8000);
      } catch {
        raw = await fetchJsonWithMetrics<unknown[][]>('binance', `https://api.binance.com${urlPath}`, 8000);
      }
      candles = raw.map((k) => {
        const openTime = Number(k[0]);
        const closeTime = Number(k[6]);
        return {
          openTime,
          closeTime,
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
          quoteVolume: Number(k[7]),
          isClosed: closeTime < now,
        };
      });
      source = 'Binance Public Klines';
    } else if (exchange === 'bybit') {
      const cat = marketType === 'perpetual' ? 'linear' : 'spot';
      const iv = BYBIT_INTERVAL_MAP[timeframe];
      const res = await fetchJsonWithMetrics<{ result?: { list?: string[][] } }>(
        'bybit',
        `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${encodeURIComponent(native)}&interval=${iv}&limit=${Math.min(limit, 300)}`,
        8000,
      );
      const list = (res.result?.list ?? []).slice().reverse();
      candles = list.map((k) => {
        const openTime = Number(k[0]);
        const closeTime = openTime + intervalMs - 1;
        return {
          openTime,
          closeTime,
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
          quoteVolume: Number(k[6]),
          isClosed: closeTime < now,
        };
      });
      source = `Bybit V5 Klines (${cat})`;
    } else if (exchange === 'kraken') {
      const iv = KRAKEN_INTERVAL_MAP[timeframe];
      if (!iv) throw new Error(`Timeframe ${timeframe} is not natively supported by Kraken REST API.`);
      const res = await fetchJsonWithMetrics<{ result?: Record<string, unknown> }>(
        'kraken',
        `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(native)}&interval=${iv}`,
        8000,
      );
      const resultObj = res.result ?? {};
      const key = Object.keys(resultObj).find((k) => k !== 'last');
      const rows = (key ? (resultObj[key] as (string | number)[][]) : []).slice(-limit);
      candles = rows.map((k) => {
        const openTime = Number(k[0]) * 1000;
        const closeTime = openTime + intervalMs - 1;
        return {
          openTime,
          closeTime,
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[6]),
          isClosed: closeTime < now,
        };
      });
      source = 'Kraken Public OHLC';
    } else if (exchange === 'coinbase') {
      const gran = COINBASE_GRANULARITY_MAP[timeframe];
      if (!gran) throw new Error(`Timeframe ${timeframe} is not natively supported by Coinbase Exchange API.`);
      const rows = await fetchJsonWithMetrics<number[][]>(
        'coinbase',
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(native)}/candles?granularity=${gran}`,
        8000,
      );
      candles = rows
        .slice(0, limit)
        .reverse()
        .map((k) => {
          const openTime = Number(k[0]) * 1000;
          const closeTime = openTime + intervalMs - 1;
          return {
            openTime,
            closeTime,
            low: Number(k[1]),
            high: Number(k[2]),
            open: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
            isClosed: closeTime < now,
          };
        });
      source = 'Coinbase Exchange Candles';
    } else if (exchange === 'stocks' || exchange === 'cfds') {
      const yfSpec: Record<string, { interval: string; range: string; aggregate4h?: boolean }> = {
        '5m': { interval: '5m', range: '5d' },
        '15m': { interval: '15m', range: '1mo' },
        '30m': { interval: '30m', range: '1mo' },
        '1h': { interval: '60m', range: '3mo' },
        '4h': { interval: '60m', range: '6mo', aggregate4h: true },
        '1d': { interval: '1d', range: '2y' },
        '1w': { interval: '1wk', range: '5y' },
      };
      const spec = yfSpec[timeframe] ?? { interval: '60m', range: '3mo' };
      const result = await fetchYahooChart(exchange, native, spec.interval, spec.range);
      const timestamps = result?.timestamp ?? [];
      const q = result?.indicators?.quote?.[0];
      const opens = q?.open ?? [];
      const highs = q?.high ?? [];
      const lows = q?.low ?? [];
      const closes = q?.close ?? [];
      const vols = q?.volume ?? [];

      const rawBars: Candle[] = [];
      const baseStepMs = spec.aggregate4h ? 3_600_000 : intervalMs;
      for (let i = 0; i < timestamps.length; i++) {
        const o = opens[i];
        const h = highs[i];
        const l = lows[i];
        const c = closes[i];
        if (
          typeof o !== 'number' ||
          typeof h !== 'number' ||
          typeof l !== 'number' ||
          typeof c !== 'number' ||
          !Number.isFinite(o) ||
          !Number.isFinite(c) ||
          c <= 0
        ) {
          continue;
        }
        const openTime = timestamps[i] * 1000;
        const closeTime = openTime + baseStepMs - 1;
        const vol = typeof vols[i] === 'number' && Number.isFinite(vols[i]) ? vols[i]! : 0;
        rawBars.push({
          openTime,
          closeTime,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: vol,
          quoteVolume: vol * c,
          isClosed: closeTime < now,
        });
      }

      if (spec.aggregate4h) {
        const buckets = new Map<number, Candle>();
        const bucketMs = 4 * 3_600_000;
        for (const bar of rawBars) {
          const bKey = Math.floor(bar.openTime / bucketMs) * bucketMs;
          const prev = buckets.get(bKey);
          if (!prev) {
            buckets.set(bKey, {
              openTime: bKey,
              closeTime: bKey + bucketMs - 1,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
              quoteVolume: (bar.quoteVolume ?? 0),
              isClosed: bKey + bucketMs - 1 < now,
            });
          } else {
            prev.high = Math.max(prev.high, bar.high);
            prev.low = Math.min(prev.low, bar.low);
            prev.close = bar.close;
            prev.volume += bar.volume;
            prev.quoteVolume = (prev.quoteVolume ?? 0) + (bar.quoteVolume ?? 0);
          }
        }
        candles = Array.from(buckets.values())
          .sort((a, b) => a.openTime - b.openTime)
          .slice(-limit);
      } else {
        candles = rawBars.slice(-limit);
      }
      source = exchange === 'stocks' ? 'US Equities Public OHLCV' : 'Global CFDs Public OHLCV';
    }

    if (candles.length > 0) {
      upsertCachedCandles(canonicalId, timeframe, candles);
    }

    return setCached(cacheKey, { candles, source, freshness: 'LIVE' as const }, ttl);
  } catch (err) {
    // Fall back to last verified SQLite snapshot if available (explicitly marked STALE/DELAYED)
    const fallback = getCachedCandles(canonicalId, timeframe, limit);
    if (fallback.length > 0) {
      return {
        candles: fallback,
        source: `${exchange} (Last Verified Local Cache)`,
        freshness: 'STALE',
      };
    }
    throw err;
  }
}

// =========================================================================
// 3. PUBLIC ORDER BOOK DEPTH
// =========================================================================

export async function fetchOrderBook(
  exchange: ExchangeId,
  marketType: MarketType,
  displaySymbol: string,
  depthLimit = 25,
): Promise<OrderBookSnapshot> {
  const canonicalId = `${exchange}:${marketType}:${displaySymbol}`;
  const key = `book:${canonicalId}`;
  const cached = getCached<OrderBookSnapshot>(key);
  if (cached) return cached;

  const [base, quote] = displaySymbol.split('/');
  const native = toNativeSymbol(exchange, base, quote);

  let rawBids: [number, number][] = [];
  let rawAsks: [number, number][] = [];
  let source = '';

  if (exchange === 'stocks' || exchange === 'cfds') {
    return {
      canonicalId,
      exchange,
      marketType,
      displaySymbol,
      bids: [],
      asks: [],
      bestBid: null,
      bestAsk: null,
      spreadPct: null,
      timestamp: Date.now(),
      source: 'L2 order book depth is unavailable for public equity/CFD feeds',
    };
  }

  if (exchange === 'binance') {
    let data: { bids: string[][]; asks: string[][] };
    try {
      data = await fetchJsonWithMetrics(
        'binance',
        `https://data-api.binance.vision/api/v3/depth?symbol=${encodeURIComponent(native)}&limit=${depthLimit}`,
      );
    } catch {
      data = await fetchJsonWithMetrics(
        'binance',
        `https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(native)}&limit=${depthLimit}`,
      );
    }
    rawBids = data.bids.map((b) => [Number(b[0]), Number(b[1])]);
    rawAsks = data.asks.map((a) => [Number(a[0]), Number(a[1])]);
    source = 'Binance Public Depth';
  } else if (exchange === 'bybit') {
    const cat = marketType === 'perpetual' ? 'linear' : 'spot';
    const res = await fetchJsonWithMetrics<{ result?: { b?: string[][]; a?: string[][] } }>(
      'bybit',
      `https://api.bybit.com/v5/market/orderbook?category=${cat}&symbol=${encodeURIComponent(native)}&limit=${depthLimit}`,
    );
    rawBids = (res.result?.b ?? []).map((b) => [Number(b[0]), Number(b[1])]);
    rawAsks = (res.result?.a ?? []).map((a) => [Number(a[0]), Number(a[1])]);
    source = `Bybit V5 Orderbook (${cat})`;
  } else if (exchange === 'kraken') {
    const res = await fetchJsonWithMetrics<{ result?: Record<string, { bids: string[][]; asks: string[][] }> }>(
      'kraken',
      `https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(native)}&count=${depthLimit}`,
    );
    const first = Object.values(res.result ?? {})[0];
    rawBids = (first?.bids ?? []).map((b) => [Number(b[0]), Number(b[1])]);
    rawAsks = (first?.asks ?? []).map((a) => [Number(a[0]), Number(a[1])]);
    source = 'Kraken Public Depth';
  } else {
    const res = await fetchJsonWithMetrics<{ bids: string[][]; asks: string[][] }>(
      'coinbase',
      `https://api.exchange.coinbase.com/products/${encodeURIComponent(native)}/book?level=2`,
    );
    rawBids = (res.bids ?? []).slice(0, depthLimit).map((b) => [Number(b[0]), Number(b[1])]);
    rawAsks = (res.asks ?? []).slice(0, depthLimit).map((a) => [Number(a[0]), Number(a[1])]);
    source = 'Coinbase Exchange Level 2 Book';
  }

  let bidCum = 0;
  const bids = rawBids.map(([price, size]) => {
    bidCum += size;
    return { price, size, total: bidCum };
  });

  let askCum = 0;
  const asks = rawAsks.map(([price, size]) => {
    askCum += size;
    return { price, size, total: askCum };
  });

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spreadPct = bestBid && bestAsk && bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : null;

  return setCached(
    key,
    {
      canonicalId,
      exchange,
      marketType,
      displaySymbol,
      bids,
      asks,
      bestBid,
      bestAsk,
      spreadPct,
      timestamp: Date.now(),
      source,
    },
    5_000,
  );
}

// =========================================================================
// 4. BYBIT V5 DERIVATIVES ANALYTICS (FUNDING, OI, LONG/SHORT, BASIS)
// =========================================================================

export async function fetchDerivativesOverview(): Promise<{
  markets: DerivativesMarket[];
  source: string;
  updatedAt: number;
}> {
  const key = 'derivatives:bybit:linear';
  const cached = getCached<{ markets: DerivativesMarket[]; source: string; updatedAt: number }>(key);
  if (cached) return cached;

  try {
    const res = await fetchJsonWithMetrics<{ result?: { list?: Record<string, string>[] } }>(
      'bybit',
      'https://api.bybit.com/v5/market/tickers?category=linear',
      9000,
    );
    const list = res.result?.list ?? [];
    const coreSet = new Set(CORE_UNIVERSE_BASES.map((b) => `${b}USDT`));
    const filtered = list
      .filter((item) => item.symbol && item.symbol.endsWith('USDT') && (coreSet.has(item.symbol) || Number(item.turnover24h) > 50_000_000))
      .sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h))
      .slice(0, 30);

    // Fetch official Bybit public long/short ratio for top 8 symbols concurrently
    const lsMap = new Map<string, { buyRatio: number; sellRatio: number }>();
    await Promise.allSettled(
      filtered.slice(0, 8).map(async (item) => {
        const lsRes = await fetchJsonWithMetrics<{ result?: { list?: { buyRatio: string; sellRatio: string }[] } }>(
          'bybit',
          `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${item.symbol}&period=1h&limit=1`,
          5000,
        );
        const latest = lsRes.result?.list?.[0];
        if (latest) {
          lsMap.set(item.symbol, {
            buyRatio: Number(latest.buyRatio),
            sellRatio: Number(latest.sellRatio),
          });
        }
      }),
    );

    const now = Date.now();
    const markets: DerivativesMarket[] = filtered.map((item) => {
      const base = item.symbol.slice(0, -4);
      const displaySymbol = `${base}/USDT`;
      const lastPrice = Number(item.lastPrice) || 0;
      const markPrice = Number(item.markPrice) || lastPrice;
      const indexPrice = Number(item.indexPrice) || lastPrice;
      const premiumPct = indexPrice > 0 ? ((markPrice - indexPrice) / indexPrice) * 100 : 0;
      const fundingRate = Number(item.fundingRate) || 0;
      const fundingRatePct = fundingRate * 100;
      const change24hPct = (Number(item.price24hPcnt) || 0) * 100;
      const ls = lsMap.get(item.symbol);
      const longShortRatio = ls && ls.sellRatio > 0 ? ls.buyRatio / ls.sellRatio : null;

      let observation = 'Balanced funding and neutral perpetual basis.';
      if (fundingRatePct >= 0.03) {
        observation = 'Elevated positive funding indicates crowded long perpetual positioning.';
      } else if (fundingRatePct <= -0.02) {
        observation = 'Negative funding reflects short perpetual hedging or bearish skew.';
      } else if (Math.abs(premiumPct) >= 0.15) {
        observation =
          premiumPct > 0
            ? 'Perpetual trading at a notable premium over spot index.'
            : 'Perpetual trading at a discount relative to spot index.';
      }

      return {
        canonicalId: `bybit:perpetual:${displaySymbol}`,
        exchange: 'bybit',
        displaySymbol,
        nativeSymbol: item.symbol,
        lastPrice,
        markPrice,
        indexPrice,
        premiumPct,
        fundingRate,
        fundingRatePct,
        nextFundingTime: Number(item.nextFundingTime) || 0,
        openInterest: Number(item.openInterest) || 0,
        openInterestValueUsd: Number(item.openInterestValue) || 0,
        volume24hUsd: Number(item.turnover24h) || 0,
        change24hPct,
        longShortRatio,
        buyRatio: ls?.buyRatio ?? null,
        sellRatio: ls?.sellRatio ?? null,
        observation,
        timestamp: now,
        source: 'Bybit V5 Linear Perpetual Public API',
      };
    });

    return setCached(
      key,
      { markets, source: 'Bybit V5 Linear Perpetual Public API', updatedAt: now },
      20_000,
    );
  } catch {
    // Fallback to Hyperliquid public unauthenticated perpetuals API (globally reachable from US servers)
    const hlRes = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      signal: AbortSignal.timeout(9000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (!hlRes.ok) {
      throw new Error(`Derivatives providers unavailable (Bybit blocked, Hyperliquid HTTP ${hlRes.status})`);
    }
    const [meta, ctxs] = (await hlRes.json()) as [
      { universe?: { name: string }[] },
      {
        funding?: string;
        openInterest?: string;
        prevDayPx?: string;
        dayNtlVlm?: string;
        premium?: string;
        oraclePx?: string;
        markPx?: string;
      }[],
    ];
    const universe = meta?.universe ?? [];
    const coreSet = new Set(CORE_UNIVERSE_BASES);
    const now = Date.now();
    const nextHour = Math.ceil(now / 3_600_000) * 3_600_000;

    const mapped: DerivativesMarket[] = universe
      .map((u, idx): DerivativesMarket | null => {
        const c = ctxs?.[idx];
        if (!c || !u?.name) return null;
        const base = u.name.toUpperCase();
        const markPrice = Number(c.markPx) || Number(c.oraclePx) || 0;
        const indexPrice = Number(c.oraclePx) || markPrice;
        const prevDay = Number(c.prevDayPx) || markPrice;
        if (markPrice <= 0) return null;
        const volume24hUsd = Number(c.dayNtlVlm) || 0;
        const oi = Number(c.openInterest) || 0;
        const oiUsd = oi * markPrice;
        const fundingRate = Number(c.funding) || 0;
        const fundingRatePct = fundingRate * 100;
        const premiumPct =
          c.premium !== undefined && Number.isFinite(Number(c.premium))
            ? Number(c.premium) * 100
            : indexPrice > 0
              ? ((markPrice - indexPrice) / indexPrice) * 100
              : 0;
        const change24hPct = prevDay > 0 ? ((markPrice - prevDay) / prevDay) * 100 : 0;

        let observation = 'Balanced hourly funding and neutral perpetual basis.';
        if (fundingRatePct >= 0.004) {
          observation = 'Elevated positive funding indicates crowded long perpetual positioning.';
        } else if (fundingRatePct <= -0.003) {
          observation = 'Negative funding reflects short perpetual hedging or bearish skew.';
        } else if (Math.abs(premiumPct) >= 0.12) {
          observation =
            premiumPct > 0
              ? 'Perpetual trading at a notable premium over oracle spot index.'
              : 'Perpetual trading at a discount relative to oracle spot index.';
        }

        return {
          canonicalId: `bybit:perpetual:${base}/USDT`,
          exchange: 'bybit' as const,
          displaySymbol: `${base}/USDT`,
          nativeSymbol: `${base}-PERP`,
          lastPrice: markPrice,
          markPrice,
          indexPrice,
          premiumPct,
          fundingRate,
          fundingRatePct,
          nextFundingTime: nextHour,
          openInterest: oi,
          openInterestValueUsd: oiUsd,
          volume24hUsd,
          change24hPct,
          longShortRatio: null,
          buyRatio: null,
          sellRatio: null,
          observation,
          timestamp: now,
          source: 'Hyperliquid Public Perpetuals API (Fallback)',
        };
      })
      .filter((m): m is DerivativesMarket => m !== null)
      .filter((m) => coreSet.has(m.displaySymbol.split('/')[0]) || m.volume24hUsd >= 15_000_000)
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
      .slice(0, 30);

    return setCached(
      key,
      { markets: mapped, source: 'Hyperliquid Public Perpetuals API (Fallback)', updatedAt: now },
      20_000,
    );
  }
}

export async function fetchDerivativesDetail(symbolBase = 'BTC'): Promise<{
  symbol: string;
  fundingHistory: { timestamp: number; fundingRatePct: number }[];
  openInterestHistory: { timestamp: number; openInterest: number }[];
  longShortHistory: { timestamp: number; buyRatio: number; sellRatio: number }[];
  source: string;
}> {
  const native = `${symbolBase.toUpperCase()}USDT`;
  const key = `deriv-detail:${native}`;
  const cached = getCached<{
    symbol: string;
    fundingHistory: { timestamp: number; fundingRatePct: number }[];
    openInterestHistory: { timestamp: number; openInterest: number }[];
    longShortHistory: { timestamp: number; buyRatio: number; sellRatio: number }[];
    source: string;
  }>(key);
  if (cached) return cached;

  const [fundRes, oiRes, lsRes] = await Promise.allSettled([
    fetchJsonWithMetrics<{ result?: { list?: { fundingRateTimestamp: string; fundingRate: string }[] } }>(
      'bybit',
      `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${native}&limit=40`,
    ),
    fetchJsonWithMetrics<{ result?: { list?: { timestamp: string; openInterest: string }[] } }>(
      'bybit',
      `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${native}&intervalTime=1h&limit=48`,
    ),
    fetchJsonWithMetrics<{ result?: { list?: { timestamp: string; buyRatio: string; sellRatio: string }[] } }>(
      'bybit',
      `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${native}&period=1h&limit=48`,
    ),
  ]);

  const fundingHistory =
    fundRes.status === 'fulfilled'
      ? (fundRes.value.result?.list ?? [])
          .slice()
          .reverse()
          .map((x) => ({
            timestamp: Number(x.fundingRateTimestamp),
            fundingRatePct: Number(x.fundingRate) * 100,
          }))
      : [];

  const openInterestHistory =
    oiRes.status === 'fulfilled'
      ? (oiRes.value.result?.list ?? [])
          .slice()
          .reverse()
          .map((x) => ({
            timestamp: Number(x.timestamp),
            openInterest: Number(x.openInterest),
          }))
      : [];

  const longShortHistory =
    lsRes.status === 'fulfilled'
      ? (lsRes.value.result?.list ?? [])
          .slice()
          .reverse()
          .map((x) => ({
            timestamp: Number(x.timestamp),
            buyRatio: Number(x.buyRatio),
            sellRatio: Number(x.sellRatio),
          }))
      : [];

  let source = 'Bybit V5 Linear Historical Derivatives API';
  let finalFunding = fundingHistory;

  if (finalFunding.length === 0) {
    try {
      const hlRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fundingHistory',
          coin: symbolBase.toUpperCase(),
          startTime: Date.now() - 48 * 3_600_000,
        }),
      });
      if (hlRes.ok) {
        const rows = (await hlRes.json()) as { time: number; fundingRate: string }[];
        if (Array.isArray(rows) && rows.length > 0) {
          finalFunding = rows.slice(-48).map((r) => ({
            timestamp: Number(r.time),
            fundingRatePct: Number(r.fundingRate) * 100,
          }));
          source = 'Hyperliquid Public Funding History API (Fallback)';
        }
      }
    } catch {
      // keep empty honestly
    }
  }

  return setCached(
    key,
    {
      symbol: `${symbolBase.toUpperCase()}/USDT`,
      fundingHistory: finalFunding,
      openInterestHistory,
      longShortHistory,
      source,
    },
    30_000,
  );
}

// =========================================================================
// 5. DEFILLAMA FREE PUBLIC API & ALTERNATIVE.ME FEAR & GREED INDEX
// =========================================================================

export async function fetchFearAndGreed(): Promise<{
  value: number;
  classification: string;
  timestamp: number;
  source: string;
} | null> {
  const key = 'fng:latest';
  const cached = getCached<{
    value: number;
    classification: string;
    timestamp: number;
    source: string;
  }>(key);
  if (cached) return cached;

  try {
    const res = await fetchJsonWithMetrics<{
      data?: { value: string; value_classification: string; timestamp: string }[];
    }>('alternative_me', 'https://api.alternative.me/fng/?limit=1', 6000);
    const d = res.data?.[0];
    if (!d) return null;
    return setCached(
      key,
      {
        value: Number(d.value),
        classification: d.value_classification,
        timestamp: Number(d.timestamp) * 1000,
        source: 'Alternative.me Fear & Greed Index (Daily)',
      },
      300_000,
    );
  } catch {
    return null;
  }
}

export async function fetchDefiOverview(): Promise<DefiOverview> {
  const key = 'defi:overview';
  const cached = getCached<DefiOverview>(key);
  if (cached) return cached;

  const unavailableMetrics: string[] = [];

  const [chainsRes, protocolsRes, histRes, dexRes, stablesRes] = await Promise.allSettled([
    fetchJsonWithMetrics<{ name: string; tokenSymbol?: string | null; tvl: number }[]>(
      'defillama',
      'https://api.llama.fi/v2/chains',
      9000,
    ),
    fetchJsonWithMetrics<
      {
        name: string;
        symbol: string;
        category: string;
        chains?: string[];
        tvl: number;
        change_1d?: number | null;
        change_7d?: number | null;
        url?: string;
      }[]
    >('defillama', 'https://api.llama.fi/protocols', 10000),
    fetchJsonWithMetrics<{ date: number; tvl: number }[]>(
      'defillama',
      'https://api.llama.fi/v2/historicalChainTvl',
      9000,
    ),
    fetchJsonWithMetrics<{ total24h?: number }>(
      'defillama',
      'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
      7000,
    ),
    fetchJsonWithMetrics<{ peggedAssets?: { circulating?: { peggedUSD?: number } }[] }>(
      'defillama',
      'https://stablecoins.llama.fi/stablecoins?includePrices=false',
      7000,
    ),
  ]);

  const rawChains = chainsRes.status === 'fulfilled' ? chainsRes.value : [];
  const totalChainTvl = rawChains.reduce((s, c) => s + (Number(c.tvl) || 0), 0);
  const chains = rawChains
    .filter((c) => Number(c.tvl) > 0)
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 20)
    .map((c) => ({
      name: c.name,
      tokenSymbol: c.tokenSymbol ?? null,
      tvl: Number(c.tvl),
      sharePct: totalChainTvl > 0 ? (Number(c.tvl) / totalChainTvl) * 100 : 0,
    }));

  const rawProtocols = protocolsRes.status === 'fulfilled' ? protocolsRes.value : [];
  const protocols = rawProtocols
    .filter((p) => Number(p.tvl) > 1_000_000)
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 60)
    .map((p) => ({
      name: p.name,
      symbol: p.symbol || '—',
      category: p.category || 'Other',
      chains: p.chains ?? [],
      tvl: Number(p.tvl),
      change1d: typeof p.change_1d === 'number' ? p.change_1d : null,
      change7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      url: p.url || '',
    }));

  const rawHist = histRes.status === 'fulfilled' ? histRes.value : [];
  const historicalTvl = rawHist.slice(-180).map((h) => ({
    date: Number(h.date) * 1000,
    tvl: Number(h.tvl),
  }));

  const totalTvl =
    historicalTvl.length > 0 ? historicalTvl[historicalTvl.length - 1].tvl : totalChainTvl;
  const prevTvl = historicalTvl.length >= 2 ? historicalTvl[historicalTvl.length - 2].tvl : null;
  const tvlChange24hPct = prevTvl && prevTvl > 0 ? ((totalTvl - prevTvl) / prevTvl) * 100 : null;

  let dexVolume24hUsd: number | null = null;
  if (dexRes.status === 'fulfilled' && typeof dexRes.value.total24h === 'number') {
    dexVolume24hUsd = dexRes.value.total24h;
  } else {
    unavailableMetrics.push('24h DEX Volume (free endpoint temporarily unavailable)');
  }

  let stablecoinTotalUsd: number | null = null;
  if (stablesRes.status === 'fulfilled' && Array.isArray(stablesRes.value.peggedAssets)) {
    stablecoinTotalUsd = stablesRes.value.peggedAssets.reduce(
      (s, a) => s + (Number(a.circulating?.peggedUSD) || 0),
      0,
    );
  } else {
    unavailableMetrics.push('Stablecoin Market Cap (free endpoint temporarily unavailable)');
  }

  return setCached(
    key,
    {
      totalTvl,
      tvlChange24hPct,
      chains,
      protocols,
      historicalTvl,
      stablecoinTotalUsd,
      dexVolume24hUsd,
      source: 'DefiLlama Public API (Free Tier)',
      updatedAt: Date.now(),
      unavailableMetrics,
    },
    180_000,
  );
}
