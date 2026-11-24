import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle, MarketIntelligenceSnapshot } from '../shared/types';
import {
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateOBV,
  calculateRSI,
  calculateRVOL,
  calculateSessionVWAP,
  calculateStochRSI,
  toHeikinAshi,
} from './indicators';
import { validateCandles } from './validation';
import { buildSignalReport, runFullAssetAnalysis } from './signals';
import { detectCandlestickPatterns, detectSupportResistance } from './patterns';
import { computePearsonCorrelation } from './correlation';
import { parseNaturalLanguageToScreenerFilters } from './screenerRules';
import { computeSignalSetup, formatSignalCopyText } from './signalSetup';
import { getAssetSentimentContext, scoreHeadlineSentiment } from '../server/marketIntel';
import {
  evaluateQuantAsset,
  inferAssetCategory,
  reconcileStaticLockedSignal,
  simulateHistoricalEdge,
} from '../server/quantSignals';
import { getDb } from '../server/db';

function generateSyntheticSeries(
  count: number,
  mode: 'uptrend' | 'downtrend' | 'sideways' | 'volspike' | 'conflicting',
  stepMs = 900_000,
): Candle[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const candles: Candle[] = [];
  let price = 100;

  for (let i = 0; i < count; i++) {
    let delta = 0;
    let vol = 1000;
    let spread = 0.6;

    if (mode === 'uptrend') {
      delta = 0.8 + (i % 4 === 0 ? -0.25 : 0.35);
      vol = 1000 + i * 12;
      spread = 0.7;
    } else if (mode === 'downtrend') {
      delta = -0.35 + (i % 4 === 0 ? 0.08 : -0.12);
      vol = 1000 + i * 12;
      spread = 0.4;
    } else if (mode === 'sideways') {
      delta = Math.sin(i * 0.75) * 0.6;
      vol = 1000 + (i % 3) * 20;
      spread = 0.45;
    } else if (mode === 'volspike') {
      delta = i < count - 5 ? 0.4 : (i % 2 === 0 ? 12 : -11);
      spread = i < count - 5 ? 0.5 : 14;
      vol = i < count - 5 ? 1000 : 6500;
    } else if (mode === 'conflicting') {
      // Long uptrend followed by sudden pullback (EMA 50/200 bullish, RSI/MACD/VWAP bearish)
      delta = i < count - 10 ? 0.55 : -1.1;
      vol = i < count - 10 ? 1000 : 1800;
      spread = 0.8;
    }

    const open = Math.max(5, price);
    const close = Math.max(5, open + delta);
    const high = Math.max(open, close) + spread;
    const low = Math.max(1, Math.min(open, close) - spread * 0.8);
    price = close;

    candles.push({
      openTime: start + i * stepMs,
      closeTime: start + (i + 1) * stepMs - 1,
      open,
      high,
      low,
      close,
      volume: vol,
      isClosed: true,
    });
  }
  return candles;
}

// =========================================================================
// INDICATOR MATH TESTS (ALL 10 FAMILIES)
// =========================================================================

test('EMA matches exact SMA seed + exponential smoothing formula', () => {
  const vals = [10, 12, 14, 16, 18];
  const ema3 = calculateEMA(vals, 3);
  assert.equal(ema3[0], null);
  assert.equal(ema3[1], null);
  assert.equal(ema3[2], 12); // SMA(10,12,14) = 12
  // k = 2/(3+1) = 0.5 => ema[3] = 16*0.5 + 12*0.5 = 14
  assert.equal(ema3[3], 14);
  // ema[4] = 18*0.5 + 14*0.5 = 16
  assert.equal(ema3[4], 16);
});

test('RSI handles monotonic up (100), monotonic down (0), and flat (50) boundaries', () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  const down = Array.from({ length: 20 }, (_, i) => 100 - i);
  const flat = Array.from({ length: 20 }, () => 100);

  assert.equal(calculateRSI(up, 14)[19], 100);
  assert.equal(calculateRSI(down, 14)[19], 0);
  assert.equal(calculateRSI(flat, 14)[19], 50);
});

test('MACD equals EMA(12) - EMA(26) and histogram equals MACD - Signal', () => {
  const candles = generateSyntheticSeries(60, 'uptrend');
  const closes = candles.map((c) => c.close);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = calculateMACD(closes, 12, 26, 9);

  const last = closes.length - 1;
  assert.ok(macd.macdLine[last] !== null && macd.signalLine[last] !== null && macd.histogram[last] !== null);
  assert.ok(Math.abs(macd.macdLine[last]! - (ema12[last]! - ema26[last]!)) < 1e-9);
  assert.ok(Math.abs(macd.histogram[last]! - (macd.macdLine[last]! - macd.signalLine[last]!)) < 1e-9);
  assert.ok(macd.macdLine[last]! > 0);
});

test('ADX / DMI separates trend strength from direction (+DI vs -DI)', () => {
  const up = generateSyntheticSeries(80, 'uptrend');
  const down = generateSyntheticSeries(80, 'downtrend');
  const adxUp = calculateADX(up, 14);
  const adxDown = calculateADX(down, 14);

  const i = 79;
  assert.ok(adxUp.adx[i]! > 25);
  assert.ok(adxUp.plusDi[i]! > adxUp.minusDi[i]!);

  assert.ok(adxDown.adx[i]! > 25);
  assert.ok(adxDown.minusDi[i]! > adxDown.plusDi[i]!);
});

test('Bollinger Bands compute exact mean and population std dev', () => {
  const vals = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 98 : 102));
  const bb = calculateBollingerBands(vals, 20, 2);
  // Mean = 100, population stdDev = 2, upper = 104, lower = 96, bandwidth = 8%
  assert.equal(bb.middle[19], 100);
  assert.equal(bb.upper[19], 104);
  assert.equal(bb.lower[19], 96);
  assert.equal(bb.bandwidth[19], 8);
});

test('Stochastic RSI outputs bounded 0..100 values after warm-up', () => {
  const candles = generateSyntheticSeries(60, 'sideways');
  const rsi = calculateRSI(candles.map((c) => c.close), 14);
  const st = calculateStochRSI(rsi, 14, 3, 3);
  const lastK = st.k[59];
  const lastD = st.d[59];
  assert.ok(lastK !== null && lastK >= 0 && lastK <= 100);
  assert.ok(lastD !== null && lastD >= 0 && lastD <= 100);
});

test('OBV accumulates on up closes and distributes on down closes', () => {
  const candles: Candle[] = [
    { openTime: 1, closeTime: 2, open: 10, high: 11, low: 9, close: 10, volume: 100, isClosed: true },
    { openTime: 3, closeTime: 4, open: 10, high: 12, low: 10, close: 11, volume: 250, isClosed: true },
    { openTime: 5, closeTime: 6, open: 11, high: 11, low: 9, close: 9.5, volume: 150, isClosed: true },
    { openTime: 7, closeTime: 8, open: 9.5, high: 10, low: 9, close: 9.5, volume: 500, isClosed: true },
  ];
  assert.deepEqual(calculateOBV(candles), [0, 250, 100, 100]);
});

test('Session VWAP resets at UTC day boundaries', () => {
  const day1 = Date.UTC(2026, 0, 1, 23, 45, 0);
  const day2 = Date.UTC(2026, 0, 2, 0, 0, 0);
  const candles: Candle[] = [
    { openTime: day1, closeTime: day1 + 899_999, open: 100, high: 100, low: 100, close: 100, volume: 10, isClosed: true },
    { openTime: day2, closeTime: day2 + 899_999, open: 200, high: 200, low: 200, close: 200, volume: 5, isClosed: true },
    { openTime: day2 + 900_000, closeTime: day2 + 1_799_999, open: 220, high: 220, low: 220, close: 220, volume: 5, isClosed: true },
  ];
  const res = calculateSessionVWAP(candles);
  assert.equal(res.anchorMode, 'UTC_DAILY_SESSION');
  assert.equal(res.vwap[0], 100);
  assert.equal(res.vwap[1], 200); // reset cleanly at UTC midnight
  assert.equal(res.vwap[2], 210); // (200*5 + 220*5)/10
});

test('RVOL compares current bar volume strictly against previous 20 completed bars', () => {
  const candles = generateSyntheticSeries(25, 'sideways').map((c, idx) => ({
    ...c,
    volume: idx === 24 ? 3000 : 1000,
  }));
  const rvol = calculateRVOL(candles, 20);
  assert.equal(rvol[19], null);
  assert.equal(rvol[24], 3);
});

test('ATR computes exact initial SMA of True Range followed by Wilder smoothing', () => {
  const candles = generateSyntheticSeries(20, 'sideways').map((c) => ({
    ...c,
    open: 100,
    high: 105,
    low: 95,
    close: 100,
  }));
  const { atr, atrPct } = calculateATR(candles, 14);
  assert.equal(atr[12], null);
  assert.equal(atr[13], 10);
  assert.equal(atr[19], 10);
  assert.equal(atrPct[19], 10);
});

// =========================================================================
// SIGNAL ENGINE TESTS (ALL 12 REQUIRED SCENARIOS)
// =========================================================================

const baseOpts = {
  canonicalId: 'binance:spot:BTC/USDT',
  exchange: 'binance' as const,
  marketType: 'spot' as const,
  displaySymbol: 'BTC/USDT',
  timeframe: '15m' as const,
  nowMs: Date.UTC(2026, 0, 10),
};

test('1 & 2. Strong bullish confluence vs Strong bearish confluence', () => {
  const bullCandles = generateSyntheticSeries(220, 'uptrend');
  const bearCandles = generateSyntheticSeries(220, 'downtrend');

  const bullReport = buildSignalReport(bullCandles, 'CONFIRMED', baseOpts);
  const bearReport = buildSignalReport(bearCandles, 'CONFIRMED', baseOpts);

  assert.ok(bullReport.classification === 'STRONG_BULLISH' || bullReport.classification === 'BULLISH');
  assert.ok(bullReport.directionalScore >= 40);
  assert.ok(bullReport.supportingEvidence.length >= 4);

  assert.ok(bearReport.classification === 'STRONG_BEARISH' || bearReport.classification === 'BEARISH');
  assert.ok(bearReport.directionalScore <= -40);
  assert.ok(bearReport.supportingEvidence.length >= 4);
});

test('3. Conflicting indicators produce contradictory evidence and avoid false strong signal', () => {
  const candles = generateSyntheticSeries(220, 'conflicting');
  const report = buildSignalReport(candles, 'CONFIRMED', baseOpts);
  assert.ok(report.contradictoryEvidence.length >= 1);
  assert.notEqual(report.classification, 'STRONG_BULLISH');
});

test('4. Sideways market produces Neutral / Sideways regime', () => {
  const candles = generateSyntheticSeries(220, 'sideways');
  const report = buildSignalReport(candles, 'CONFIRMED', baseOpts);
  assert.equal(report.regime.trendRegime, 'Sideways / Range');
  assert.equal(report.classification, 'NEUTRAL');
});

test('5. Sudden volatility spike lowers ATR volatility modifier and downgrades strong signal', () => {
  const candles = generateSyntheticSeries(220, 'volspike');
  const report = buildSignalReport(candles, 'CONFIRMED', baseOpts);
  assert.ok(report.volatilityModifier < 1.0);
  assert.equal(report.regime.volatilityRegime, 'High Volatility');
  assert.notEqual(report.classification, 'STRONG_BULLISH');
  assert.notEqual(report.classification, 'STRONG_BEARISH');
});

test('6. Missing candles / gaps and malformed OHLCV are detected by candle validator', () => {
  const candles = generateSyntheticSeries(40, 'uptrend');
  // Inject malformed high < low and a duplicate and a gap
  candles.splice(10, 4); // gap
  candles.push({ ...candles[5] }); // duplicate
  candles.push({ ...candles[6], openTime: candles[candles.length - 1].openTime + 900_000, high: 1, low: 500 }); // malformed

  const res = validateCandles(candles, '15m', Date.UTC(2026, 1, 1));
  assert.equal(res.hasGaps, true);
  assert.equal(res.duplicateCount, 1);
  assert.equal(res.rejectedCount, 1);
});

test('7 & 9. Insufficient history reports INSUFFICIENT_DATA and partial EMA 200 coverage is flagged', () => {
  const tiny = generateSyntheticSeries(20, 'uptrend');
  const tinyReport = buildSignalReport(tiny, 'CONFIRMED', baseOpts);
  assert.equal(tinyReport.classification, 'INSUFFICIENT_DATA');
  assert.equal(tinyReport.dataQuality, 'INSUFFICIENT');

  const partial = generateSyntheticSeries(80, 'uptrend');
  const partialReport = buildSignalReport(partial, 'CONFIRMED', baseOpts);
  assert.ok(partialReport.safeguardNotes.some((n) => n.includes('EMA 200')));
});

test('8. Stale data caps strong classifications via freshness safeguard', () => {
  const candles = generateSyntheticSeries(220, 'uptrend');
  const staleReport = buildSignalReport(candles, 'CONFIRMED', {
    ...baseOpts,
    freshness: 'STALE',
  });
  assert.notEqual(staleReport.classification, 'STRONG_BULLISH');
  assert.ok(staleReport.safeguardNotes.some((n) => n.includes('STALE')));
});

test('10. Higher-timeframe disagreement is surfaced in contradictory evidence and safeguards', () => {
  const candles = generateSyntheticSeries(220, 'uptrend');
  const report = buildSignalReport(candles, 'CONFIRMED', {
    ...baseOpts,
    higherTimeframeBias: 'STRONG_BEARISH',
  });
  assert.ok(report.contradictoryEvidence.some((e) => e.includes('Higher timeframe')));
  assert.ok(report.safeguardNotes.some((n) => n.includes('Higher-timeframe')));
});

test('11. Candle-close confirmation separates CONFIRMED from PROVISIONAL live preview', () => {
  const candles = generateSyntheticSeries(120, 'uptrend');
  // Add an unclosed forming crash bar
  const last = candles[candles.length - 1];
  const forming: Candle = {
    openTime: last.openTime + 900_000,
    closeTime: last.closeTime + 900_000,
    open: last.close,
    high: last.close,
    low: last.close * 0.75,
    close: last.close * 0.78,
    volume: 9000,
    isClosed: false,
  };

  const dual = runFullAssetAnalysis([...candles, forming], baseOpts);
  assert.equal(dual.confirmed.status, 'CONFIRMED');
  assert.equal(dual.confirmed.metadata.lastCompletedCandleTime, last.openTime);
  assert.ok(dual.provisional !== null);
  assert.equal(dual.provisional!.status, 'PROVISIONAL');
  assert.ok(dual.provisional!.directionalScore < dual.confirmed.directionalScore);
});

test('12. Historical reproducibility: identical candles & settings produce bit-identical reports', () => {
  const candles = generateSyntheticSeries(220, 'uptrend');
  const r1 = buildSignalReport(candles, 'CONFIRMED', baseOpts);
  const r2 = buildSignalReport(candles, 'CONFIRMED', baseOpts);
  assert.deepEqual(r1, r2);
});

// =========================================================================
// PATTERNS, CORRELATION, SCREENER NL PARSER, HEIKIN-ASHI
// =========================================================================

test('Patterns, Support/Resistance, Correlation, Heikin-Ashi & NL Screener parser work deterministically', () => {
  const candles = generateSyntheticSeries(100, 'sideways');
  // Inject a clear Bullish Engulfing at the end
  candles[98] = { ...candles[98], open: 105, high: 106, low: 99, close: 100 };
  candles[99] = { ...candles[99], open: 99.5, high: 108, low: 99, close: 107 };

  const cdl = detectCandlestickPatterns(candles, '15m');
  assert.ok(cdl.some((p) => p.name === 'Bullish Engulfing'));

  const sr = detectSupportResistance(candles);
  assert.ok(Array.isArray(sr));

  const corrSelf = computePearsonCorrelation(candles, candles, 60);
  assert.equal(corrSelf.correlation, 1);

  const ha = toHeikinAshi(candles);
  assert.equal(ha.length, candles.length);

  const nl = parseNaturalLanguageToScreenerFilters(
    'Find USDT pairs with RSI below 35 and positive MACD momentum',
  );
  assert.equal(nl.filters.quoteAsset, 'USDT');
  assert.equal(nl.filters.maxRsi, 35);
  assert.equal(nl.filters.macdHistDirection, 'POSITIVE');
});

test('Structured Signal Setup: BUY, SELL, WAIT ordering, S/R anchoring, and 5-bullet formatting', () => {
  const buySetup = computeSignalSetup({
    displaySymbol: 'BTC/USDT',
    classification: 'STRONG_BULLISH',
    closePrice: 60000,
    atr14: 600,
    ema20: 59700,
    vwap: 59800,
  });
  assert.equal(buySetup.symbol, 'BTCUSDT');
  assert.equal(buySetup.direction, 'BUY');
  assert.equal(buySetup.entryMode, 'NOW');
  assert.ok(buySetup.entryPrice !== null && buySetup.stopLoss !== null);
  assert.ok(buySetup.stopLoss < buySetup.entryPrice, 'BUY SL must be below Entry');
  assert.equal(buySetup.takeProfits.length, 3);
  assert.ok(
    buySetup.entryPrice < buySetup.takeProfits[0].price &&
      buySetup.takeProfits[0].price < buySetup.takeProfits[1].price &&
      buySetup.takeProfits[1].price < buySetup.takeProfits[2].price,
    'BUY TP1 < TP2 < TP3 must all sit above Entry',
  );

  const sellSetup = computeSignalSetup({
    displaySymbol: 'ETH/USDT',
    classification: 'BEARISH',
    closePrice: 2000,
    atr14: 30,
    ema20: 2018,
    vwap: 2015,
  });
  assert.equal(sellSetup.symbol, 'ETHUSDT');
  assert.equal(sellSetup.direction, 'SELL');
  assert.equal(sellSetup.entryMode, 'ZONE');
  assert.ok(sellSetup.entryPrice !== null && sellSetup.stopLoss !== null);
  assert.ok(sellSetup.stopLoss > sellSetup.entryPrice, 'SELL SL must be above Entry');
  assert.equal(sellSetup.takeProfits.length, 3);
  assert.ok(
    sellSetup.entryPrice > sellSetup.takeProfits[0].price &&
      sellSetup.takeProfits[0].price > sellSetup.takeProfits[1].price &&
      sellSetup.takeProfits[1].price > sellSetup.takeProfits[2].price,
    'SELL TP1 > TP2 > TP3 must all sit below Entry',
  );

  const waitSetup = computeSignalSetup({
    displaySymbol: 'SOL/USDT',
    classification: 'NEUTRAL',
    closePrice: 100,
    atr14: 2,
    ema20: 100,
    vwap: 100,
  });
  assert.equal(waitSetup.direction, 'WAIT');
  assert.equal(waitSetup.stopLoss, null);
  assert.equal(waitSetup.takeProfits.length, 0);

  const copyText = formatSignalCopyText(buySetup, '15m', 60050);
  assert.ok(copyText.includes('• Symbol: BTCUSDT'));
  assert.ok(copyText.includes('• Direction: BUY (LONG)'));
  assert.ok(copyText.includes('• Entry: NOW'));
  assert.ok(copyText.includes('• Stop Loss (SL):'));
  assert.ok(copyText.includes('TP1:') && copyText.includes('TP2:') && copyText.includes('TP3:'));
});


test('17. News NLP scorer & shock shield detect exploit/ETF catalysts accurately', () => {
  const hack = scoreHeadlineSentiment('Solana protocol exploited in $45M breach, funds drained');
  assert.equal(hack.sentiment, 'BEARISH');
  assert.equal(hack.catalystType, 'SECURITY');
  assert.ok(hack.assets.includes('SOL'));
  assert.ok(hack.score <= -30);

  const etf = scoreHeadlineSentiment('Bitcoin spot ETF records massive institutional net inflows as BTC rallies');
  assert.equal(etf.sentiment, 'BULLISH');
  assert.equal(etf.catalystType, 'ETF');
  assert.ok(etf.assets.includes('BTC'));
  assert.ok(etf.score >= 30);

  const intel: MarketIntelligenceSnapshot = {
    updatedAt: Date.now(),
    fearAndGreed: { value: 52, classification: 'Neutral', delta7d: 2, contrarianBias: 'NEUTRAL' },
    newsSentimentScore: 10,
    socialBuzzScore: 8,
    overallSentimentScore: 9,
    sentimentLabel: 'NEUTRAL',
    eventRiskLevel: 'LOW',
    eventRiskSummary: 'Clear',
    upcomingEvents: [],
    newsCatalysts: [
      {
        id: 'sec-1',
        title: 'Solana bridge hacked and drained for $45M',
        source: 'CoinDesk',
        url: 'https://example.com',
        publishedAt: Date.now() - 30 * 60_000,
        sentiment: 'BEARISH',
        sentimentScore: -42,
        assets: ['SOL'],
        catalystType: 'SECURITY',
      },
    ],
    trendingCoins: [{ symbol: 'BTC', name: 'Bitcoin', rank: 1, priceChange24hPct: 4.5 }],
    derivativesBias: { avgFundingPct: 0.005, crowdedSide: 'BALANCED' },
    perAssetFundingPct: { BTC: 0.005, SOL: -0.01 },
    activeSources: ['UnitTest'],
    unavailableSources: [],
  };

  const solCtx = getAssetSentimentContext('SOL', intel);
  assert.equal(solCtx.blocksLong, true);
  assert.ok(solCtx.shockWarning && solCtx.shockWarning.includes('SECURITY'));

  const btcCtx = getAssetSentimentContext('BTC', intel);
  assert.equal(btcCtx.blocksLong, false);
  assert.equal(btcCtx.trendingRank, 1);
});

test('18. 4-Pillar Quant Alpha Engine enforces HTF alignment, chop filter, walk-forward edge, and shock shield', () => {
  const uptrend = generateSyntheticSeries(220, 'uptrend');
  const htfUptrend = generateSyntheticSeries(110, 'uptrend', 14_400_000);
  const htfDowntrend = generateSyntheticSeries(110, 'downtrend', 14_400_000);
  const sideways = generateSyntheticSeries(220, 'sideways');

  const calmIntel: MarketIntelligenceSnapshot = {
    updatedAt: Date.now(),
    fearAndGreed: { value: 55, classification: 'Greed', delta7d: 5, contrarianBias: 'NEUTRAL' },
    newsSentimentScore: 22,
    socialBuzzScore: 18,
    overallSentimentScore: 20,
    sentimentLabel: 'BULLISH',
    eventRiskLevel: 'LOW',
    eventRiskSummary: 'No high-impact macro event within 24h.',
    upcomingEvents: [],
    newsCatalysts: [],
    trendingCoins: [{ symbol: 'BTC', name: 'Bitcoin', rank: 1, priceChange24hPct: 3.8 }],
    derivativesBias: { avgFundingPct: 0.006, crowdedSide: 'BALANCED' },
    perAssetFundingPct: { BTC: 0.006 },
    activeSources: ['UnitTest'],
    unavailableSources: [],
  };

  const histBuy = simulateHistoricalEdge(uptrend, 'BUY');
  assert.equal(histBuy.passed, true);

  const aligned = evaluateQuantAsset({
    canonicalId: 'binance:spot:BTC/USDT',
    exchange: 'binance',
    marketType: 'spot',
    displaySymbol: 'BTC/USDT',
    baseAsset: 'BTC',
    timeframe: '15m',
    htfTimeframe: '4h',
    price: uptrend[uptrend.length - 1].close,
    change24hPct: 3.5,
    volume24hUsd: 1_500_000_000,
    candles: uptrend,
    htfCandles: htfUptrend,
    intel: calmIntel,
  });
  assert.equal(aligned.action, 'BUY');
  assert.ok(['A+', 'A', 'B'].includes(aligned.grade));
  assert.equal(aligned.htfAligned, true);
  assert.equal(aligned.setup.takeProfits.length, 3);
  assert.ok(aligned.setup.takeProfits[0].rrRatio >= 1.4);

  const choppy = evaluateQuantAsset({
    canonicalId: 'binance:spot:ETH/USDT',
    exchange: 'binance',
    marketType: 'spot',
    displaySymbol: 'ETH/USDT',
    baseAsset: 'ETH',
    timeframe: '15m',
    htfTimeframe: '4h',
    price: sideways[sideways.length - 1].close,
    change24hPct: 0.1,
    volume24hUsd: 800_000_000,
    candles: sideways,
    htfCandles: htfUptrend,
    intel: calmIntel,
  });
  assert.equal(choppy.action, 'WAIT');
  assert.ok(choppy.rejectionReasons.length > 0);

  const shockIntel: MarketIntelligenceSnapshot = {
    ...calmIntel,
    newsCatalysts: [
      {
        id: 'btc-shock',
        title: 'Major Bitcoin exchange hacked and drained in massive security exploit',
        source: 'CoinDesk',
        url: 'https://example.com',
        publishedAt: Date.now() - 20 * 60_000,
        sentiment: 'BEARISH',
        sentimentScore: -42,
        assets: ['BTC'],
        catalystType: 'SECURITY',
      },
    ],
  };
  const shockBlocked = evaluateQuantAsset({
    canonicalId: 'binance:spot:BTC/USDT',
    exchange: 'binance',
    marketType: 'spot',
    displaySymbol: 'BTC/USDT',
    baseAsset: 'BTC',
    timeframe: '15m',
    htfTimeframe: '4h',
    price: uptrend[uptrend.length - 1].close,
    change24hPct: 3.5,
    volume24hUsd: 1_500_000_000,
    candles: uptrend,
    htfCandles: htfDowntrend,
    intel: shockIntel,
  });
  assert.equal(shockBlocked.action, 'WAIT');
  assert.equal(shockBlocked.grade, 'BLOCKED');
  assert.ok(shockBlocked.rejectionReasons.some((r) => r.includes('Shock catalyst')));
});

test('19. Static Locked Signals persist Entry/SL/TP without repainting on market price shift and support Commodities/Stocks/Crypto', () => {
  assert.equal(inferAssetCategory('cfds', 'XAU'), 'commodities');
  assert.equal(inferAssetCategory('stocks', 'NVDA'), 'stocks');
  assert.equal(inferAssetCategory('binance', 'BTC'), 'crypto');

  const uptrend = generateSyntheticSeries(220, 'uptrend');
  const htfUptrend = generateSyntheticSeries(110, 'uptrend', 14_400_000);
  const calmIntel: MarketIntelligenceSnapshot = {
    updatedAt: Date.now(),
    fearAndGreed: { value: 55, classification: 'Greed', delta7d: 5, contrarianBias: 'NEUTRAL' },
    newsSentimentScore: 22,
    socialBuzzScore: 18,
    overallSentimentScore: 20,
    sentimentLabel: 'BULLISH',
    eventRiskLevel: 'LOW',
    eventRiskSummary: 'Clear',
    upcomingEvents: [],
    newsCatalysts: [],
    trendingCoins: [],
    derivativesBias: { avgFundingPct: 0.005, crowdedSide: 'BALANCED' },
    perAssetFundingPct: {},
    activeSources: ['UnitTest'],
    unavailableSources: [],
  };

  const testCanonical = 'cfds:cfd:XAU_TEST/USD';
  const db = getDb();
  try {
    const baseEval = evaluateQuantAsset({
      canonicalId: testCanonical,
      assetClass: 'commodities',
      exchange: 'cfds',
      marketType: 'cfd',
      displaySymbol: 'XAU_TEST/USD',
      baseAsset: 'XAU',
      timeframe: '1h',
      htfTimeframe: '4h',
      price: uptrend[uptrend.length - 1].close,
      change24hPct: 1.4,
      volume24hUsd: 500_000_000,
      candles: uptrend,
      htfCandles: htfUptrend,
      intel: calmIntel,
    });
    assert.equal(baseEval.action, 'BUY');
    assert.equal(baseEval.assetClass, 'commodities');

    const t0 = Date.now();
    // 1. Lock the signal into SQLite
    const locked = reconcileStaticLockedSignal({
      candidate: baseEval,
      livePrice: uptrend[uptrend.length - 1].close,
      completedCandles: uptrend,
      nowMs: t0,
    });
    assert.ok(locked.lockState?.isLocked);
    assert.equal(locked.lockState?.status, 'ACTIVE');
    const frozenEntry = locked.lockState!.lockedEntryPrice;
    const frozenSl = locked.setup.stopLoss!;
    const frozenTp1 = locked.setup.takeProfits[0].price;

    // 2. Market shifts slightly & a noisy new candidate tries to flip to SELL/WAIT -> MUST remain STATIC BUY with identical Entry/SL/TP!
    const noisyFlip: typeof baseEval = {
      ...baseEval,
      action: 'SELL',
      grade: 'A',
      setup: { ...baseEval.setup, direction: 'SELL', entryPrice: frozenEntry * 1.003 },
    };
    const shiftedPrice = frozenEntry + (frozenTp1 - frozenEntry) * 0.35;
    const stillStatic = reconcileStaticLockedSignal({
      candidate: noisyFlip,
      livePrice: shiftedPrice,
      completedCandles: uptrend,
      nowMs: t0 + 5 * 60_000,
    });
    assert.equal(stillStatic.action, 'BUY', 'Locked signal must NOT flip direction on market shift');
    assert.equal(stillStatic.lockState?.lockedEntryPrice, frozenEntry, 'Locked Entry must remain static');
    assert.equal(stillStatic.setup.stopLoss, frozenSl, 'Locked SL must remain static');
    assert.equal(stillStatic.setup.takeProfits[0].price, frozenTp1, 'Locked TP1 must remain static');
    assert.equal(stillStatic.lockState?.status, 'ACTIVE');

    // 3. Price reaches TP1 -> status transitions cleanly to TP1_HIT without repainting levels
    const tp1Reached = reconcileStaticLockedSignal({
      candidate: noisyFlip,
      livePrice: frozenTp1 * 1.001,
      completedCandles: uptrend,
      nowMs: t0 + 15 * 60_000,
    });
    assert.equal(tp1Reached.lockState?.status, 'TP1_HIT');
    assert.ok(tp1Reached.lockState?.tp1HitAt !== null);
    assert.equal(tp1Reached.lockState?.lockedEntryPrice, frozenEntry);
  } finally {
    db.prepare('DELETE FROM locked_quant_signals WHERE canonical_id = ?').run(testCanonical);
  }
});
