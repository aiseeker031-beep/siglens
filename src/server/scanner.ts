import { CORE_UNIVERSE_BASES } from '../shared/constants';
import type {
  AlertEventRecord,
  AlertRule,
  ExchangeId,
  MarketType,
  ScreenerRow,
  SignalClassification,
  Timeframe,
} from '../shared/types';
import { detectConfirmedSignalEvents, runFullAssetAnalysis } from '../analytics/signals';
import { validateCandles } from '../analytics/validation';
import {
  getStoredPreferences,
  insertAlertEvent,
  insertSignalEvents,
  listAlertRules,
  upsertAlertRule,
} from './db';
import { fetchCandles, fetchDerivativesOverview, getMarketTickers } from './providers';
import { wsHub } from './wsHub';

interface ScanCacheEntry {
  rows: ScreenerRow[];
  scannedAt: number;
  universeSize: number;
  completedCount: number;
  inProgress: boolean;
}

const scanCache = new Map<string, ScanCacheEntry>();
const lastClassByKey = new Map<string, SignalClassification>();

/**
 * Bounded-concurrency scanner over real public market data.
 * Computes all 10 indicators + deterministic signals + S/R proximity for top liquid assets,
 * persists deduplicated confirmed SignalEvents in SQLite, and evaluates active AlertRules.
 */
export async function runScreenerScan(
  exchange: ExchangeId = 'binance',
  marketType: MarketType = 'spot',
  timeframe: Timeframe = '1h',
  forceRefresh = false,
): Promise<ScanCacheEntry> {
  const key = `${exchange}:${marketType}:${timeframe}`;
  const existing = scanCache.get(key);
  if (existing && !forceRefresh && Date.now() - existing.scannedAt < 45_000 && existing.rows.length > 0) {
    return existing;
  }

  const tickers = await getMarketTickers(exchange, marketType);
  const coreSet = new Set(CORE_UNIVERSE_BASES);
  const prioritized = [
    ...tickers.filter((t) => coreSet.has(t.baseAsset) && (t.quoteAsset === 'USDT' || t.quoteAsset === 'USD')),
    ...tickers.filter((t) => !coreSet.has(t.baseAsset) && (t.quoteAsset === 'USDT' || t.quoteAsset === 'USD')),
  ].slice(0, 20);

  const entry: ScanCacheEntry = {
    rows: existing?.rows ?? [],
    scannedAt: existing?.scannedAt ?? Date.now(),
    universeSize: prioritized.length,
    completedCount: 0,
    inProgress: true,
  };
  scanCache.set(key, entry);

  const prefs = getStoredPreferences();
  const rows: ScreenerRow[] = [];
  const batchSize = 5;

  for (let i = 0; i < prioritized.length; i += batchSize) {
    const batch = prioritized.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const { candles, freshness } = await fetchCandles(
          ticker.exchange,
          ticker.marketType,
          ticker.displaySymbol,
          timeframe,
          220,
        );
        const analysis = runFullAssetAnalysis(candles, {
          canonicalId: ticker.canonicalId,
          exchange: ticker.exchange,
          marketType: ticker.marketType,
          displaySymbol: ticker.displaySymbol,
          timeframe,
          freshness,
          weights: prefs.weights,
          thresholds: prefs.thresholds,
          minCoveragePct: prefs.minCoveragePct,
          minAgreementForStrongPct: prefs.minAgreementForStrongPct,
        });

        const conf = analysis.confirmed;
        const validated = validateCandles(candles, timeframe);
        const completed = validated.completedCandles;
        const lastIdx = completed.length - 1;
        const prevIdx = Math.max(0, lastIdx - 1);

        // Emit deduplicated confirmed events to SQLite
        const prevCls = lastClassByKey.get(`${ticker.canonicalId}:${timeframe}`);
        const events = detectConfirmedSignalEvents(completed, conf, analysis.series, prevCls);
        if (events.length > 0) {
          insertSignalEvents(events);
        }
        lastClassByKey.set(`${ticker.canonicalId}:${timeframe}`, conf.classification);

        const emaInd = conf.indicators.find((x) => x.id === 'ema');
        const rsiInd = conf.indicators.find((x) => x.id === 'rsi');
        const macdInd = conf.indicators.find((x) => x.id === 'macd');
        const adxInd = conf.indicators.find((x) => x.id === 'adx');
        const bbInd = conf.indicators.find((x) => x.id === 'bollinger');
        const obvInd = conf.indicators.find((x) => x.id === 'obv');
        const rvolInd = conf.indicators.find((x) => x.id === 'rvol');
        const atrInd = conf.indicators.find((x) => x.id === 'atr');

        const ema20 = (emaInd?.rawValues.ema20 as number | null) ?? null;
        const ema50 = (emaInd?.rawValues.ema50 as number | null) ?? null;
        const ema200 = (emaInd?.rawValues.ema200 as number | null) ?? null;

        let emaCross: ScreenerRow['emaCross'] = 'NONE';
        const pE20 = analysis.series.ema20[prevIdx];
        const pE50 = analysis.series.ema50[prevIdx];
        const pE200 = analysis.series.ema200[prevIdx];
        if (ema50 !== null && ema200 !== null && pE50 !== null && pE200 !== null) {
          if (pE50 <= pE200 && ema50 > ema200) emaCross = 'GOLDEN';
          else if (pE50 >= pE200 && ema50 < ema200) emaCross = 'DEATH';
        }
        if (emaCross === 'NONE' && ema20 !== null && ema50 !== null && pE20 !== null && pE50 !== null) {
          if (pE20 <= pE50 && ema20 > ema50) emaCross = 'BULLISH_20_50';
          else if (pE20 >= pE50 && ema20 < ema50) emaCross = 'BEARISH_20_50';
        }

        let macdCross: ScreenerRow['macdCross'] = 'NONE';
        const m = analysis.series.macdLine[lastIdx];
        const ms = analysis.series.macdSignal[lastIdx];
        const pm = analysis.series.macdLine[prevIdx];
        const pms = analysis.series.macdSignal[prevIdx];
        if (m !== null && ms !== null && pm !== null && pms !== null) {
          if (pm <= pms && m > ms) macdCross = 'BULLISH';
          else if (pm >= pms && m < ms) macdCross = 'BEARISH';
        }

        const nearSupport = analysis.supportResistance.some(
          (z) => z.type === 'SUPPORT' && Math.abs(z.distancePct) <= 2.5,
        );
        const nearResistance = analysis.supportResistance.some(
          (z) => z.type === 'RESISTANCE' && Math.abs(z.distancePct) <= 2.5,
        );

        const row: ScreenerRow = {
          canonicalId: ticker.canonicalId,
          displaySymbol: ticker.displaySymbol,
          baseAsset: ticker.baseAsset,
          quoteAsset: ticker.quoteAsset,
          exchange: ticker.exchange,
          marketType: ticker.marketType,
          timeframe,
          price: ticker.lastPrice,
          change24hPct: ticker.change24hPct,
          volume24hUsd: ticker.quoteVolume24h,
          spreadPct: ticker.spreadPct,
          classification: conf.classification,
          directionalScore: conf.directionalScore,
          agreementPct: conf.agreement.agreementPct,
          rsi14: (rsiInd?.rawValues.rsi14 as number | null) ?? null,
          macdHist: (macdInd?.rawValues.histogram as number | null) ?? null,
          macdCross,
          adx14: (adxInd?.rawValues.adx14 as number | null) ?? null,
          rvol20: (rvolInd?.rawValues.rvol20 as number | null) ?? null,
          atrPct: (atrInd?.rawValues.atrPct as number | null) ?? null,
          bbSqueeze: Boolean(bbInd?.rawValues.squeeze),
          bbExpanding: Boolean(bbInd?.rawValues.expanding),
          aboveEma20: ema20 !== null ? ticker.lastPrice > ema20 : null,
          aboveEma50: ema50 !== null ? ticker.lastPrice > ema50 : null,
          aboveEma200: ema200 !== null ? ticker.lastPrice > ema200 : null,
          emaCross,
          rsiDivergence: (rsiInd?.rawValues.divergence as ScreenerRow['rsiDivergence']) ?? 'NONE',
          obvDivergence: (obvInd?.rawValues.divergence as ScreenerRow['obvDivergence']) ?? 'NONE',
          nearSupport,
          nearResistance,
          regime: conf.regime.trendRegime,
          signalSetup: (analysis.provisional ?? conf).signalSetup,
          updatedAt: Date.now(),
        };
        return row;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') rows.push(r.value);
    }
    entry.completedCount = Math.min(prioritized.length, i + batch.length);
  }

  const finalEntry: ScanCacheEntry = {
    rows,
    scannedAt: Date.now(),
    universeSize: prioritized.length,
    completedCount: prioritized.length,
    inProgress: false,
  };
  scanCache.set(key, finalEntry);

  // Evaluate active user alert rules against freshly scanned rows
  evaluateAlertsAgainstScan(rows).catch(() => {});

  return finalEntry;
}

export async function evaluateAlertsAgainstScan(rows: ScreenerRow[]): Promise<AlertEventRecord[]> {
  const rules = listAlertRules().filter((r) => r.enabled);
  if (rules.length === 0) return [];

  const rowMap = new Map<string, ScreenerRow>();
  for (const row of rows) rowMap.set(row.canonicalId, row);

  let derivMap = new Map<string, number>();
  if (rules.some((r) => r.condition === 'FUNDING_ABOVE' || r.condition === 'FUNDING_BELOW')) {
    try {
      const d = await fetchDerivativesOverview();
      d.markets.forEach((m) => derivMap.set(m.displaySymbol, m.fundingRatePct));
    } catch {
      // ignore if unavailable
    }
  }

  const now = Date.now();
  const fired: AlertEventRecord[] = [];

  for (const rule of rules) {
    // Respect cooldown
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMinutes * 60_000) {
      continue;
    }

    const row = rowMap.get(rule.canonicalId);
    const result = checkAlertCondition(rule, row, derivMap.get(rule.displaySymbol));
    if (!result.triggered) continue;

    const ev: AlertEventRecord = {
      id: `alert-ev-${rule.id}-${Math.floor(now / 60_000)}`,
      ruleId: rule.id,
      canonicalId: rule.canonicalId,
      displaySymbol: rule.displaySymbol,
      timeframe: rule.timeframe,
      condition: rule.condition,
      message: result.message,
      triggeredValue: result.value,
      triggeredAt: now,
      acknowledged: false,
    };

    insertAlertEvent(ev);
    fired.push(ev);

    upsertAlertRule({
      ...rule,
      lastTriggeredAt: now,
      enabled: rule.recurring ? true : false,
    });

    wsHub.broadcast({
      type: 'alert:triggered',
      event: ev,
    });

    // Optional user-configured webhook delivery (HTTPS only)
    if (rule.webhookUrl && rule.webhookUrl.startsWith('https://')) {
      fetch(rule.webhookUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'CRYPTOLENS', event: ev }),
      }).catch(() => {});
    }
  }

  return fired;
}

function checkAlertCondition(
  rule: AlertRule,
  row: ScreenerRow | undefined,
  fundingPct?: number,
): { triggered: boolean; value: number | null; message: string } {
  const th = rule.threshold ?? 0;

  if (rule.condition === 'FUNDING_ABOVE' && fundingPct !== undefined && fundingPct >= th) {
    return {
      triggered: true,
      value: fundingPct,
      message: `${rule.displaySymbol} funding rate (${fundingPct.toFixed(4)}%) exceeded ${th}%.`,
    };
  }
  if (rule.condition === 'FUNDING_BELOW' && fundingPct !== undefined && fundingPct <= th) {
    return {
      triggered: true,
      value: fundingPct,
      message: `${rule.displaySymbol} funding rate (${fundingPct.toFixed(4)}%) dropped below ${th}%.`,
    };
  }

  if (!row) return { triggered: false, value: null, message: '' };

  switch (rule.condition) {
    case 'PRICE_ABOVE':
      if (row.price >= th) {
        return { triggered: true, value: row.price, message: `${rule.displaySymbol} price ($${row.price}) rose above $${th}.` };
      }
      break;
    case 'PRICE_BELOW':
      if (row.price <= th) {
        return { triggered: true, value: row.price, message: `${rule.displaySymbol} price ($${row.price}) dropped below $${th}.` };
      }
      break;
    case 'PCT_CHANGE_ABOVE':
      if (row.change24hPct >= th) {
        return { triggered: true, value: row.change24hPct, message: `${rule.displaySymbol} 24h change (${row.change24hPct.toFixed(2)}%) exceeded +${th}%.` };
      }
      break;
    case 'PCT_CHANGE_BELOW':
      if (row.change24hPct <= th) {
        return { triggered: true, value: row.change24hPct, message: `${rule.displaySymbol} 24h change (${row.change24hPct.toFixed(2)}%) fell below ${th}%.` };
      }
      break;
    case 'RVOL_ABOVE':
      if (row.rvol20 !== null && row.rvol20 >= th) {
        return { triggered: true, value: row.rvol20, message: `${rule.displaySymbol} RVOL spiked to ${row.rvol20.toFixed(2)}x (>= ${th}x).` };
      }
      break;
    case 'RSI_BELOW':
      if (row.rsi14 !== null && row.rsi14 <= th) {
        return { triggered: true, value: row.rsi14, message: `${rule.displaySymbol} RSI 14 dropped to ${row.rsi14.toFixed(1)} (<= ${th}).` };
      }
      break;
    case 'RSI_ABOVE':
      if (row.rsi14 !== null && row.rsi14 >= th) {
        return { triggered: true, value: row.rsi14, message: `${rule.displaySymbol} RSI 14 climbed to ${row.rsi14.toFixed(1)} (>= ${th}).` };
      }
      break;
    case 'ADX_ABOVE':
      if (row.adx14 !== null && row.adx14 >= th) {
        return { triggered: true, value: row.adx14, message: `${rule.displaySymbol} ADX 14 strengthened to ${row.adx14.toFixed(1)} (>= ${th}).` };
      }
      break;
    case 'MACD_BULLISH_CROSS':
      if (row.macdCross === 'BULLISH') {
        return { triggered: true, value: row.macdHist, message: `${rule.displaySymbol} confirmed bullish MACD crossover.` };
      }
      break;
    case 'MACD_BEARISH_CROSS':
      if (row.macdCross === 'BEARISH') {
        return { triggered: true, value: row.macdHist, message: `${rule.displaySymbol} confirmed bearish MACD crossover.` };
      }
      break;
    case 'EMA_BULLISH_CROSS':
      if (row.emaCross === 'GOLDEN' || row.emaCross === 'BULLISH_20_50') {
        return { triggered: true, value: row.price, message: `${rule.displaySymbol} triggered bullish EMA crossover (${row.emaCross}).` };
      }
      break;
    case 'EMA_BEARISH_CROSS':
      if (row.emaCross === 'DEATH' || row.emaCross === 'BEARISH_20_50') {
        return { triggered: true, value: row.price, message: `${rule.displaySymbol} triggered bearish EMA crossover (${row.emaCross}).` };
      }
      break;
    case 'SIGNAL_STRONG_BULLISH':
      if (row.classification === 'STRONG_BULLISH') {
        return { triggered: true, value: row.directionalScore, message: `${rule.displaySymbol} reached Strong Bullish (${row.directionalScore}).` };
      }
      break;
    case 'SIGNAL_STRONG_BEARISH':
      if (row.classification === 'STRONG_BEARISH') {
        return { triggered: true, value: row.directionalScore, message: `${rule.displaySymbol} reached Strong Bearish (${row.directionalScore}).` };
      }
      break;
    default:
      break;
  }

  return { triggered: false, value: null, message: '' };
}

let backgroundInterval: NodeJS.Timeout | null = null;

export function startBackgroundScanner(): void {
  // Initial warm scan shortly after startup so Overview, Screener & Signal Feed populate swiftly
  setTimeout(() => {
    runScreenerScan('binance', 'spot', '1h', false).catch(() => {});
  }, 1500);

  // Refresh every 90 seconds in background
  backgroundInterval = setInterval(() => {
    runScreenerScan('binance', 'spot', '1h', true).catch(() => {});
  }, 90_000);
}

export function stopBackgroundScanner(): void {
  if (backgroundInterval) clearInterval(backgroundInterval);
}
