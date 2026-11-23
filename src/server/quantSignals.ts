import { computeAllIndicatorSeries } from '../analytics/indicators';
import { runFullAssetAnalysis } from '../analytics/signals';
import { toCompactTicker } from '../analytics/signalSetup';
import { validateCandles } from '../analytics/validation';
import { EXCHANGE_TIMEFRAMES } from '../shared/constants';
import type {
  Candle,
  ExchangeId,
  MarketIntelligenceSnapshot,
  MarketType,
  QuantHistoricalEdge,
  QuantSignalGrade,
  QuantSignalRow,
  QuantSignalsPayload,
  SignalSetupPlan,
  SignalTakeProfitTarget,
  SupportResistanceZone,
  Timeframe,
} from '../shared/types';
import { getAssetSentimentContext, getMarketIntelligence } from './marketIntel';
import { fetchCandles, getMarketTickers } from './providers';
import { getStoredPreferences } from './db';

const QUANT_CACHE_TTL_MS = 45_000;
const quantCache = new Map<string, { payload: QuantSignalsPayload; expiresAt: number }>();
const quantInFlight = new Map<string, Promise<QuantSignalsPayload>>();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function roundPrice(price: number): number {
  if (!Number.isFinite(price)) return 0;
  const abs = Math.abs(price);
  if (abs >= 1000) return Number(price.toFixed(2));
  if (abs >= 1) return Number(price.toFixed(4));
  if (abs >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(8));
}

export function resolveHigherTimeframe(
  exchange: ExchangeId,
  timeframe: Timeframe,
): Timeframe | null {
  const supported = EXCHANGE_TIMEFRAMES[exchange] ?? ['15m', '1h', '4h', '1d'];
  const preferredMap: Record<Timeframe, Timeframe[]> = {
    '1m': ['15m', '1h', '4h'],
    '3m': ['15m', '1h', '4h'],
    '5m': ['1h', '4h', '6h', '1d'],
    '15m': ['4h', '6h', '1h', '1d'],
    '30m': ['4h', '6h', '1d'],
    '1h': ['4h', '6h', '1d'],
    '2h': ['1d', '4h'],
    '4h': ['1d', '1w'],
    '6h': ['1d', '1w'],
    '12h': ['1d', '1w'],
    '1d': ['1w'],
    '1w': [],
  };
  for (const cand of preferredMap[timeframe] ?? []) {
    if (cand !== timeframe && supported.includes(cand)) return cand;
  }
  return null;
}

// =========================================================================
// 1. CAUSAL WALK-FORWARD HISTORICAL TRADE SIMULATOR (ZERO LOOKAHEAD)
// =========================================================================

/**
 * Walks causally across completed historical candles and simulates realistic
 * trend-aligned trades in `targetDirection` using anti-wick 2.0x ATR stop loss,
 * partial 50% take-profit at 1.5R (moving SL to breakeven), and final target at 2.6R.
 * Conservative intrabar rule: if SL and TP both fall inside the same bar, SL hits first.
 */
export function simulateHistoricalEdge(
  completedCandles: Candle[],
  targetDirection: 'BUY' | 'SELL',
): QuantHistoricalEdge {
  if (completedCandles.length < 75) {
    return {
      sampleTrades: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      expectancyR: null,
      profitFactor: null,
      avgWinR: null,
      avgLossR: null,
      passed: true,
      note: 'Insufficient historical bars for walk-forward simulation; relying on live multi-factor gates.',
    };
  }

  const { series } = computeAllIndicatorSeries(completedCandles);
  const startIdx = 52;
  const maxHorizon = 24;
  const endIdx = completedCandles.length - 8;

  const realizedRs: number[] = [];
  let nextAllowedIdx = startIdx;

  for (let i = startIdx; i < endIdx; i++) {
    if (i < nextAllowedIdx) continue;

    const close = completedCandles[i].close;
    const ema20 = series.ema20[i];
    const ema50 = series.ema50[i];
    const rsi = series.rsi14[i];
    const macdHist = series.macdHist[i];
    const adx = series.adx14[i];
    const atr = series.atr14[i];
    const vwap = series.vwap[i];

    if (
      ema20 === null ||
      ema50 === null ||
      rsi === null ||
      macdHist === null ||
      adx === null ||
      atr === null ||
      atr <= 0
    ) {
      continue;
    }

    // Only trigger when trend exists (ADX >= 18) and bar is not severely overextended
    if (adx < 18) continue;
    const distAtr = Math.abs(close - ema20) / atr;
    if (distAtr > 2.2) continue;

    let triggerMatch = false;
    if (targetDirection === 'BUY') {
      const emaAligned = close > ema20 && ema20 > ema50;
      const momOk = macdHist > 0 && rsi >= 48 && rsi <= 72;
      const vwapOk = vwap === null || close >= vwap * 0.996;
      triggerMatch = emaAligned && momOk && vwapOk;
    } else {
      const emaAligned = close < ema20 && ema20 < ema50;
      const momOk = macdHist < 0 && rsi <= 52 && rsi >= 28;
      const vwapOk = vwap === null || close <= vwap * 1.004;
      triggerMatch = emaAligned && momOk && vwapOk;
    }

    if (!triggerMatch) continue;

    // Simulate trade execution forward strictly on bars j > i
    const entry = close;
    const risk = atr * 2.0;
    let currentSl = targetDirection === 'BUY' ? entry - risk : entry + risk;
    const tp1 = targetDirection === 'BUY' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = targetDirection === 'BUY' ? entry + risk * 2.6 : entry - risk * 2.6;

    let hitTp1 = false;
    let tradeR: number | null = null;
    const lastBar = Math.min(completedCandles.length - 1, i + maxHorizon);

    for (let j = i + 1; j <= lastBar; j++) {
      const bar = completedCandles[j];
      if (targetDirection === 'BUY') {
        // Conservative: check stop loss first on the same candle
        if (bar.low <= currentSl) {
          tradeR = hitTp1 ? 0.75 : -1.0; // If TP1 was hit (50% @ +1.5R = +0.75R) & remainder stopped at BE (0R)
          break;
        }
        if (!hitTp1 && bar.high >= tp1) {
          hitTp1 = true;
          currentSl = entry; // Move stop to breakeven
        }
        if (bar.high >= tp2) {
          tradeR = 0.5 * 1.5 + 0.5 * 2.6; // +2.05R
          break;
        }
      } else {
        if (bar.high >= currentSl) {
          tradeR = hitTp1 ? 0.75 : -1.0;
          break;
        }
        if (!hitTp1 && bar.low <= tp1) {
          hitTp1 = true;
          currentSl = entry;
        }
        if (bar.low <= tp2) {
          tradeR = 2.05;
          break;
        }
      }
    }

    if (tradeR === null) {
      const exitClose = completedCandles[lastBar].close;
      const remR =
        targetDirection === 'BUY' ? (exitClose - entry) / risk : (entry - exitClose) / risk;
      tradeR = hitTp1 ? 0.75 + 0.5 * remR : remR;
    }

    // Subtract realistic 0.08R round-trip fee + slippage drag
    const netR = Number((tradeR - 0.08).toFixed(3));
    realizedRs.push(netR);

    // Cooldown of 6 bars to avoid duplicate overlapping trades
    nextAllowedIdx = i + 6;
  }

  const sampleTrades = realizedRs.length;
  if (sampleTrades === 0) {
    return {
      sampleTrades: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      expectancyR: null,
      profitFactor: null,
      avgWinR: null,
      avgLossR: null,
      passed: true,
      note: `No prior ${targetDirection} trend triggers in the last ${completedCandles.length} bars (fresh regime shift).`,
    };
  }

  const winRs = realizedRs.filter((r) => r > 0);
  const lossRs = realizedRs.filter((r) => r <= 0);
  const wins = winRs.length;
  const losses = lossRs.length;
  const winRatePct = Number(((wins / sampleTrades) * 100).toFixed(1));
  const expectancyR = Number(
    (realizedRs.reduce((sum, r) => sum + r, 0) / sampleTrades).toFixed(2),
  );
  const grossWin = winRs.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(lossRs.reduce((sum, r) => sum + r, 0));
  const profitFactor =
    grossLoss > 0
      ? Number((grossWin / grossLoss).toFixed(2))
      : grossWin > 0
        ? 9.99
        : 0;
  const avgWinR = wins > 0 ? Number((grossWin / wins).toFixed(2)) : null;
  const avgLossR = losses > 0 ? Number((grossLoss / losses).toFixed(2)) : null;

  const passed = sampleTrades < 3 ? true : winRatePct >= 42 && expectancyR >= 0.05;
  const note =
    sampleTrades < 3
      ? `${sampleTrades} historical ${targetDirection} setup(s) in window (${winRatePct}% win, ${expectancyR >= 0 ? '+' : ''}${expectancyR}R) — small sample.`
      : passed
        ? `Positive walk-forward edge: ${wins}/${sampleTrades} wins (${winRatePct}%), expectancy ${expectancyR >= 0 ? '+' : ''}${expectancyR}R, PF ${profitFactor}.`
        : `Negative historical edge: ${wins}/${sampleTrades} wins (${winRatePct}%), expectancy ${expectancyR >= 0 ? '+' : ''}${expectancyR}R — filtered to avoid losses.`;

  return {
    sampleTrades,
    wins,
    losses,
    winRatePct,
    expectancyR,
    profitFactor,
    avgWinR,
    avgLossR,
    passed,
    note,
  };
}

// =========================================================================
// 2. ANTI-WICK, ANTI-CHASE QUANT TRADE SETUP BUILDER
// =========================================================================

function buildQuantSignalSetup(params: {
  displaySymbol: string;
  action: 'BUY' | 'SELL' | 'WAIT';
  closePrice: number;
  atr14: number | null;
  ema20: number | null;
  vwap: number | null;
  srZones: SupportResistanceZone[];
  overextended: boolean;
  eventRiskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  rejectionSummary?: string;
}): SignalSetupPlan {
  const symbol = toCompactTicker(params.displaySymbol);
  const price = params.closePrice;

  if (params.action === 'WAIT' || !Number.isFinite(price) || price <= 0) {
    return {
      symbol,
      direction: 'WAIT',
      directionLabel: 'NEUTRAL (WAIT)',
      entryMode: 'ZONE',
      entryPrice: Number.isFinite(price) && price > 0 ? roundPrice(price) : null,
      entryZoneLow: null,
      entryZoneHigh: null,
      stopLoss: null,
      stopLossPct: null,
      takeProfits: [],
      riskRewardTp2: null,
      atr14: params.atr14,
      methodology:
        params.rejectionSummary ||
        'Blocked by multi-factor quant filters (HTF trend, historical expectancy, chop, or event risk).',
    };
  }

  const isBuy = params.action === 'BUY';
  const atr =
    params.atr14 !== null && Number.isFinite(params.atr14) && params.atr14 > 0
      ? params.atr14
      : price * 0.01;

  // Anti-Chase: If price is stretched away from EMA20/VWAP, require pullback limit zone!
  const entryMode: 'NOW' | 'ZONE' = params.overextended ? 'ZONE' : 'NOW';
  let entryPrice = price;
  let entryZoneLow = price - atr * 0.25;
  let entryZoneHigh = price + atr * 0.25;

  if (params.overextended) {
    const anchors = [params.ema20, params.vwap].filter(
      (v): v is number => v !== null && Number.isFinite(v) && v > 0,
    );
    const pullAnchor =
      anchors.length > 0
        ? isBuy
          ? Math.min(...anchors)
          : Math.max(...anchors)
        : isBuy
          ? price - atr * 0.9
          : price + atr * 0.9;

    if (isBuy) {
      const clampedAnchor = clamp(pullAnchor, price - atr * 1.5, price - atr * 0.35);
      entryZoneLow = Math.max(price * 0.5, clampedAnchor - atr * 0.25);
      entryZoneHigh = Math.min(price - atr * 0.1, clampedAnchor + atr * 0.35);
    } else {
      const clampedAnchor = clamp(pullAnchor, price + atr * 0.35, price + atr * 1.5);
      entryZoneLow = Math.max(price + atr * 0.1, clampedAnchor - atr * 0.35);
      entryZoneHigh = clampedAnchor + atr * 0.25;
    }
    entryPrice = (entryZoneLow + entryZoneHigh) / 2;
  }

  // Anti-Wick Stop Loss: 1.9x ATR baseline (+0.35x ATR cushion during HIGH macro event risk)
  const baseSlMult = params.eventRiskLevel === 'HIGH' ? 2.25 : 1.9;
  const minSlMult = 1.4;
  const maxSlMult = 2.9;
  let rawSl = isBuy ? entryPrice - atr * baseSlMult : entryPrice + atr * baseSlMult;
  let slNote = `${baseSlMult.toFixed(2)}× ATR anti-wick stop`;

  if (isBuy) {
    const validSupports = params.srZones
      .filter((z) => z.type === 'SUPPORT' && z.zoneLow < entryPrice)
      .map((z) => z.zoneLow - atr * 0.35)
      .filter((lvl) => {
        const dist = entryPrice - lvl;
        return lvl > 0 && dist >= atr * minSlMult && dist <= atr * maxSlMult;
      })
      .sort((a, b) => b - a);
    if (validSupports.length > 0) {
      rawSl = validSupports[0];
      slNote = 'structural support − 0.35× ATR anti-wick buffer';
    }
    rawSl = Math.max(entryPrice * 0.1, Math.min(rawSl, entryPrice - atr * minSlMult));
  } else {
    const validRes = params.srZones
      .filter((z) => z.type === 'RESISTANCE' && z.zoneHigh > entryPrice)
      .map((z) => z.zoneHigh + atr * 0.35)
      .filter((lvl) => {
        const dist = lvl - entryPrice;
        return dist >= atr * minSlMult && dist <= atr * maxSlMult;
      })
      .sort((a, b) => a - b);
    if (validRes.length > 0) {
      rawSl = validRes[0];
      slNote = 'structural resistance + 0.35× ATR anti-wick buffer';
    }
    rawSl = Math.max(rawSl, entryPrice + atr * minSlMult);
  }

  const riskUnit = Math.abs(entryPrice - rawSl);

  // Asymmetric Take Profit ladder: 1.5R / 2.5R / 3.5R for positive mathematical expectancy
  const targets: { label: 'TP1' | 'TP2' | 'TP3'; mult: number }[] = [
    { label: 'TP1', mult: 1.5 },
    { label: 'TP2', mult: 2.5 },
    { label: 'TP3', mult: 3.5 },
  ];

  const takeProfits: SignalTakeProfitTarget[] = targets.map(({ label, mult }) => {
    const rawTarget = isBuy
      ? entryPrice + riskUnit * mult
      : Math.max(entryPrice * 0.05, entryPrice - riskUnit * mult);
    const roundedTarget = roundPrice(rawTarget);
    const pctFromEntry = Number((((roundedTarget - entryPrice) / entryPrice) * 100).toFixed(2));
    const rrRatio = Number((Math.abs(roundedTarget - entryPrice) / Math.max(riskUnit, 1e-12)).toFixed(2));
    return { label, price: roundedTarget, pctFromEntry, rrRatio };
  });

  const roundedEntry = roundPrice(entryPrice);
  const roundedLow = roundPrice(Math.max(entryZoneLow, 0));
  const roundedHigh = roundPrice(entryZoneHigh);
  const roundedSl = roundPrice(rawSl);
  const stopLossPct = Number((((roundedSl - roundedEntry) / roundedEntry) * 100).toFixed(2));

  return {
    symbol,
    direction: isBuy ? 'BUY' : 'SELL',
    directionLabel: isBuy ? 'BUY (LONG)' : 'SELL (SHORT)',
    entryMode,
    entryPrice: roundedEntry,
    entryZoneLow: Math.min(roundedLow, roundedHigh),
    entryZoneHigh: Math.max(roundedLow, roundedHigh),
    stopLoss: roundedSl,
    stopLossPct,
    takeProfits,
    riskRewardTp2: takeProfits[1]?.rrRatio ?? 2.5,
    atr14: params.atr14,
    methodology: `${entryMode === 'ZONE' ? 'Anti-Chase Pullback Limit' : 'Trend Execution'} · ${slNote} · 1.5R / 2.5R / 3.5R targets.`,
  };
}

// =========================================================================
// 3. PURE PER-ASSET 4-PILLAR QUANT EVALUATOR (TESTABLE UNIT)
// =========================================================================

export function evaluateQuantAsset(params: {
  canonicalId: string;
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  htfTimeframe: Timeframe | null;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  candles: Candle[];
  htfCandles: Candle[] | null;
  intel: MarketIntelligenceSnapshot;
}): QuantSignalRow {
  const nowMs = Date.now();
  const prefs = getStoredPreferences();

  // Analyze Higher Timeframe first
  let htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let htfDirectionalScore = 0;
  let htfClassification: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH' | 'INSUFFICIENT_DATA' | null = null;

  if (params.htfCandles && params.htfCandles.length >= 40 && params.htfTimeframe) {
    const htfAnalysis = runFullAssetAnalysis(params.htfCandles, {
      canonicalId: params.canonicalId,
      exchange: params.exchange,
      marketType: params.marketType,
      displaySymbol: params.displaySymbol,
      timeframe: params.htfTimeframe,
      freshness: 'LIVE',
      weights: prefs.weights,
      thresholds: prefs.thresholds,
    });
    htfDirectionalScore = htfAnalysis.confirmed.directionalScore;
    htfClassification = htfAnalysis.confirmed.classification;
    if (htfDirectionalScore >= 14) htfBias = 'BULLISH';
    else if (htfDirectionalScore <= -14) htfBias = 'BEARISH';
    else htfBias = 'NEUTRAL';
  }

  // Analyze active timeframe
  const analysis = runFullAssetAnalysis(params.candles, {
    canonicalId: params.canonicalId,
    exchange: params.exchange,
    marketType: params.marketType,
    displaySymbol: params.displaySymbol,
    timeframe: params.timeframe,
    freshness: 'LIVE',
    weights: prefs.weights,
    thresholds: prefs.thresholds,
    minCoveragePct: prefs.minCoveragePct,
    minAgreementForStrongPct: prefs.minAgreementForStrongPct,
    higherTimeframeBias: htfClassification,
  });

  const confirmed = analysis.confirmed;
  const validated = validateCandles(params.candles, params.timeframe);
  const completed = validated.completedCandles;
  const { series } = computeAllIndicatorSeries(completed);
  const lastIdx = completed.length - 1;

  const closePrice =
    Number.isFinite(params.price) && params.price > 0
      ? params.price
      : lastIdx >= 0
        ? completed[lastIdx].close
        : 0;
  const ema20 = lastIdx >= 0 ? series.ema20[lastIdx] : null;
  const vwap = lastIdx >= 0 ? series.vwap[lastIdx] : null;
  const atr14 = lastIdx >= 0 ? series.atr14[lastIdx] : null;
  const atrPct = lastIdx >= 0 ? series.atrPct[lastIdx] : null;
  const adx14 = lastIdx >= 0 ? series.adx14[lastIdx] : null;
  const rsi14 = lastIdx >= 0 ? series.rsi14[lastIdx] : null;
  const rvol20 = lastIdx >= 0 ? series.rvol20[lastIdx] : null;
  const srZones = analysis.supportResistance;

  const dirScore = confirmed.directionalScore;
  const agreementPct = confirmed.agreement.agreementPct;

  // Determine raw technical direction (requires clear signal >= 20, not noise)
  let rawDirection: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (dirScore >= 20) rawDirection = 'BUY';
  else if (dirScore <= -20) rawDirection = 'SELL';

  // Anti-Chase Overextension Check
  const distanceAtrFromEma20 =
    ema20 !== null && atr14 !== null && atr14 > 0
      ? Number(((closePrice - ema20) / atr14).toFixed(2))
      : null;

  const overextended =
    rawDirection === 'BUY'
      ? (distanceAtrFromEma20 !== null && distanceAtrFromEma20 > 1.8) ||
        (rsi14 !== null && rsi14 > 73)
      : rawDirection === 'SELL'
        ? (distanceAtrFromEma20 !== null && distanceAtrFromEma20 < -1.8) ||
          (rsi14 !== null && rsi14 < 27)
        : false;

  // Pillar 1: Technical Score (0..100)
  let technicalScore = clamp(
    Math.round(
      Math.min(100, Math.abs(dirScore) * 1.15) * 0.55 +
        agreementPct * 0.35 +
        (adx14 !== null ? clamp((adx14 - 12) * 3.2, 0, 100) : 40) * 0.1,
    ),
    0,
    100,
  );
  if (rvol20 !== null && rvol20 >= 1.35) technicalScore = Math.min(100, technicalScore + 5);
  if (overextended) technicalScore = Math.max(0, technicalScore - 12);

  // Pillar 2: Higher-Timeframe Alignment Score (0..100)
  const htfAligned =
    rawDirection === 'NEUTRAL'
      ? false
      : (rawDirection === 'BUY' && htfBias === 'BULLISH') ||
        (rawDirection === 'SELL' && htfBias === 'BEARISH');
  const htfOpposed =
    (rawDirection === 'BUY' && htfBias === 'BEARISH') ||
    (rawDirection === 'SELL' && htfBias === 'BULLISH');

  const htfScore =
    rawDirection === 'NEUTRAL'
      ? 40
      : htfAligned
        ? clamp(Math.round(72 + Math.min(28, Math.abs(htfDirectionalScore) * 0.45)), 72, 100)
        : htfOpposed
          ? clamp(Math.round(28 - Math.min(20, Math.abs(htfDirectionalScore) * 0.3)), 8, 28)
          : 56; // HTF Neutral

  // Pillar 3: Historical Walk-Forward Edge
  const historicalEdge: QuantHistoricalEdge =
    rawDirection === 'NEUTRAL'
      ? {
          sampleTrades: 0,
          wins: 0,
          losses: 0,
          winRatePct: null,
          expectancyR: null,
          profitFactor: null,
          avgWinR: null,
          avgLossR: null,
          passed: false,
          note: 'No active directional signal to backtest.',
        }
      : simulateHistoricalEdge(completed, rawDirection);

  let historicalScore = 52;
  if (historicalEdge.sampleTrades >= 3 && historicalEdge.winRatePct !== null && historicalEdge.expectancyR !== null) {
    const wrPart = clamp((historicalEdge.winRatePct - 25) * 1.4, 0, 60);
    const expPart = clamp((historicalEdge.expectancyR + 0.35) * 45, 0, 40);
    historicalScore = clamp(Math.round(wrPart + expPart), 0, 100);
  } else if (historicalEdge.sampleTrades > 0 && historicalEdge.expectancyR !== null) {
    historicalScore = clamp(Math.round(52 + historicalEdge.expectancyR * 18), 30, 75);
  }

  // Pillar 4: Social Media, News Catalysts & Derivatives Crowd Positioning
  const assetSent = getAssetSentimentContext(params.baseAsset, params.intel);
  const directionalSentAlignment =
    rawDirection === 'BUY'
      ? assetSent.score
      : rawDirection === 'SELL'
        ? -assetSent.score
        : 0;
  let sentimentScore = clamp(Math.round(54 + directionalSentAlignment * 0.55), 5, 100);
  if (assetSent.blocksLong && rawDirection === 'BUY') sentimentScore = 5;
  if (assetSent.blocksShort && rawDirection === 'SELL') sentimentScore = 10;

  // Weighted 4-Pillar Alpha Score (0..100)
  const rawAlphaScore = clamp(
    Math.round(
      technicalScore * 0.35 +
        htfScore * 0.25 +
        historicalScore * 0.25 +
        sentimentScore * 0.15,
    ),
    0,
    100,
  );

  // =========================================================================
  // MULTI-FACTOR QUALITY GATES (HARD PROTECTION AGAINST LOSING SIGNALS)
  // =========================================================================
  const gatesPassed: string[] = [];
  const rejectionReasons: string[] = [];

  if (rawDirection === 'NEUTRAL') {
    rejectionReasons.push(
      `Weak technical consensus (score ${dirScore > 0 ? '+' : ''}${dirScore}, requires ≥ ±20).`,
    );
  } else {
    gatesPassed.push(
      `Technical Confluence (${dirScore > 0 ? '+' : ''}${dirScore}, ${agreementPct}% agreement)`,
    );
  }

  // Gate 1: Chop / Sideways Filter (ADX < 18 causes whipsaw stop-outs)
  if (adx14 !== null && adx14 < 18) {
    rejectionReasons.push(`Choppy sideways market (ADX ${adx14.toFixed(1)} < 18 — whipsaw risk).`);
  } else if (adx14 !== null) {
    gatesPassed.push(`Trend Strength Confirmed (ADX ${adx14.toFixed(1)})`);
  }

  // Gate 2: Higher-Timeframe Alignment Filter
  if (rawDirection !== 'NEUTRAL') {
    if (htfOpposed) {
      const eliteReversal = Math.abs(dirScore) >= 68 && agreementPct >= 75;
      if (!eliteReversal) {
        rejectionReasons.push(
          `Counter-trend vs ${params.htfTimeframe ?? 'HTF'} (${htfBias}) — trading against primary trend blocked.`,
        );
      } else {
        gatesPassed.push(`Extreme Reversal Override vs ${params.htfTimeframe ?? 'HTF'}`);
      }
    } else if (htfAligned) {
      gatesPassed.push(`HTF ${params.htfTimeframe ?? ''} Aligned (${htfBias})`);
    } else {
      gatesPassed.push(`HTF ${params.htfTimeframe ?? ''} Neutral (No Conflict)`);
    }
  }

  // Gate 3: Walk-Forward Historical Edge Filter
  if (rawDirection !== 'NEUTRAL') {
    if (historicalEdge.sampleTrades >= 3 && !historicalEdge.passed) {
      rejectionReasons.push(
        `Negative historical edge (${historicalEdge.winRatePct}% win, ${historicalEdge.expectancyR}R across ${historicalEdge.sampleTrades} trades).`,
      );
    } else if (historicalEdge.sampleTrades >= 3) {
      gatesPassed.push(
        `Historical Edge +${historicalEdge.expectancyR}R (${historicalEdge.winRatePct}% win / ${historicalEdge.sampleTrades} trades)`,
      );
    }
  }

  // Gate 4: News Shock & Macro Event Risk Shield
  if (rawDirection === 'BUY' && assetSent.blocksLong) {
    rejectionReasons.push(`Shock catalyst blocks LONG: ${assetSent.shockWarning}`);
  } else if (rawDirection === 'SELL' && assetSent.blocksShort) {
    rejectionReasons.push('Active bullish ETF catalyst blocks blind SHORT entry.');
  } else {
    gatesPassed.push('No Active Negative Shock Catalyst');
  }

  if (params.intel.eventRiskLevel === 'HIGH' && rawAlphaScore < 72 && rawDirection !== 'NEUTRAL') {
    rejectionReasons.push(
      `High-impact macro event imminent (${params.intel.eventRiskSummary}) — requires Alpha ≥ 72.`,
    );
  } else if (params.intel.eventRiskLevel === 'LOW') {
    gatesPassed.push('Clear Macro Event Window');
  }

  // Gate 5: Minimum Agreement Guard
  if (rawDirection !== 'NEUTRAL' && agreementPct < 55) {
    rejectionReasons.push(`Low indicator agreement (${agreementPct}% < 55% minimum).`);
  }

  // Final Grade & Action Decision
  const hasHardRejection = rejectionReasons.length > 0;
  let grade: QuantSignalGrade;
  let action: 'BUY' | 'SELL' | 'WAIT';
  let finalAlphaScore = rawAlphaScore;

  if (hasHardRejection || rawDirection === 'NEUTRAL') {
    grade = rawDirection === 'NEUTRAL' ? 'C' : 'BLOCKED';
    action = 'WAIT';
    finalAlphaScore = Math.min(rawAlphaScore, 54);
  } else if (rawAlphaScore >= 80) {
    grade = 'A+';
    action = rawDirection;
  } else if (rawAlphaScore >= 70) {
    grade = 'A';
    action = rawDirection;
  } else if (rawAlphaScore >= 60) {
    grade = 'B';
    action = rawDirection;
  } else {
    grade = 'C';
    action = 'WAIT';
    rejectionReasons.push(`Combined 4-pillar Alpha Score (${rawAlphaScore}) below B-grade threshold (60).`);
  }

  const setup = buildQuantSignalSetup({
    displaySymbol: params.displaySymbol,
    action,
    closePrice,
    atr14,
    ema20,
    vwap,
    srZones,
    overextended,
    eventRiskLevel: params.intel.eventRiskLevel,
    rejectionSummary: rejectionReasons[0],
  });

  const keySummary =
    action !== 'WAIT'
      ? `${grade} ${action} setup (${finalAlphaScore}/100) · HTF ${htfBias} · ${
          historicalEdge.sampleTrades >= 3
            ? `Hist ${historicalEdge.winRatePct}% win (+${historicalEdge.expectancyR}R)`
            : 'Fresh regime'
        } · Sentiment ${assetSent.label}${overextended ? ' · Use pullback limit zone' : ''}.`
      : rejectionReasons[0] || 'No high-conviction edge detected.';

  return {
    canonicalId: params.canonicalId,
    exchange: params.exchange,
    marketType: params.marketType,
    displaySymbol: params.displaySymbol,
    baseAsset: params.baseAsset,
    timeframe: params.timeframe,
    htfTimeframe: params.htfTimeframe,
    price: closePrice,
    change24hPct: params.change24hPct,
    volume24hUsd: params.volume24hUsd,
    grade,
    alphaScore: finalAlphaScore,
    action,
    rawDirection,
    pillars: {
      technicalScore,
      htfScore,
      historicalScore,
      sentimentScore,
    },
    technicalSummary: {
      directionalScore: dirScore,
      agreementPct,
      adx14: adx14 !== null ? Number(adx14.toFixed(1)) : null,
      rsi14: rsi14 !== null ? Number(rsi14.toFixed(1)) : null,
      atrPct: atrPct !== null ? Number(atrPct.toFixed(2)) : null,
      rvol20: rvol20 !== null ? Number(rvol20.toFixed(2)) : null,
      trendRegime: confirmed.regime.trendRegime,
    },
    htfBias,
    htfAligned,
    historicalEdge,
    assetSentiment: {
      score: assetSent.score,
      label: assetSent.label,
      trendingRank: assetSent.trendingRank,
      fundingPct: assetSent.fundingPct,
      headlinesCount: assetSent.headlinesCount,
      shockWarning: assetSent.shockWarning,
    },
    antiChase: {
      distanceAtrFromEma20,
      overextended,
      entryMode: overextended ? 'PULLBACK_ZONE' : 'NOW',
    },
    gatesPassed,
    rejectionReasons,
    setup,
    keySummary,
    scannedAt: nowMs,
  };
}

// =========================================================================
// 4. MULTI-PAIR LIVE QUANT SCANNER (WITH CONCURRENCY & CACHING)
// =========================================================================

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        const res = await fn(items[idx]);
        if (res !== null) results.push(res);
      } catch {
        // skip transient individual pair failure cleanly
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export async function runQuantSignalScan(
  exchange: ExchangeId,
  marketType: MarketType,
  timeframe: Timeframe,
  forceRefresh = false,
): Promise<QuantSignalsPayload> {
  const cacheKey = `${exchange}:${marketType}:${timeframe}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = quantCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.payload;
    }
    const pending = quantInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const run = (async (): Promise<QuantSignalsPayload> => {
    const htfTimeframe = resolveHigherTimeframe(exchange, timeframe);
    const [intel, tickers] = await Promise.all([
      getMarketIntelligence(forceRefresh),
      getMarketTickers(exchange, marketType),
    ]);

    // Select top 18 most liquid live pairs on the chosen exchange
    const universe = tickers
      .filter((t) => Number.isFinite(t.lastPrice) && t.lastPrice > 0)
      .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
      .slice(0, 18);

    const rows = await mapWithConcurrency(universe, 5, async (ticker) => {
      const [activeRes, htfRes] = await Promise.all([
        fetchCandles(exchange, marketType, ticker.displaySymbol, timeframe, 220),
        htfTimeframe
          ? fetchCandles(exchange, marketType, ticker.displaySymbol, htfTimeframe, 100).catch(
              () => null,
            )
          : Promise.resolve(null),
      ]);

      if (!activeRes.candles || activeRes.candles.length < 40) return null;

      return evaluateQuantAsset({
        canonicalId: ticker.canonicalId,
        exchange,
        marketType,
        displaySymbol: ticker.displaySymbol,
        baseAsset: ticker.baseAsset,
        timeframe,
        htfTimeframe,
        price: ticker.lastPrice,
        change24hPct: ticker.change24hPct,
        volume24hUsd: ticker.quoteVolume24h,
        candles: activeRes.candles,
        htfCandles: htfRes?.candles ?? null,
        intel,
      });
    });

    // Sort: Actionable A+ / A / B first by Alpha Score desc, then WAIT/BLOCKED by Alpha Score desc
    const gradeOrder: Record<QuantSignalGrade, number> = {
      'A+': 0,
      A: 1,
      B: 2,
      C: 3,
      BLOCKED: 4,
    };
    rows.sort((a, b) => {
      const aAct = a.action !== 'WAIT' ? 0 : 1;
      const bAct = b.action !== 'WAIT' ? 0 : 1;
      if (aAct !== bAct) return aAct - bAct;
      const gd = gradeOrder[a.grade] - gradeOrder[b.grade];
      if (gd !== 0) return gd;
      return b.alphaScore - a.alphaScore;
    });

    const actionableCount = rows.filter((r) => r.action !== 'WAIT').length;
    const blockedCount = rows.length - actionableCount;

    const payload: QuantSignalsPayload = {
      exchange,
      marketType,
      timeframe,
      htfTimeframe,
      signals: rows,
      actionableCount,
      blockedCount,
      scannedUniverseCount: universe.length,
      intelligence: intel,
      scannedAt: Date.now(),
      methodologyNote:
        '4-Pillar Quant Alpha Engine combines 10-indicator technical confluence, Higher-Timeframe trend alignment, causal walk-forward historical backtest expectancy (2× ATR anti-wick SL, 1.5R/2.6R scaling), live macro calendar risk shield, and real news/social/funding sentiment. Past historical edge reduces low-quality entries but never guarantees future profits.',
    };

    quantCache.set(cacheKey, { payload, expiresAt: Date.now() + QUANT_CACHE_TTL_MS });
    return payload;
  })();

  quantInFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    quantInFlight.delete(cacheKey);
  }
}
