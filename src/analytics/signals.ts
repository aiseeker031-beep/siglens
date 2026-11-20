import {
  CONFIG_VERSION,
  DEFAULT_PREFERENCES,
  DEFAULT_WEIGHTS,
  ENGINE_VERSION,
} from '../shared/constants';
import { signalLabel } from '../shared/format';
import type {
  Candle,
  DataFreshness,
  DirectionalBias,
  DualSignalResponse,
  ExchangeId,
  IndicatorFamilyResult,
  IndicatorSeriesPack,
  IndicatorWeights,
  MarketType,
  SignalAgreement,
  SignalClassification,
  SignalEventRecord,
  SignalReport,
  Timeframe,
} from '../shared/types';
import { computeAllIndicatorSeries, detectDivergence } from './indicators';
import {
  detectCandlestickPatterns,
  detectStructuralPatterns,
  detectSupportResistance,
} from './patterns';
import { classifyMarketRegime } from './regime';
import { computeSignalSetup } from './signalSetup';
import { validateCandles } from './validation';
import { evaluateHistoricalSignals } from './validationBacktest';

export interface SignalEngineOptions {
  canonicalId: string;
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  timeframe: Timeframe;
  freshness?: DataFreshness;
  weights?: IndicatorWeights;
  thresholds?: {
    strongBullish: number;
    bullish: number;
    bearish: number;
    strongBearish: number;
  };
  minCoveragePct?: number;
  minAgreementForStrongPct?: number;
  higherTimeframeBias?: SignalClassification | null;
  nowMs?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function toBias(evidence: number, available: boolean): DirectionalBias {
  if (!available) return 'UNAVAILABLE';
  if (evidence >= 0.15) return 'BULLISH';
  if (evidence <= -0.15) return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Evaluates all 10 indicator families at candle index `idx` on a validated candle series.
 * Completely deterministic and reproducible for identical inputs.
 */
export function evaluateIndicatorsAtIndex(
  candles: Candle[],
  series: IndicatorSeriesPack,
  vwapMeta: { anchorMode: 'UTC_DAILY_SESSION' | 'ROLLING_20_BAR'; sessionBars: number },
  idx: number,
  weights: IndicatorWeights = DEFAULT_WEIGHTS,
): {
  indicators: IndicatorFamilyResult[];
  volatilityModifier: number;
  isExtremeVolatility: boolean;
  emaMajorTrend: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNAVAILABLE';
} {
  const c = candles[idx];
  const prevIdx = Math.max(0, idx - 1);
  const ts = c.openTime;
  const close = c.close;

  // --- 1. EMA Trend Structure (weight 20) ---
  const ema9 = series.ema9[idx];
  const ema20 = series.ema20[idx];
  const ema50 = series.ema50[idx];
  const ema100 = series.ema100[idx];
  const ema200 = series.ema200[idx];
  const prevEma20 = series.ema20[prevIdx];
  const prevEma50 = series.ema50[prevIdx];

  let emaEvidence = 0;
  const emaRules: string[] = [];
  let emaAvailable = ema20 !== null && ema50 !== null;
  let emaSufficiency: string | null = null;
  let emaMajorTrend: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNAVAILABLE' = 'UNAVAILABLE';

  if (emaAvailable && ema20 !== null && ema50 !== null) {
    let score = 0;
    let maxScore = 0;

    // Price vs EMA 20 & EMA 50
    maxScore += 0.35;
    if (close > ema20 && close > ema50) {
      score += 0.35;
      emaRules.push('Price is trading above both EMA 20 and EMA 50.');
    } else if (close < ema20 && close < ema50) {
      score -= 0.35;
      emaRules.push('Price is trading below both EMA 20 and EMA 50.');
    } else {
      emaRules.push('Price is positioned between EMA 20 and EMA 50.');
    }

    // EMA 20 vs EMA 50 ordering
    maxScore += 0.3;
    if (ema20 > ema50) {
      score += 0.3;
      emaRules.push('EMA 20 is above EMA 50 (short-to-medium bullish stack).');
    } else if (ema20 < ema50) {
      score -= 0.3;
      emaRules.push('EMA 20 is below EMA 50 (short-to-medium bearish stack).');
    }

    // EMA 9 slope / fast alignment
    if (ema9 !== null) {
      maxScore += 0.15;
      if (ema9 > ema20) score += 0.15;
      else if (ema9 < ema20) score -= 0.15;
    }

    // Long-term EMA 200 structure
    if (ema200 !== null) {
      maxScore += 0.3;
      if (close > ema200 && ema50 > ema200) {
        score += 0.3;
        emaRules.push('Price and EMA 50 hold above EMA 200 (long-term uptrend intact).');
      } else if (close < ema200 && ema50 < ema200) {
        score -= 0.3;
        emaRules.push('Price and EMA 50 remain below EMA 200 (long-term downtrend).');
      } else if (close > ema200) {
        score += 0.12;
        emaRules.push('Price is above EMA 200 while EMA 50 lags below.');
      } else {
        score -= 0.12;
        emaRules.push('Price is below EMA 200 while EMA 50 remains above.');
      }
    } else {
      emaSufficiency = 'EMA 200 unavailable (< 200 completed candles); scored on EMA 9/20/50.';
    }

    // Fresh EMA 20/50 crossover bonus
    if (prevEma20 !== null && prevEma50 !== null) {
      if (prevEma20 <= prevEma50 && ema20 > ema50) {
        emaRules.push('Fresh bullish EMA 20/50 crossover detected.');
      } else if (prevEma20 >= prevEma50 && ema20 < ema50) {
        emaRules.push('Fresh bearish EMA 20/50 crossover detected.');
      }
    }

    emaEvidence = maxScore > 0 ? clamp(score / maxScore, -1, 1) : 0;
    emaMajorTrend = emaEvidence >= 0.25 ? 'BULLISH' : emaEvidence <= -0.25 ? 'BEARISH' : 'MIXED';
  } else {
    emaSufficiency = 'Requires at least 50 completed candles for EMA 20/50 trend structure.';
  }

  // --- 2. RSI 14 (weight 10) ---
  const rsi = series.rsi14[idx];
  const prevRsi = series.rsi14[prevIdx];
  const rsiDiv = detectDivergence(candles.slice(0, idx + 1), series.rsi14.slice(0, idx + 1), 30);
  const rsiAvailable = rsi !== null;
  let rsiEvidence = 0;
  const rsiRules: string[] = [];

  if (rsi !== null) {
    const rsiSlope = prevRsi !== null ? rsi - prevRsi : 0;
    // Context-aware RSI: overbought in a strong uptrend is NOT automatically bearish
    if (rsi >= 55 && rsi <= 72) {
      rsiEvidence += 0.55;
      rsiRules.push(`RSI 14 at ${rsi.toFixed(1)} shows healthy bullish momentum above centerline.`);
    } else if (rsi > 72) {
      if (emaMajorTrend === 'BULLISH') {
        rsiEvidence += 0.2;
        rsiRules.push(`RSI 14 elevated at ${rsi.toFixed(1)} within an active uptrend (momentum strong, watch overextension).`);
      } else {
        rsiEvidence -= 0.45;
        rsiRules.push(`RSI 14 overbought at ${rsi.toFixed(1)} without strong uptrend alignment.`);
      }
    } else if (rsi <= 45 && rsi >= 28) {
      rsiEvidence -= 0.55;
      rsiRules.push(`RSI 14 at ${rsi.toFixed(1)} reflects bearish momentum below centerline.`);
    } else if (rsi < 28) {
      if (emaMajorTrend === 'BEARISH') {
        rsiEvidence -= 0.2;
        rsiRules.push(`RSI 14 oversold at ${rsi.toFixed(1)} inside a prevailing downtrend (oversold persistence risk).`);
      } else {
        rsiEvidence += 0.45;
        rsiRules.push(`RSI 14 deeply oversold at ${rsi.toFixed(1)} signaling potential mean-reversion.`);
      }
    } else {
      rsiRules.push(`RSI 14 neutral near centerline (${rsi.toFixed(1)}).`);
    }

    if (rsiSlope > 1.5) {
      rsiEvidence += 0.2;
      rsiRules.push('RSI slope is accelerating upward.');
    } else if (rsiSlope < -1.5) {
      rsiEvidence -= 0.2;
      rsiRules.push('RSI slope is turning downward.');
    }

    if (rsiDiv === 'BULLISH') {
      rsiEvidence += 0.3;
      rsiRules.push('Bullish RSI divergence observed across recent swing lows.');
    } else if (rsiDiv === 'BEARISH') {
      rsiEvidence -= 0.3;
      rsiRules.push('Bearish RSI divergence observed across recent swing highs.');
    }

    rsiEvidence = clamp(rsiEvidence, -1, 1);
  }

  // --- 3. MACD 12/26/9 (weight 15) ---
  const macdLine = series.macdLine[idx];
  const macdSignal = series.macdSignal[idx];
  const macdHist = series.macdHist[idx];
  const prevMacdHist = series.macdHist[prevIdx];
  const prevMacdLine = series.macdLine[prevIdx];
  const prevMacdSignal = series.macdSignal[prevIdx];
  const macdAvailable = macdLine !== null && macdSignal !== null && macdHist !== null;
  let macdEvidence = 0;
  const macdRules: string[] = [];

  if (macdAvailable && macdLine !== null && macdSignal !== null && macdHist !== null) {
    const histSlope = prevMacdHist !== null ? macdHist - prevMacdHist : 0;

    if (macdHist > 0) {
      macdEvidence += 0.45;
      macdRules.push('MACD line is above signal line (positive histogram).');
    } else if (macdHist < 0) {
      macdEvidence -= 0.45;
      macdRules.push('MACD line is below signal line (negative histogram).');
    }

    if (histSlope > 0) {
      macdEvidence += 0.25;
      macdRules.push('MACD histogram momentum is expanding upward.');
    } else if (histSlope < 0) {
      macdEvidence -= 0.25;
      macdRules.push('MACD histogram momentum is declining.');
    }

    if (macdLine > 0) {
      macdEvidence += 0.2;
      macdRules.push('MACD line holds above zero centerline.');
    } else if (macdLine < 0) {
      macdEvidence -= 0.2;
      macdRules.push('MACD line sits below zero centerline.');
    }

    if (prevMacdLine !== null && prevMacdSignal !== null) {
      if (prevMacdLine <= prevMacdSignal && macdLine > macdSignal) {
        macdEvidence += 0.25;
        macdRules.push('Fresh bullish MACD crossover above signal line.');
      } else if (prevMacdLine >= prevMacdSignal && macdLine < macdSignal) {
        macdEvidence -= 0.25;
        macdRules.push('Fresh bearish MACD crossover below signal line.');
      }
    }

    macdEvidence = clamp(macdEvidence, -1, 1);
  }

  // --- 4. ADX & DMI 14 (weight 15) ---
  // ADX measures trend strength, NOT bullishness by itself; direction comes from +DI vs -DI
  const adx = series.adx14[idx];
  const plusDi = series.plusDi14[idx];
  const minusDi = series.minusDi14[idx];
  const prevAdx = series.adx14[prevIdx];
  const adxAvailable = adx !== null && plusDi !== null && minusDi !== null;
  let adxEvidence = 0;
  const adxRules: string[] = [];

  if (adxAvailable && adx !== null && plusDi !== null && minusDi !== null) {
    const diDiff = plusDi - minusDi;
    const diDenom = plusDi + minusDi;
    const directionalUnit = diDenom > 0 ? diDiff / diDenom : 0; // [-1, 1]

    if (adx < 18) {
      adxEvidence = directionalUnit * 0.2;
      adxRules.push(`ADX at ${adx.toFixed(1)} signals weak or range-bound trend conditions.`);
    } else if (adx < 25) {
      adxEvidence = directionalUnit * 0.65;
      adxRules.push(
        `ADX at ${adx.toFixed(1)} shows developing trend (${plusDi > minusDi ? '+DI leads -DI' : '-DI leads +DI'}).`,
      );
    } else {
      const strengthScale = clamp((adx - 15) / 25, 0.75, 1.0);
      adxEvidence = clamp(Math.sign(diDiff) * Math.min(1, Math.abs(directionalUnit) * 1.8) * strengthScale, -1, 1);
      adxRules.push(
        `ADX at ${adx.toFixed(1)} confirms strong directional trend with ${plusDi > minusDi ? `+DI (${plusDi.toFixed(1)}) > -DI (${minusDi.toFixed(1)})` : `-DI (${minusDi.toFixed(1)}) > +DI (${plusDi.toFixed(1)})`}.`,
      );
    }

    if (prevAdx !== null && adx - prevAdx > 0.8) {
      adxRules.push('Trend intensity (ADX) is rising.');
    } else if (prevAdx !== null && adx - prevAdx < -0.8) {
      adxRules.push('Trend intensity (ADX) is moderating.');
    }
  }

  // --- 5. Bollinger Bands 20/2 (weight 10) ---
  const bbUpper = series.bbUpper[idx];
  const bbMid = series.bbMiddle[idx];
  const bbLower = series.bbLower[idx];
  const bbBw = series.bbBandwidth[idx];
  const prevBbBw = series.bbBandwidth[prevIdx];
  const bbAvailable = bbUpper !== null && bbMid !== null && bbLower !== null && bbBw !== null;
  let bbEvidence = 0;
  const bbRules: string[] = [];
  let bbSqueeze = false;
  let bbExpanding = false;

  if (bbAvailable && bbUpper !== null && bbMid !== null && bbLower !== null && bbBw !== null) {
    const bandWidthAbs = bbUpper - bbLower;
    const pctB = bandWidthAbs > 0 ? (close - bbLower) / bandWidthAbs : 0.5;

    const histBw = series.bbBandwidth
      .slice(Math.max(0, idx - 40), idx + 1)
      .filter((v): v is number => v !== null);
    const minHistBw = histBw.length > 0 ? Math.min(...histBw) : bbBw;
    const avgHistBw = histBw.length > 0 ? histBw.reduce((a, b) => a + b, 0) / histBw.length : bbBw;

    bbSqueeze = bbBw <= minHistBw * 1.15 || bbBw < avgHistBw * 0.68;
    bbExpanding = prevBbBw !== null && bbBw > prevBbBw * 1.04;

    if (close > bbUpper) {
      bbEvidence = bbExpanding ? 0.65 : 0.3;
      bbRules.push(`Price broke above upper Bollinger Band (%B ${(pctB * 100).toFixed(0)}%).`);
    } else if (close < bbLower) {
      bbEvidence = bbExpanding ? -0.65 : -0.3;
      bbRules.push(`Price broke below lower Bollinger Band (%B ${(pctB * 100).toFixed(0)}%).`);
    } else if (close > bbMid) {
      bbEvidence = clamp((pctB - 0.5) * 1.2, 0.1, 0.55);
      bbRules.push(`Price trades in upper Bollinger half (%B ${(pctB * 100).toFixed(0)}%).`);
    } else if (close < bbMid) {
      bbEvidence = clamp((pctB - 0.5) * 1.2, -0.55, -0.1);
      bbRules.push(`Price trades in lower Bollinger half (%B ${(pctB * 100).toFixed(0)}%).`);
    }

    if (bbSqueeze) {
      bbRules.push(`Bollinger squeeze active (bandwidth ${bbBw.toFixed(2)}% near 40-bar lows).`);
    } else if (bbExpanding) {
      bbRules.push(`Bollinger bandwidth expanding (${bbBw.toFixed(2)}%).`);
    }
  }

  // --- 6. Stochastic RSI (weight 10) ---
  const stK = series.stochRsiK[idx];
  const stD = series.stochRsiD[idx];
  const prevStK = series.stochRsiK[prevIdx];
  const prevStD = series.stochRsiD[prevIdx];
  const stochAvailable = stK !== null && stD !== null;
  let stochEvidence = 0;
  const stochRules: string[] = [];

  if (stochAvailable && stK !== null && stD !== null) {
    if (stK > stD) {
      stochEvidence += 0.35;
      stochRules.push(`Stoch RSI %K (${stK.toFixed(1)}) is above %D (${stD.toFixed(1)}).`);
    } else if (stK < stD) {
      stochEvidence -= 0.35;
      stochRules.push(`Stoch RSI %K (${stK.toFixed(1)}) is below %D (${stD.toFixed(1)}).`);
    }

    if (stK < 20) {
      stochEvidence += 0.35;
      stochRules.push(`Stoch RSI in oversold zone (${stK.toFixed(1)} < 20).`);
    } else if (stK > 80) {
      stochEvidence -= 0.35;
      stochRules.push(`Stoch RSI in overbought zone (${stK.toFixed(1)} > 80) indicating short-term stretch.`);
    }

    if (prevStK !== null && prevStD !== null) {
      if (prevStK <= prevStD && stK > stD && stK < 50) {
        stochEvidence += 0.3;
        stochRules.push('Bullish Stoch RSI crossover from lower zone.');
      } else if (prevStK >= prevStD && stK < stD && stK > 50) {
        stochEvidence -= 0.3;
        stochRules.push('Bearish Stoch RSI crossover from upper zone.');
      }
    }

    stochEvidence = clamp(stochEvidence, -1, 1);
  }

  // --- 7. On-Balance Volume (weight 8) ---
  const obvAvailable = idx >= 20;
  let obvEvidence = 0;
  const obvRules: string[] = [];
  const obvDiv = obvAvailable
    ? detectDivergence(candles.slice(0, idx + 1), series.obv.slice(0, idx + 1), 28)
    : 'NONE';

  if (obvAvailable) {
    const obvNow = series.obv[idx];
    const obv20Slice = series.obv.slice(idx - 19, idx + 1);
    const obvSma20 = obv20Slice.reduce((a, b) => a + b, 0) / obv20Slice.length;
    const obvSlope = obvNow - series.obv[idx - 5];

    if (obvNow > obvSma20 && obvSlope > 0) {
      obvEvidence = 0.7;
      obvRules.push('OBV is trending above its 20-bar mean, confirming accumulation.');
    } else if (obvNow < obvSma20 && obvSlope < 0) {
      obvEvidence = -0.7;
      obvRules.push('OBV is trending below its 20-bar mean, confirming distribution.');
    } else if (obvNow > obvSma20) {
      obvEvidence = 0.25;
      obvRules.push('OBV sits above 20-bar baseline with flat short-term slope.');
    } else {
      obvEvidence = -0.25;
      obvRules.push('OBV sits below 20-bar baseline with flat short-term slope.');
    }

    if (obvDiv === 'BULLISH') {
      obvEvidence = clamp(obvEvidence + 0.35, -1, 1);
      obvRules.push('Bullish OBV divergence against price lows.');
    } else if (obvDiv === 'BEARISH') {
      obvEvidence = clamp(obvEvidence - 0.35, -1, 1);
      obvRules.push('Bearish OBV divergence against price highs.');
    }
  }

  // --- 8. Session VWAP (weight 7) ---
  const vwap = series.vwap[idx];
  const prevVwap = series.vwap[prevIdx];
  const vwapAvailable = vwap !== null && vwap > 0 && vwapMeta.sessionBars >= 2;
  let vwapEvidence = 0;
  const vwapRules: string[] = [];
  const vwapDistPct = vwapAvailable && vwap !== null ? ((close - vwap) / vwap) * 100 : null;

  if (vwapAvailable && vwap !== null && vwapDistPct !== null) {
    if (close > vwap) {
      vwapEvidence = clamp(0.35 + Math.min(0.55, Math.abs(vwapDistPct) * 0.22), 0.35, 0.9);
      vwapRules.push(
        `Price holds +${vwapDistPct.toFixed(2)}% above ${vwapMeta.anchorMode === 'UTC_DAILY_SESSION' ? 'UTC session' : '20-bar'} VWAP.`,
      );
    } else if (close < vwap) {
      vwapEvidence = -clamp(0.35 + Math.min(0.55, Math.abs(vwapDistPct) * 0.22), 0.35, 0.9);
      vwapRules.push(
        `Price trades ${vwapDistPct.toFixed(2)}% below ${vwapMeta.anchorMode === 'UTC_DAILY_SESSION' ? 'UTC session' : '20-bar'} VWAP.`,
      );
    }

    if (prevVwap !== null) {
      const prevClose = candles[prevIdx].close;
      if (prevClose <= prevVwap && close > vwap) {
        vwapRules.push('Recent VWAP reclaim on completed close.');
      } else if (prevClose >= prevVwap && close < vwap) {
        vwapRules.push('Recent VWAP loss on completed close.');
      }
    }
  }

  // --- 9. Relative Volume Confirmation (weight 5) ---
  const rvol = series.rvol20[idx];
  const rvolAvailable = rvol !== null;
  let rvolEvidence = 0;
  const rvolRules: string[] = [];

  if (rvolAvailable && rvol !== null) {
    const barReturn = c.open > 0 ? (c.close - c.open) / c.open : 0;
    const priceDir = barReturn > 0.0005 ? 1 : barReturn < -0.0005 ? -1 : 0;

    if (rvol >= 1.5 && priceDir !== 0) {
      rvolEvidence = priceDir * clamp((rvol - 1) * 0.65, 0.5, 1.0);
      rvolRules.push(
        `Elevated RVOL (${rvol.toFixed(2)}x 20-bar baseline) confirms ${priceDir > 0 ? 'bullish' : 'bearish'} participation.`,
      );
    } else if (rvol >= 1.15 && priceDir !== 0) {
      rvolEvidence = priceDir * 0.35;
      rvolRules.push(`Above-average volume (${rvol.toFixed(2)}x) supports directional candle.`);
    } else if (rvol < 0.7) {
      rvolEvidence = 0;
      rvolRules.push(`Subdued volume (${rvol.toFixed(2)}x baseline); price move lacks volume confirmation.`);
    } else {
      rvolEvidence = priceDir * 0.15;
      rvolRules.push(`Normal volume participation (${rvol.toFixed(2)}x baseline).`);
    }
  }

  // --- 10. ATR 14 — Volatility Context & Signal Quality Modifier ---
  const atr = series.atr14[idx];
  const atrPct = series.atrPct[idx];
  const atrAvailable = atr !== null && atrPct !== null;
  let volatilityModifier = 1.0;
  let isExtremeVolatility = false;
  const atrRules: string[] = [];

  if (atrAvailable && atr !== null && atrPct !== null) {
    const histAtrPct = series.atrPct
      .slice(Math.max(0, idx - 50), idx + 1)
      .filter((v): v is number => v !== null);
    const meanAtrPct =
      histAtrPct.length > 0 ? histAtrPct.reduce((a, b) => a + b, 0) / histAtrPct.length : atrPct;
    const ratio = meanAtrPct > 0 ? atrPct / meanAtrPct : 1;

    if (ratio >= 2.1 || atrPct >= 5.5) {
      volatilityModifier = 0.72;
      isExtremeVolatility = true;
      atrRules.push(
        `Extreme volatility spike: ATR% (${atrPct.toFixed(2)}%) is ${ratio.toFixed(2)}x recent baseline; damping signal conviction.`,
      );
    } else if (ratio >= 1.45 || atrPct >= 3.2) {
      volatilityModifier = 0.88;
      atrRules.push(`Elevated volatility (ATR% ${atrPct.toFixed(2)}%, ${ratio.toFixed(2)}x average).`);
    } else if (ratio <= 0.65) {
      volatilityModifier = 0.94;
      atrRules.push(`Compressed volatility (ATR% ${atrPct.toFixed(2)}%, ${ratio.toFixed(2)}x average) — breakout watch.`);
    } else {
      volatilityModifier = 1.0;
      atrRules.push(`Stable volatility regime (ATR% ${atrPct.toFixed(2)}%, ${ratio.toFixed(2)}x baseline).`);
    }
  }

  const indicators: IndicatorFamilyResult[] = [
    {
      id: 'ema',
      name: 'EMA Trend Structure',
      role: 'directional',
      evidence: emaEvidence,
      weight: weights.ema,
      effectiveWeight: emaAvailable ? weights.ema : 0,
      bias: toBias(emaEvidence, emaAvailable),
      available: emaAvailable,
      sufficiencyNote: emaSufficiency,
      summary: emaAvailable
        ? emaRules[0] ?? 'EMA structure computed.'
        : 'Insufficient history for EMA 20/50.',
      rules: emaRules,
      rawValues: {
        ema9,
        ema20,
        ema50,
        ema100,
        ema200,
        close,
      },
      candleTimestamp: ts,
    },
    {
      id: 'macd',
      name: 'MACD (12, 26, 9)',
      role: 'directional',
      evidence: macdEvidence,
      weight: weights.macd,
      effectiveWeight: macdAvailable ? weights.macd : 0,
      bias: toBias(macdEvidence, macdAvailable),
      available: macdAvailable,
      sufficiencyNote: macdAvailable ? null : 'Requires at least 35 completed candles.',
      summary: macdAvailable ? macdRules[0] ?? 'MACD computed.' : 'Insufficient history for MACD.',
      rules: macdRules,
      rawValues: {
        macdLine,
        macdSignal,
        histogram: macdHist,
        prevHistogram: prevMacdHist,
      },
      candleTimestamp: ts,
    },
    {
      id: 'rsi',
      name: 'RSI (14)',
      role: 'directional',
      evidence: rsiEvidence,
      weight: weights.rsi,
      effectiveWeight: rsiAvailable ? weights.rsi : 0,
      bias: toBias(rsiEvidence, rsiAvailable),
      available: rsiAvailable,
      sufficiencyNote: rsiAvailable ? null : 'Requires at least 15 completed candles.',
      summary: rsiAvailable ? rsiRules[0] ?? 'RSI computed.' : 'Insufficient history for RSI.',
      rules: rsiRules,
      rawValues: {
        rsi14: rsi,
        prevRsi14: prevRsi,
        divergence: rsiDiv,
      },
      candleTimestamp: ts,
    },
    {
      id: 'adx',
      name: 'ADX / DMI (14)',
      role: 'directional',
      evidence: adxEvidence,
      weight: weights.adx,
      effectiveWeight: adxAvailable ? weights.adx : 0,
      bias: toBias(adxEvidence, adxAvailable),
      available: adxAvailable,
      sufficiencyNote: adxAvailable ? null : 'Requires at least 29 completed candles.',
      summary: adxAvailable ? adxRules[0] ?? 'ADX computed.' : 'Insufficient history for ADX.',
      rules: adxRules,
      rawValues: {
        adx14: adx,
        plusDi14: plusDi,
        minusDi14: minusDi,
      },
      candleTimestamp: ts,
    },
    {
      id: 'bollinger',
      name: 'Bollinger Bands (20, 2)',
      role: 'directional',
      evidence: bbEvidence,
      weight: weights.bollinger,
      effectiveWeight: bbAvailable ? weights.bollinger : 0,
      bias: toBias(bbEvidence, bbAvailable),
      available: bbAvailable,
      sufficiencyNote: bbAvailable ? null : 'Requires at least 20 completed candles.',
      summary: bbAvailable ? bbRules[0] ?? 'Bollinger Bands computed.' : 'Insufficient history for Bollinger Bands.',
      rules: bbRules,
      rawValues: {
        upper: bbUpper,
        middle: bbMid,
        lower: bbLower,
        bandwidthPct: bbBw,
        squeeze: bbSqueeze,
        expanding: bbExpanding,
      },
      candleTimestamp: ts,
    },
    {
      id: 'stochRsi',
      name: 'Stochastic RSI (14, 14, 3, 3)',
      role: 'directional',
      evidence: stochEvidence,
      weight: weights.stochRsi,
      effectiveWeight: stochAvailable ? weights.stochRsi : 0,
      bias: toBias(stochEvidence, stochAvailable),
      available: stochAvailable,
      sufficiencyNote: stochAvailable ? null : 'Requires at least 33 completed candles.',
      summary: stochAvailable ? stochRules[0] ?? 'Stochastic RSI computed.' : 'Insufficient history for Stoch RSI.',
      rules: stochRules,
      rawValues: {
        k: stK,
        d: stD,
      },
      candleTimestamp: ts,
    },
    {
      id: 'obv',
      name: 'On-Balance Volume (OBV)',
      role: 'directional',
      evidence: obvEvidence,
      weight: weights.obv,
      effectiveWeight: obvAvailable ? weights.obv : 0,
      bias: toBias(obvEvidence, obvAvailable),
      available: obvAvailable,
      sufficiencyNote: obvAvailable ? null : 'Requires at least 21 completed candles.',
      summary: obvAvailable ? obvRules[0] ?? 'OBV computed.' : 'Insufficient history for OBV.',
      rules: obvRules,
      rawValues: {
        obv: series.obv[idx],
        divergence: obvDiv,
      },
      candleTimestamp: ts,
    },
    {
      id: 'vwap',
      name: 'Session VWAP',
      role: 'directional',
      evidence: vwapEvidence,
      weight: weights.vwap,
      effectiveWeight: vwapAvailable ? weights.vwap : 0,
      bias: toBias(vwapEvidence, vwapAvailable),
      available: vwapAvailable,
      sufficiencyNote: vwapAvailable
        ? null
        : 'Requires >= 2 bars in the active UTC session with positive volume.',
      summary: vwapAvailable ? vwapRules[0] ?? 'VWAP computed.' : 'Session VWAP not yet initialized.',
      rules: vwapRules,
      rawValues: {
        vwap,
        distancePct: vwapDistPct,
        anchorMode: vwapMeta.anchorMode,
        sessionBars: vwapMeta.sessionBars,
      },
      candleTimestamp: ts,
    },
    {
      id: 'rvol',
      name: 'Relative Volume (RVOL 20)',
      role: 'directional',
      evidence: rvolEvidence,
      weight: weights.rvol,
      effectiveWeight: rvolAvailable ? weights.rvol : 0,
      bias: toBias(rvolEvidence, rvolAvailable),
      available: rvolAvailable,
      sufficiencyNote: rvolAvailable ? null : 'Requires 20 prior completed bars for baseline volume.',
      summary: rvolAvailable ? rvolRules[0] ?? 'RVOL computed.' : 'Insufficient baseline bars for RVOL.',
      rules: rvolRules,
      rawValues: {
        rvol20: rvol,
        candleVolume: c.volume,
      },
      candleTimestamp: ts,
    },
    {
      id: 'atr',
      name: 'ATR (14) Volatility Modifier',
      role: 'volatility_modifier',
      evidence: volatilityModifier,
      weight: 0,
      effectiveWeight: 0,
      bias: 'NEUTRAL',
      available: atrAvailable,
      sufficiencyNote: atrAvailable ? null : 'Requires at least 14 completed candles.',
      summary: atrAvailable ? atrRules[0] ?? 'ATR computed.' : 'Insufficient history for ATR.',
      rules: atrRules,
      rawValues: {
        atr14: atr,
        atrPct,
        volatilityModifier,
        extremeVolatility: isExtremeVolatility,
      },
      candleTimestamp: ts,
    },
  ];

  return { indicators, volatilityModifier, isExtremeVolatility, emaMajorTrend };
}

/**
 * Generates a single SignalReport (CONFIRMED or PROVISIONAL) for a given candle array.
 */
export function buildSignalReport(
  candles: Candle[],
  status: 'CONFIRMED' | 'PROVISIONAL',
  options: SignalEngineOptions,
  precomputedSeries?: {
    series: IndicatorSeriesPack;
    vwapMeta: { anchorMode: 'UTC_DAILY_SESSION' | 'ROLLING_20_BAR'; sessionBars: number };
  },
): SignalReport {
  const nowMs = options.nowMs ?? Date.now();
  const freshness = options.freshness ?? 'LIVE';
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const thresholds = options.thresholds ?? DEFAULT_PREFERENCES.thresholds;
  const minCoveragePct = options.minCoveragePct ?? DEFAULT_PREFERENCES.minCoveragePct;
  const minAgreementForStrongPct =
    options.minAgreementForStrongPct ?? DEFAULT_PREFERENCES.minAgreementForStrongPct;

  if (candles.length < 35) {
    const emptyRegime = classifyMarketRegime(candles, precomputedSeries?.series ?? computeAllIndicatorSeries(candles).series);
    return {
      canonicalId: options.canonicalId,
      exchange: options.exchange,
      marketType: options.marketType,
      displaySymbol: options.displaySymbol,
      timeframe: options.timeframe,
      status,
      classification: 'INSUFFICIENT_DATA',
      label: signalLabel('INSUFFICIENT_DATA'),
      directionalScore: 0,
      rawWeightedScore: 0,
      volatilityModifier: 1,
      agreement: {
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0,
        unavailableCount: 9,
        totalDirectional: 9,
        agreementPct: 0,
        coveragePct: 0,
      },
      dataQuality: 'INSUFFICIENT',
      signalStability: 'TRANSITIONING',
      historicalReliability: 'Not calibrated',
      regime: emptyRegime,
      indicators: [],
      marketCondition: {
        dominantDirection: 'Unavailable',
        momentumState: 'Unavailable',
        volumeConfirmation: 'Unavailable',
        volatilityCondition: 'Unavailable',
        trendStrength: 'Unavailable',
        structureStatus: 'Insufficient History',
      },
      supportingEvidence: [],
      contradictoryEvidence: [],
      invalidationConditions: [],
      safeguardNotes: [
        `Only ${candles.length} completed candles available; at least 35 completed bars are required before generating a technical signal.`,
      ],
      signalSetup: computeSignalSetup({
        displaySymbol: options.displaySymbol,
        classification: 'INSUFFICIENT_DATA',
        closePrice: candles.length > 0 ? candles[candles.length - 1].close : null,
        atr14: null,
        ema20: null,
        vwap: null,
      }),
      metadata: {
        candleClosePrice: candles.length > 0 ? candles[candles.length - 1].close : null,
        lastCompletedCandleTime: candles.length > 0 ? candles[candles.length - 1].openTime : null,
        calculatedAt: nowMs,
        candleCount: candles.length,
        freshness,
        engineVersion: ENGINE_VERSION,
        configVersion: CONFIG_VERSION,
      },
    };
  }

  const computed = precomputedSeries ?? computeAllIndicatorSeries(candles);
  const idx = candles.length - 1;
  const { indicators, volatilityModifier, isExtremeVolatility, emaMajorTrend } =
    evaluateIndicatorsAtIndex(candles, computed.series, computed.vwapMeta, idx, weights);
  const regime = classifyMarketRegime(candles, computed.series);

  const directionalIndicators = indicators.filter((ind) => ind.role === 'directional');
  const totalConfiguredWeight = directionalIndicators.reduce((s, i) => s + i.weight, 0);
  const activeIndicators = directionalIndicators.filter((i) => i.available && i.effectiveWeight > 0);
  const activeWeightSum = activeIndicators.reduce((s, i) => s + i.effectiveWeight, 0);
  const coveragePct =
    totalConfiguredWeight > 0 ? (activeWeightSum / totalConfiguredWeight) * 100 : 0;

  let weightedEvidenceSum = 0;
  for (const ind of activeIndicators) {
    weightedEvidenceSum += ind.evidence * ind.effectiveWeight;
  }

  const rawWeightedScore = activeWeightSum > 0 ? (weightedEvidenceSum / activeWeightSum) * 100 : 0;
  const adxCurrent = computed.series.adx14[idx];
  const rangeDamping =
    regime.trendRegime === 'Sideways / Range' && adxCurrent !== null && adxCurrent < 16 ? 0.55 : 1.0;
  const directionalScore = Number(
    clamp(rawWeightedScore * volatilityModifier * rangeDamping, -100, 100).toFixed(1),
  );

  const bullishCount = activeIndicators.filter((i) => i.bias === 'BULLISH').length;
  const bearishCount = activeIndicators.filter((i) => i.bias === 'BEARISH').length;
  const neutralCount = activeIndicators.filter((i) => i.bias === 'NEUTRAL').length;
  const unavailableCount = directionalIndicators.length - activeIndicators.length;
  const dominantCount = Math.max(bullishCount, bearishCount);
  const agreementPct =
    activeIndicators.length > 0 ? Math.round((dominantCount / activeIndicators.length) * 100) : 0;

  const agreement: SignalAgreement = {
    bullishCount,
    bearishCount,
    neutralCount,
    unavailableCount,
    totalDirectional: directionalIndicators.length,
    agreementPct,
    coveragePct: Math.round(coveragePct),
  };

  // Exact non-overlapping threshold boundaries
  let classification: SignalClassification;
  if (coveragePct < minCoveragePct) {
    classification = 'INSUFFICIENT_DATA';
  } else if (directionalScore >= thresholds.strongBullish) {
    classification = 'STRONG_BULLISH';
  } else if (directionalScore >= thresholds.bullish) {
    classification = 'BULLISH';
  } else if (directionalScore <= thresholds.strongBearish) {
    classification = 'STRONG_BEARISH';
  } else if (directionalScore <= thresholds.bearish) {
    classification = 'BEARISH';
  } else {
    classification = 'NEUTRAL';
  }

  const safeguardNotes: string[] = [];

  // Safeguard 1: Stale or unavailable data cannot confirm a strong signal
  if (freshness === 'STALE' || freshness === 'UNAVAILABLE') {
    safeguardNotes.push(`Data freshness is ${freshness}; strong classifications are capped until live feed recovers.`);
    if (classification === 'STRONG_BULLISH') classification = 'BULLISH';
    if (classification === 'STRONG_BEARISH') classification = 'BEARISH';
  }

  // Safeguard 2: Incomplete long-term EMA 200 coverage
  if (computed.series.ema200[idx] === null) {
    safeguardNotes.push('EMA 200 not yet warmed up (< 200 completed candles); long-term trend confirmation is partial.');
  }

  // Safeguard 3: Strong classification requires sufficient agreement & trend alignment
  if (classification === 'STRONG_BULLISH') {
    if (agreementPct < minAgreementForStrongPct || emaMajorTrend === 'BEARISH') {
      classification = 'BULLISH';
      safeguardNotes.push(
        'Downgraded from Strong Bullish to Bullish due to insufficient indicator agreement or EMA trend conflict.',
      );
    }
  } else if (classification === 'STRONG_BEARISH') {
    if (agreementPct < minAgreementForStrongPct || emaMajorTrend === 'BULLISH') {
      classification = 'BEARISH';
      safeguardNotes.push(
        'Downgraded from Strong Bearish to Bearish due to insufficient indicator agreement or EMA trend conflict.',
      );
    }
  }

  // Safeguard 4: Extreme volatility damping notice
  if (isExtremeVolatility) {
    safeguardNotes.push(
      `Extreme volatility detected (ATR modifier ${volatilityModifier.toFixed(2)}x); elevated noise reduces signal stability.`,
    );
    if (classification === 'STRONG_BULLISH') classification = 'BULLISH';
    if (classification === 'STRONG_BEARISH') classification = 'BEARISH';
  }

  // Safeguard 5: Higher timeframe conflict note
  if (
    options.higherTimeframeBias &&
    ((classification.includes('BULLISH') && options.higherTimeframeBias.includes('BEARISH')) ||
      (classification.includes('BEARISH') && options.higherTimeframeBias.includes('BULLISH')))
  ) {
    safeguardNotes.push(
      `Higher-timeframe bias (${signalLabel(options.higherTimeframeBias)}) conflicts with the ${options.timeframe} signal.`,
    );
  }

  // Supporting & contradictory evidence lists
  const isOverallBull = directionalScore >= 0;
  const supportingEvidence: string[] = [];
  const contradictoryEvidence: string[] = [];

  for (const ind of directionalIndicators) {
    if (!ind.available) continue;
    const ruleText = ind.rules[0] ?? ind.summary;
    if (isOverallBull) {
      if (ind.bias === 'BULLISH') supportingEvidence.push(`${ind.name}: ${ruleText}`);
      else if (ind.bias === 'BEARISH') contradictoryEvidence.push(`${ind.name}: ${ruleText}`);
    } else {
      if (ind.bias === 'BEARISH') supportingEvidence.push(`${ind.name}: ${ruleText}`);
      else if (ind.bias === 'BULLISH') contradictoryEvidence.push(`${ind.name}: ${ruleText}`);
    }
  }

  if (options.higherTimeframeBias) {
    const htfBull = options.higherTimeframeBias.includes('BULLISH');
    const htfBear = options.higherTimeframeBias.includes('BEARISH');
    if ((isOverallBull && htfBear) || (!isOverallBull && htfBull)) {
      contradictoryEvidence.push(
        `Higher timeframe remains ${signalLabel(options.higherTimeframeBias)}.`,
      );
    }
  }

  // Observable invalidation conditions (technical states only, never order instructions)
  const invalidationConditions: string[] = [];
  const ema50Val = computed.series.ema50[idx];
  const vwapVal = computed.series.vwap[idx];

  if (isOverallBull) {
    if (ema50Val !== null) {
      invalidationConditions.push(`Completed candle close below EMA 50 (${ema50Val.toFixed(4)}).`);
    }
    invalidationConditions.push('MACD line crossing below its signal line with negative histogram expansion.');
    if (vwapVal !== null) {
      invalidationConditions.push(`Loss of session VWAP (${vwapVal.toFixed(4)}) accompanied by rising selling volume.`);
    }
    invalidationConditions.push('DMI reversal where -DI overtakes +DI while ADX rises above 20.');
  } else {
    if (ema50Val !== null) {
      invalidationConditions.push(`Completed candle close reclaiming EMA 50 (${ema50Val.toFixed(4)}).`);
    }
    invalidationConditions.push('MACD bullish crossover above signal line with positive histogram momentum.');
    if (vwapVal !== null) {
      invalidationConditions.push(`Reclaim above session VWAP (${vwapVal.toFixed(4)}) on above-average RVOL.`);
    }
    invalidationConditions.push('DMI shift where +DI crosses above -DI with strengthening ADX.');
  }

  const dataQuality: SignalReport['dataQuality'] =
    coveragePct >= 95 && candles.length >= 200 && freshness === 'LIVE'
      ? 'HIGH'
      : coveragePct >= 75 && candles.length >= 60
        ? 'MODERATE'
        : coveragePct >= minCoveragePct
          ? 'LOW'
          : 'INSUFFICIENT';

  const signalStability: SignalReport['signalStability'] = isExtremeVolatility
    ? 'VOLATILE'
    : agreementPct >= 65 && Math.abs(directionalScore) >= 35
      ? 'STABLE'
      : 'TRANSITIONING';

  const adxVal = computed.series.adx14[idx];
  const rsiVal = computed.series.rsi14[idx];
  const rvolVal = computed.series.rvol20[idx];

  return {
    canonicalId: options.canonicalId,
    exchange: options.exchange,
    marketType: options.marketType,
    displaySymbol: options.displaySymbol,
    timeframe: options.timeframe,
    status,
    classification,
    label: signalLabel(classification),
    directionalScore,
    rawWeightedScore: Number(rawWeightedScore.toFixed(1)),
    volatilityModifier,
    agreement,
    dataQuality,
    signalStability,
    historicalReliability: 'Not calibrated',
    regime,
    indicators,
    marketCondition: {
      dominantDirection: regime.trendRegime,
      momentumState:
        rsiVal === null
          ? 'Unavailable'
          : rsiVal >= 65
            ? 'Strong Upside'
            : rsiVal >= 52
              ? 'Positive'
              : rsiVal <= 35
                ? 'Strong Downside'
                : rsiVal <= 48
                  ? 'Negative'
                  : 'Balanced',
      volumeConfirmation:
        rvolVal === null
          ? 'Unavailable'
          : rvolVal >= 1.5
            ? `Strong (${rvolVal.toFixed(2)}x)`
            : rvolVal >= 1.0
              ? `Adequate (${rvolVal.toFixed(2)}x)`
              : `Weak (${rvolVal.toFixed(2)}x)`,
      volatilityCondition: regime.volatilityRegime,
      trendStrength:
        adxVal === null
          ? 'Unavailable'
          : adxVal >= 30
            ? `Strong (ADX ${adxVal.toFixed(1)})`
            : adxVal >= 20
              ? `Moderate (ADX ${adxVal.toFixed(1)})`
              : `Weak (ADX ${adxVal.toFixed(1)})`,
      structureStatus:
        computed.series.bbBandwidth[idx] !== null &&
        indicators.find((i) => i.id === 'bollinger')?.rawValues.squeeze
          ? 'Volatility Compression / Squeeze'
          : regime.trendRegime.includes('Trend') || regime.trendRegime.includes('trend')
            ? 'Trending Expansion'
            : 'Consolidation / Rotation',
    },
    supportingEvidence,
    contradictoryEvidence,
    invalidationConditions,
    safeguardNotes,
    signalSetup: computeSignalSetup({
      displaySymbol: options.displaySymbol,
      classification,
      closePrice: candles[idx].close,
      atr14: computed.series.atr14[idx],
      ema20: computed.series.ema20[idx],
      vwap: computed.series.vwap[idx],
    }),
    metadata: {
      candleClosePrice: candles[idx].close,
      lastCompletedCandleTime: candles[idx].openTime,
      calculatedAt: nowMs,
      candleCount: candles.length,
      freshness,
      engineVersion: ENGINE_VERSION,
      configVersion: CONFIG_VERSION,
    },
  };
}

/**
 * Full analytical pipeline for a pair:
 * Validates OHLCV, separates completed vs forming candles, builds CONFIRMED report,
 * builds PROVISIONAL report (if a forming bar is present), detects patterns & S/R,
 * and runs non-repainting historical signal validation.
 */
export function runFullAssetAnalysis(
  rawCandles: Candle[],
  options: SignalEngineOptions,
): DualSignalResponse {
  const validated = validateCandles(rawCandles, options.timeframe, options.nowMs);
  const completed = validated.completedCandles;
  const fullSeriesInput = validated.formingCandle
    ? [...completed, validated.formingCandle]
    : completed;

  const confirmedComputed = computeAllIndicatorSeries(completed);
  const confirmed = buildSignalReport(completed, 'CONFIRMED', options, confirmedComputed);

  let provisional: SignalReport | null = null;
  let displaySeries = confirmedComputed.series;

  if (validated.formingCandle && completed.length >= 34) {
    const provComputed = computeAllIndicatorSeries(fullSeriesInput);
    displaySeries = provComputed.series;
    provisional = buildSignalReport(fullSeriesInput, 'PROVISIONAL', options, provComputed);
  }

  const candlestickPatterns = detectCandlestickPatterns(completed, options.timeframe);
  const structuralPatterns = detectStructuralPatterns(completed, options.timeframe);
  const supportResistance = detectSupportResistance(completed);
  const validation = evaluateHistoricalSignals(
    completed,
    options.canonicalId,
    options.exchange,
    options.marketType,
    options.displaySymbol,
    options.timeframe,
    options.weights,
  );

  // Refine signalSetup levels using detected structural Support/Resistance zones
  if (completed.length > 0) {
    const cIdx = completed.length - 1;
    confirmed.signalSetup = computeSignalSetup({
      displaySymbol: options.displaySymbol,
      classification: confirmed.classification,
      closePrice: completed[cIdx].close,
      atr14: confirmedComputed.series.atr14[cIdx],
      ema20: confirmedComputed.series.ema20[cIdx],
      vwap: confirmedComputed.series.vwap[cIdx],
      supportResistance,
    });
  }
  if (provisional && fullSeriesInput.length > 0) {
    const pIdx = fullSeriesInput.length - 1;
    provisional.signalSetup = computeSignalSetup({
      displaySymbol: options.displaySymbol,
      classification: provisional.classification,
      closePrice: fullSeriesInput[pIdx].close,
      atr14: displaySeries.atr14[pIdx],
      ema20: displaySeries.ema20[pIdx],
      vwap: displaySeries.vwap[pIdx],
      supportResistance,
    });
  }

  // Attach measured historical reliability if sample is sufficient on 5-bar horizon
  const h5 = validation.horizons.find((h) => h.horizonBars === 5);
  if (h5 && h5.sufficientSample && h5.directionalAccuracyPct !== null) {
    confirmed.historicalReliability = `${h5.directionalAccuracyPct.toFixed(1)}% 5-bar directional match (n=${h5.observations})`;
  }

  return {
    confirmed,
    provisional,
    series: displaySeries,
    patterns: [...structuralPatterns, ...candlestickPatterns],
    supportResistance,
    validation,
  };
}

/**
 * Detects discrete confirmed signal events between the prior completed candle and the latest completed candle.
 */
export function detectConfirmedSignalEvents(
  completedCandles: Candle[],
  confirmedReport: SignalReport,
  series: IndicatorSeriesPack,
  previousClassification?: SignalClassification | null,
): SignalEventRecord[] {
  const n = completedCandles.length;
  if (n < 40 || confirmedReport.classification === 'INSUFFICIENT_DATA') return [];

  const idx = n - 1;
  const prevIdx = n - 2;
  const candle = completedCandles[idx];
  const events: SignalEventRecord[] = [];

  const pushEvent = (eventType: string, summary: string, changes: string[]) => {
    events.push({
      id: `${confirmedReport.canonicalId}:${confirmedReport.timeframe}:${candle.openTime}:${eventType}`,
      canonicalId: confirmedReport.canonicalId,
      displaySymbol: confirmedReport.displaySymbol,
      exchange: confirmedReport.exchange,
      marketType: confirmedReport.marketType,
      timeframe: confirmedReport.timeframe,
      eventType,
      classification: confirmedReport.classification,
      directionalScore: confirmedReport.directionalScore,
      agreementPct: confirmedReport.agreement.agreementPct,
      candleTimestamp: candle.openTime,
      triggeredAt: Date.now(),
      summary,
      indicatorChanges: changes,
      signalSetup: confirmedReport.signalSetup,
    });
  };

  if (previousClassification && previousClassification !== confirmedReport.classification) {
    pushEvent(
      'SIGNAL_CLASSIFICATION_CHANGED',
      `${confirmedReport.displaySymbol} shifted from ${signalLabel(previousClassification)} to ${confirmedReport.label}.`,
      [`Score: ${confirmedReport.directionalScore}`, `Agreement: ${confirmedReport.agreement.agreementPct}%`],
    );
  }

  // MACD Crossover
  const m = series.macdLine[idx];
  const ms = series.macdSignal[idx];
  const pm = series.macdLine[prevIdx];
  const pms = series.macdSignal[prevIdx];
  if (m !== null && ms !== null && pm !== null && pms !== null) {
    if (pm <= pms && m > ms) {
      pushEvent('MACD_BULLISH_CROSSOVER', `MACD crossed above signal line on ${confirmedReport.timeframe}.`, [
        `MACD: ${m.toFixed(4)}`,
        `Signal: ${ms.toFixed(4)}`,
      ]);
    } else if (pm >= pms && m < ms) {
      pushEvent('MACD_BEARISH_CROSSOVER', `MACD crossed below signal line on ${confirmedReport.timeframe}.`, [
        `MACD: ${m.toFixed(4)}`,
        `Signal: ${ms.toFixed(4)}`,
      ]);
    }
  }

  // EMA 20/50 Crossover
  const e20 = series.ema20[idx];
  const e50 = series.ema50[idx];
  const pe20 = series.ema20[prevIdx];
  const pe50 = series.ema50[prevIdx];
  if (e20 !== null && e50 !== null && pe20 !== null && pe50 !== null) {
    if (pe20 <= pe50 && e20 > e50) {
      pushEvent('BULLISH_EMA_CROSSOVER', `EMA 20 crossed above EMA 50 on ${confirmedReport.timeframe}.`, [
        `EMA 20: ${e20.toFixed(4)}`,
        `EMA 50: ${e50.toFixed(4)}`,
      ]);
    } else if (pe20 >= pe50 && e20 < e50) {
      pushEvent('BEARISH_EMA_CROSSOVER', `EMA 20 crossed below EMA 50 on ${confirmedReport.timeframe}.`, [
        `EMA 20: ${e20.toFixed(4)}`,
        `EMA 50: ${e50.toFixed(4)}`,
      ]);
    }
  }

  // RSI Oversold/Overbought Transition
  const rsi = series.rsi14[idx];
  const prsi = series.rsi14[prevIdx];
  if (rsi !== null && prsi !== null) {
    if (prsi >= 30 && rsi < 30) {
      pushEvent('RSI_OVERSOLD_TRANSITION', `RSI 14 entered oversold territory (${rsi.toFixed(1)}).`, [
        `Prior RSI: ${prsi.toFixed(1)}`,
        `Current RSI: ${rsi.toFixed(1)}`,
      ]);
    } else if (prsi <= 70 && rsi > 70) {
      pushEvent('RSI_OVERBOUGHT_TRANSITION', `RSI 14 entered overbought territory (${rsi.toFixed(1)}).`, [
        `Prior RSI: ${prsi.toFixed(1)}`,
        `Current RSI: ${rsi.toFixed(1)}`,
      ]);
    }
  }

  // Volume Breakout
  const rvol = series.rvol20[idx];
  if (rvol !== null && rvol >= 1.85) {
    pushEvent('VOLUME_BREAKOUT', `Abnormal volume participation (${rvol.toFixed(2)}x 20-bar baseline).`, [
      `RVOL 20: ${rvol.toFixed(2)}x`,
      `Close: ${candle.close}`,
    ]);
  }

  // VWAP Reclaim / Loss
  const vwap = series.vwap[idx];
  const pvwap = series.vwap[prevIdx];
  if (vwap !== null && pvwap !== null) {
    const pclose = completedCandles[prevIdx].close;
    if (pclose <= pvwap && candle.close > vwap) {
      pushEvent('VWAP_RECLAIM', `Price reclaimed session VWAP at ${vwap.toFixed(4)}.`, [
        `Close: ${candle.close}`,
        `VWAP: ${vwap.toFixed(4)}`,
      ]);
    } else if (pclose >= pvwap && candle.close < vwap) {
      pushEvent('VWAP_LOSS', `Price lost session VWAP at ${vwap.toFixed(4)}.`, [
        `Close: ${candle.close}`,
        `VWAP: ${vwap.toFixed(4)}`,
      ]);
    }
  }

  // Strong directional classification checkpoint if no micro-event fired
  if (
    events.length === 0 &&
    (confirmedReport.classification === 'STRONG_BULLISH' ||
      confirmedReport.classification === 'STRONG_BEARISH')
  ) {
    pushEvent(
      confirmedReport.classification === 'STRONG_BULLISH'
        ? 'STRONG_BULLISH_CONFLUENCE'
        : 'STRONG_BEARISH_CONFLUENCE',
      `${confirmedReport.displaySymbol} confirmed ${confirmedReport.label} (${confirmedReport.directionalScore > 0 ? '+' : ''}${confirmedReport.directionalScore}).`,
      [
        `Agreement: ${confirmedReport.agreement.agreementPct}%`,
        `Regime: ${confirmedReport.regime.trendRegime}`,
      ],
    );
  }

  return events;
}
