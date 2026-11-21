import type {
  ArbitrageOpportunity,
  ArbitrageScanPayload,
  ArbitrageVenueQuote,
  Candle,
  ExchangeId,
  MarketTicker,
  MarketType,
  StatArbPair,
} from '../shared/types';
import { fetchCandles, getMarketTickers } from './providers';

const SPOT_VENUES: ExchangeId[] = ['binance', 'kraken', 'coinbase', 'bybit'];

const BASE_ASSET_ALIASES: Record<string, string> = {
  XBT: 'BTC',
  XDG: 'DOGE',
};

const STAT_ARB_SPECS: {
  id: string;
  label: string;
  category: StatArbPair['category'];
  exchange: ExchangeId;
  marketType: MarketType;
  symbolA: string;
  symbolB: string;
}[] = [
  {
    id: 'eth-btc',
    label: 'ETH / BTC',
    category: 'Crypto',
    exchange: 'binance',
    marketType: 'spot',
    symbolA: 'ETH/USDT',
    symbolB: 'BTC/USDT',
  },
  {
    id: 'sol-eth',
    label: 'SOL / ETH',
    category: 'Crypto',
    exchange: 'binance',
    marketType: 'spot',
    symbolA: 'SOL/USDT',
    symbolB: 'ETH/USDT',
  },
  {
    id: 'avax-sol',
    label: 'AVAX / SOL',
    category: 'Crypto',
    exchange: 'binance',
    marketType: 'spot',
    symbolA: 'AVAX/USDT',
    symbolB: 'SOL/USDT',
  },
  {
    id: 'nvda-amd',
    label: 'NVDA / AMD',
    category: 'US Equities',
    exchange: 'stocks',
    marketType: 'equity',
    symbolA: 'NVDA/USD',
    symbolB: 'AMD/USD',
  },
  {
    id: 'spy-qqq',
    label: 'SPY / QQQ',
    category: 'US Equities',
    exchange: 'stocks',
    marketType: 'equity',
    symbolA: 'SPY/USD',
    symbolB: 'QQQ/USD',
  },
  {
    id: 'aapl-msft',
    label: 'AAPL / MSFT',
    category: 'US Equities',
    exchange: 'stocks',
    marketType: 'equity',
    symbolA: 'AAPL/USD',
    symbolB: 'MSFT/USD',
  },
  {
    id: 'xau-xag',
    label: 'Gold / Silver',
    category: 'Global CFDs',
    exchange: 'cfds',
    marketType: 'cfd',
    symbolA: 'XAU/USD',
    symbolB: 'XAG/USD',
  },
  {
    id: 'wti-brent',
    label: 'WTI / Brent Oil',
    category: 'Global CFDs',
    exchange: 'cfds',
    marketType: 'cfd',
    symbolA: 'WTI/USD',
    symbolB: 'BRENT/USD',
  },
];

interface RawArbitrageCache {
  fetchedAt: number;
  venuesScanned: ExchangeId[];
  rawOpportunities: Omit<ArbitrageOpportunity, 'netSpreadPct' | 'status'>[];
  statArbPairs: StatArbPair[];
}

const CACHE_TTL_MS = 15_000;
const STAT_ARB_TTL_MS = 60_000;

let rawCache: RawArbitrageCache | null = null;
let statArbCache: { fetchedAt: number; pairs: StatArbPair[] } | null = null;
let inFlightScan: Promise<RawArbitrageCache> | null = null;

function normalizeBaseAsset(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return BASE_ASSET_ALIASES[upper] ?? upper;
}

function isUsdLikeQuote(quote: string): boolean {
  const q = quote.trim().toUpperCase();
  return q === 'USD' || q === 'USDT' || q === 'USDC';
}

function computePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  if (denom <= 1e-12) return 0;
  return Math.max(-1, Math.min(1, num / denom));
}

function alignHourCandles(candlesA: Candle[], candlesB: Candle[]): { a: number; b: number }[] {
  const bucketB = new Map<number, number>();
  for (const c of candlesB) {
    if (c.close > 0) {
      bucketB.set(Math.floor(c.openTime / 3_600_000), c.close);
    }
  }
  const aligned: { a: number; b: number }[] = [];
  for (const c of candlesA) {
    if (c.close <= 0) continue;
    const bClose = bucketB.get(Math.floor(c.openTime / 3_600_000));
    if (bClose !== undefined && bClose > 0) {
      aligned.push({ a: c.close, b: bClose });
    }
  }
  return aligned;
}

async function computeStatArbPairs(): Promise<StatArbPair[]> {
  if (statArbCache && Date.now() - statArbCache.fetchedAt < STAT_ARB_TTL_MS) {
    return statArbCache.pairs;
  }

  const results = await Promise.all(
    STAT_ARB_SPECS.map(async (spec): Promise<StatArbPair | null> => {
      try {
        const [resA, resB] = await Promise.all([
          fetchCandles(spec.exchange, spec.marketType, spec.symbolA, '1h', 72),
          fetchCandles(spec.exchange, spec.marketType, spec.symbolB, '1h', 72),
        ]);

        const aligned = alignHourCandles(resA.candles, resB.candles).slice(-60);
        if (aligned.length < 15) return null;

        const ratios = aligned.map((p) => p.a / p.b);
        const logRatios = aligned.map((p) => Math.log(p.a / p.b));

        const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
        const meanLog = logRatios.reduce((s, v) => s + v, 0) / logRatios.length;
        const variance =
          logRatios.reduce((s, v) => s + (v - meanLog) * (v - meanLog), 0) / logRatios.length;
        const stdLog = Math.sqrt(variance);
        const latestLog = logRatios[logRatios.length - 1];
        const zScore = stdLog > 1e-9 ? (latestLog - meanLog) / stdLog : 0;

        const retA: number[] = [];
        const retB: number[] = [];
        for (let i = 1; i < aligned.length; i++) {
          retA.push(Math.log(aligned[i].a / aligned[i - 1].a));
          retB.push(Math.log(aligned[i].b / aligned[i - 1].b));
        }
        const correlation = computePearsonCorrelation(retA, retB);

        const last = aligned[aligned.length - 1];
        const signal: StatArbPair['signal'] =
          zScore >= 1.5
            ? 'SHORT_A_LONG_B'
            : zScore <= -1.5
              ? 'LONG_A_SHORT_B'
              : 'NEUTRAL';

        return {
          id: spec.id,
          label: spec.label,
          category: spec.category,
          legA: {
            exchange: spec.exchange,
            marketType: spec.marketType,
            symbol: spec.symbolA,
            price: last.a,
          },
          legB: {
            exchange: spec.exchange,
            marketType: spec.marketType,
            symbol: spec.symbolB,
            price: last.b,
          },
          ratio: Number((last.a / last.b).toFixed(6)),
          meanRatio: Number(meanRatio.toFixed(6)),
          zScore: Number(zScore.toFixed(2)),
          correlation: Number(correlation.toFixed(2)),
          signal,
          sampleBars: aligned.length,
        };
      } catch {
        return null;
      }
    }),
  );

  const pairs = results
    .filter((p): p is StatArbPair => p !== null)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  statArbCache = { fetchedAt: Date.now(), pairs };
  return pairs;
}

async function refreshRawScan(): Promise<RawArbitrageCache> {
  const [venueResults, statArbPairs] = await Promise.all([
    Promise.all(
      SPOT_VENUES.map(async (venue) => {
        try {
          const tickers = await getMarketTickers(venue, 'spot');
          return { venue, tickers };
        } catch {
          return { venue, tickers: [] as MarketTicker[] };
        }
      }),
    ),
    computeStatArbPairs(),
  ]);

  const venuesScanned: ExchangeId[] = [];
  // baseAsset -> Map<ExchangeId, MarketTicker> (highest liquidity USD/USDT pair per venue)
  const grouped = new Map<string, Map<ExchangeId, MarketTicker>>();

  for (const { venue, tickers } of venueResults) {
    if (tickers.length > 0) {
      venuesScanned.push(venue);
    }
    for (const t of tickers) {
      if (!isUsdLikeQuote(t.quoteAsset)) continue;
      if (!Number.isFinite(t.lastPrice) || t.lastPrice <= 0) continue;

      const base = normalizeBaseAsset(t.baseAsset);
      // Skip stablecoin-to-stablecoin noise where quote is also USD
      if (base === 'USD' || base === 'USDT' || base === 'USDC' || base === 'DAI' || base === 'FDUSD') {
        continue;
      }

      let byVenue = grouped.get(base);
      if (!byVenue) {
        byVenue = new Map();
        grouped.set(base, byVenue);
      }
      const existing = byVenue.get(venue);
      if (!existing || t.quoteVolume24h > existing.quoteVolume24h) {
        byVenue.set(venue, t);
      }
    }
  }

  const rawOpportunities: Omit<ArbitrageOpportunity, 'netSpreadPct' | 'status'>[] = [];
  const now = Date.now();

  for (const [baseAsset, byVenue] of grouped.entries()) {
    if (byVenue.size < 2) continue;

    const quotes: ArbitrageVenueQuote[] = Array.from(byVenue.values()).map((t) => ({
      exchange: t.exchange,
      displaySymbol: t.displaySymbol,
      price: t.lastPrice,
      bid: t.bid,
      ask: t.ask,
      volume24hUsd: t.quoteVolume24h,
      timestamp: t.timestamp,
    }));

    // Find best cross-venue buy (lowest ask/last) & sell (highest bid/last) pair
    let bestBuy: ArbitrageVenueQuote | null = null;
    let bestSell: ArbitrageVenueQuote | null = null;
    let bestBuyPrice = Infinity;
    let bestSellPrice = -Infinity;
    let bestGrossSpreadPct = -Infinity;

    for (const buyQ of quotes) {
      const buyPx = buyQ.ask && buyQ.ask > 0 ? buyQ.ask : buyQ.price;
      if (buyPx <= 0) continue;
      for (const sellQ of quotes) {
        if (sellQ.exchange === buyQ.exchange) continue;
        const sellPx = sellQ.bid && sellQ.bid > 0 ? sellQ.bid : sellQ.price;
        if (sellPx <= 0) continue;
        const gross = ((sellPx - buyPx) / buyPx) * 100;
        if (gross > bestGrossSpreadPct) {
          bestGrossSpreadPct = gross;
          bestBuy = buyQ;
          bestSell = sellQ;
          bestBuyPrice = buyPx;
          bestSellPrice = sellPx;
        }
      }
    }

    if (!bestBuy || !bestSell || !Number.isFinite(bestGrossSpreadPct)) continue;
    // Guard against distinct tokens colliding on the same ticker symbol across exchanges (> 15% diff)
    if (bestGrossSpreadPct > 15 || bestGrossSpreadPct < -5) continue;

    const minVolume24hUsd = Math.min(bestBuy.volume24hUsd, bestSell.volume24hUsd);
    // Require meaningful liquidity so illiquid dead orderbooks don't clutter results
    if (minVolume24hUsd < 25_000) continue;

    rawOpportunities.push({
      id: `${baseAsset}:${bestBuy.exchange}->${bestSell.exchange}`,
      baseAsset,
      buyExchange: bestBuy.exchange,
      buySymbol: bestBuy.displaySymbol,
      buyPrice: bestBuyPrice,
      sellExchange: bestSell.exchange,
      sellSymbol: bestSell.displaySymbol,
      sellPrice: bestSellPrice,
      grossSpreadPct: Number(bestGrossSpreadPct.toFixed(4)),
      spreadUsd: Number((bestSellPrice - bestBuyPrice).toFixed(6)),
      minVolume24hUsd,
      venueCount: quotes.length,
      venues: quotes.sort((a, b) => a.price - b.price),
      timestamp: now,
    });
  }

  rawCache = {
    fetchedAt: now,
    venuesScanned,
    rawOpportunities,
    statArbPairs,
  };
  return rawCache;
}

export async function scanLiveArbitrage(feeBpsRoundTrip = 20): Promise<ArbitrageScanPayload> {
  const safeFeeBps = Math.max(0, Math.min(200, Number.isFinite(feeBpsRoundTrip) ? feeBpsRoundTrip : 20));

  let data = rawCache;
  if (!data || Date.now() - data.fetchedAt >= CACHE_TTL_MS) {
    if (!inFlightScan) {
      inFlightScan = refreshRawScan().finally(() => {
        inFlightScan = null;
      });
    }
    data = await inFlightScan;
  }

  const feePct = safeFeeBps / 100;
  const opportunities: ArbitrageOpportunity[] = data.rawOpportunities
    .map((opp) => {
      const netSpreadPct = Number((opp.grossSpreadPct - feePct).toFixed(4));
      const status: ArbitrageOpportunity['status'] =
        netSpreadPct > 0 ? 'EXECUTABLE' : opp.grossSpreadPct >= 0.05 ? 'WATCH' : 'TIGHT';
      return {
        ...opp,
        netSpreadPct,
        status,
      };
    })
    .sort((a, b) => {
      if (b.netSpreadPct !== a.netSpreadPct) return b.netSpreadPct - a.netSpreadPct;
      return b.minVolume24hUsd - a.minVolume24hUsd;
    });

  return {
    opportunities,
    statArbPairs: data.statArbPairs,
    venuesScanned: data.venuesScanned,
    feeBpsRoundTrip: safeFeeBps,
    updatedAt: data.fetchedAt,
  };
}

