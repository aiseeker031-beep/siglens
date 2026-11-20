import type {
  Candle,
  IndicatorSeriesPack,
  MarketRegimeReport,
  TrendRegime,
  VolatilityRegime,
} from '../shared/types';

/**
 * Deterministic Market Regime Classifier.
 * Separates trend direction from volatility state using ADX, EMA structure,
 * price slope, realized volatility, ATR%, Bollinger bandwidth, and RVOL.
 */
export function classifyMarketRegime(
  candles: Candle[],
  series: IndicatorSeriesPack,
): MarketRegimeReport {
  const idx = candles.length - 1;
  if (idx < 20) {
    return {
      trendRegime: 'Transition / Uncertain',
      volatilityRegime: 'Normal Volatility',
      combinedLabel: 'Transition / Uncertain · Normal Volatility',
      triggers: ['Insufficient completed candle history (< 20 bars) for full regime classification.'],
      metrics: {
        adx: null,
        emaAlignment: 'Unavailable',
        priceSlopePct: null,
        atrPct: null,
        realizedVolPct: null,
        bbBandwidthPct: null,
        rvol: null,
      },
    };
  }

  const close = candles[idx].close;
  const ema20 = series.ema20[idx];
  const ema50 = series.ema50[idx];
  const ema200 = series.ema200[idx];
  const adx = series.adx14[idx];
  const plusDi = series.plusDi14[idx];
  const minusDi = series.minusDi14[idx];
  const atrPct = series.atrPct[idx];
  const bbBandwidth = series.bbBandwidth[idx];
  const rvol = series.rvol20[idx];

  // 20-bar price slope (%)
  const baseClose = candles[idx - 20].close;
  const priceSlopePct = baseClose > 0 ? ((close - baseClose) / baseClose) * 100 : 0;

  // Realized volatility (20-bar standard deviation of log returns, expressed in % per bar)
  const returns: number[] = [];
  for (let i = idx - 19; i <= idx; i++) {
    if (candles[i - 1].close > 0 && candles[i].close > 0) {
      returns.push(Math.log(candles[i].close / candles[i - 1].close));
    }
  }
  const meanRet = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const variance =
    returns.reduce((acc, r) => acc + (r - meanRet) * (r - meanRet), 0) / Math.max(1, returns.length);
  const realizedVolPct = Math.sqrt(variance) * 100;

  // Historical baseline bandwidth & ATR% for relative volatility comparison
  const histAtr = series.atrPct
    .slice(Math.max(0, idx - 60), idx + 1)
    .filter((v): v is number => v !== null);
  const avgAtrPct = histAtr.length > 0 ? histAtr.reduce((a, b) => a + b, 0) / histAtr.length : atrPct ?? 1;

  const histBw = series.bbBandwidth
    .slice(Math.max(0, idx - 60), idx + 1)
    .filter((v): v is number => v !== null);
  const avgBw = histBw.length > 0 ? histBw.reduce((a, b) => a + b, 0) / histBw.length : bbBandwidth ?? 4;

  const triggers: string[] = [];

  // 1. Volatility regime classification (independent of trend direction)
  let volatilityRegime: VolatilityRegime = 'Normal Volatility';
  const atrRatio = atrPct !== null && avgAtrPct > 0 ? atrPct / avgAtrPct : 1;
  const bwRatio = bbBandwidth !== null && avgBw > 0 ? bbBandwidth / avgBw : 1;

  if (atrRatio >= 1.45 || (atrPct !== null && atrPct >= 3.2) || bwRatio >= 1.55) {
    volatilityRegime = 'High Volatility';
    triggers.push(
      `ATR% (${atrPct?.toFixed(2) ?? '—'}%) is ${atrRatio.toFixed(2)}x its 60-bar average; realized bar vol ${realizedVolPct.toFixed(2)}%.`,
    );
  } else if (atrRatio <= 0.72 || bwRatio <= 0.65) {
    volatilityRegime = 'Low Volatility';
    triggers.push(
      `Bollinger bandwidth (${bbBandwidth?.toFixed(2) ?? '—'}%) compressed to ${(bwRatio * 100).toFixed(0)}% of baseline.`,
    );
  } else {
    triggers.push(
      `Volatility within historical range (ATR% ${atrPct?.toFixed(2) ?? '—'}%, BB width ${bbBandwidth?.toFixed(2) ?? '—'}%).`,
    );
  }

  // 2. EMA alignment label
  let emaAlignment = 'Mixed';
  let bullishStructure = false;
  let bearishStructure = false;

  if (ema20 !== null && ema50 !== null && ema200 !== null) {
    if (close > ema20 && ema20 > ema50 && ema50 > ema200) {
      emaAlignment = 'Bullish Stacked (Price > EMA 20 > 50 > 200)';
      bullishStructure = true;
    } else if (close < ema20 && ema20 < ema50 && ema50 < ema200) {
      emaAlignment = 'Bearish Stacked (Price < EMA 20 < 50 < 200)';
      bearishStructure = true;
    } else if (close > ema50 && ema20 > ema50) {
      emaAlignment = 'Constructive (Price & EMA 20 > EMA 50)';
      bullishStructure = true;
    } else if (close < ema50 && ema20 < ema50) {
      emaAlignment = 'Weakening (Price & EMA 20 < EMA 50)';
      bearishStructure = true;
    }
  } else if (ema20 !== null && ema50 !== null) {
    if (close > ema20 && ema20 > ema50) {
      emaAlignment = 'Short-Term Bullish (Price > EMA 20 > 50)';
      bullishStructure = true;
    } else if (close < ema20 && ema20 < ema50) {
      emaAlignment = 'Short-Term Bearish (Price < EMA 20 < 50)';
      bearishStructure = true;
    }
  }

  // 3. Trend regime classification
  let trendRegime: TrendRegime = 'Transition / Uncertain';
  const adxVal = adx ?? 0;
  const diBull = plusDi !== null && minusDi !== null && plusDi > minusDi;
  const diBear = plusDi !== null && minusDi !== null && minusDi > plusDi;

  if (adxVal >= 28 && bullishStructure && diBull && priceSlopePct > 1.2) {
    trendRegime = 'Strong Uptrend';
    triggers.push(`ADX at ${adxVal.toFixed(1)} with +DI > -DI and ${emaAlignment}.`);
  } else if (adxVal >= 28 && bearishStructure && diBear && priceSlopePct < -1.2) {
    trendRegime = 'Strong Downtrend';
    triggers.push(`ADX at ${adxVal.toFixed(1)} with -DI > +DI and ${emaAlignment}.`);
  } else if (adxVal < 18 && Math.abs(priceSlopePct) < 2.2) {
    trendRegime = 'Sideways / Range';
    triggers.push(`Low ADX (${adxVal.toFixed(1)}) with flat 20-bar slope (${priceSlopePct.toFixed(2)}%).`);
  } else if (bullishStructure && (diBull || priceSlopePct > 0.5)) {
    trendRegime = 'Moderate Uptrend';
    triggers.push(`Constructive EMA structure with ${priceSlopePct >= 0 ? '+' : ''}${priceSlopePct.toFixed(2)}% 20-bar slope.`);
  } else if (bearishStructure && (diBear || priceSlopePct < -0.5)) {
    trendRegime = 'Moderate Downtrend';
    triggers.push(`Bearish EMA structure with ${priceSlopePct.toFixed(2)}% 20-bar slope.`);
  } else {
    trendRegime = 'Transition / Uncertain';
    triggers.push(`Mixed directional signals (EMA: ${emaAlignment}, ADX: ${adx?.toFixed(1) ?? '—'}).`);
  }

  if (rvol !== null && rvol >= 1.6) {
    triggers.push(`Elevated volume participation (RVOL ${rvol.toFixed(2)}x).`);
  }

  return {
    trendRegime,
    volatilityRegime,
    combinedLabel: `${trendRegime} · ${volatilityRegime}`,
    triggers,
    metrics: {
      adx,
      emaAlignment,
      priceSlopePct,
      atrPct,
      realizedVolPct,
      bbBandwidthPct: bbBandwidth,
      rvol,
    },
  };
}
