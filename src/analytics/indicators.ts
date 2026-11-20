import type { Candle, IndicatorSeriesPack } from '../shared/types';

/**
 * Exponential Moving Average seeded with the initial Simple Moving Average
 * over the first `period` finite values.
 */
export function calculateEMA(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  let seedSum = 0;
  let seedCount = 0;
  let prevEma: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      out[i] = null;
      continue;
    }

    if (prevEma === null) {
      seedSum += v;
      seedCount++;
      if (seedCount === period) {
        prevEma = seedSum / period;
        out[i] = prevEma;
      }
    } else {
      prevEma = v * k + prevEma * (1 - k);
      out[i] = prevEma;
    }
  }
  return out;
}

export function calculateSMA(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let windowSum = 0;
  let validInWindow = 0;

  for (let i = 0; i < values.length; i++) {
    const cur = values[i];
    if (cur !== null && Number.isFinite(cur)) {
      windowSum += cur;
      validInWindow++;
    }
    if (i >= period) {
      const old = values[i - period];
      if (old !== null && Number.isFinite(old)) {
        windowSum -= old;
        validInWindow--;
      }
    }
    if (i >= period - 1 && validInWindow === period) {
      out[i] = windowSum / period;
    }
  }
  return out;
}

/**
 * Relative Strength Index (Wilder's Smoothing, default period 14).
 * Handles boundary cases cleanly: avgLoss === 0 => 100, avgGain === 0 => 0, both 0 => 50.
 */
export function calculateRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period || period <= 0) return out;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gainSum += delta;
    else lossSum += -delta;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const toRsi = (ag: number, al: number): number => {
    if (ag === 0 && al === 0) return 50;
    if (al === 0) return 100;
    if (ag === 0) return 0;
    const rs = ag / al;
    return 100 - 100 / (1 + rs);
  };

  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }

  return out;
}

/**
 * MACD (12, 26, 9) using SMA-seeded EMAs.
 */
export function calculateMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });

  const signalLine = calculateEMA(macdLine, signalPeriod);
  const histogram: (number | null)[] = closes.map((_, i) => {
    const m = macdLine[i];
    const sig = signalLine[i];
    return m !== null && sig !== null ? m - sig : null;
  });

  return { macdLine, signalLine, histogram };
}

/**
 * True Range and Wilder's Average True Range (ATR 14).
 */
export function calculateATR(
  candles: Candle[],
  period = 14,
): { atr: (number | null)[]; atrPct: (number | null)[]; tr: number[] } {
  const n = candles.length;
  const tr: number[] = new Array(n).fill(0);
  const atr: (number | null)[] = new Array(n).fill(null);
  const atrPct: (number | null)[] = new Array(n).fill(null);

  if (n === 0) return { atr, atrPct, tr };

  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  if (n < period) return { atr, atrPct, tr };

  let sumTr = 0;
  for (let i = 0; i < period; i++) sumTr += tr[i];
  let prevAtr = sumTr / period;
  atr[period - 1] = prevAtr;
  atrPct[period - 1] = candles[period - 1].close > 0 ? (prevAtr / candles[period - 1].close) * 100 : null;

  for (let i = period; i < n; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    atr[i] = prevAtr;
    atrPct[i] = candles[i].close > 0 ? (prevAtr / candles[i].close) * 100 : null;
  }

  return { atr, atrPct, tr };
}

/**
 * Wilder's ADX / +DI / -DI (default period 14).
 */
export function calculateADX(
  candles: Candle[],
  period = 14,
): {
  adx: (number | null)[];
  plusDi: (number | null)[];
  minusDi: (number | null)[];
} {
  const n = candles.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDi: (number | null)[] = new Array(n).fill(null);
  const minusDi: (number | null)[] = new Array(n).fill(null);

  if (n <= period * 2) return { adx, plusDi, minusDi };

  const tr: number[] = new Array(n).fill(0);
  const plusDm: number[] = new Array(n).fill(0);
  const minusDm: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const pc = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - pc),
      Math.abs(candles[i].low - pc),
    );
  }

  let smoothTr = 0;
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;
  for (let i = 1; i <= period; i++) {
    smoothTr += tr[i];
    smoothPlusDm += plusDm[i];
    smoothMinusDm += minusDm[i];
  }

  const dx: (number | null)[] = new Array(n).fill(null);

  const computeDiDx = (idx: number) => {
    const pdi = smoothTr > 0 ? (100 * smoothPlusDm) / smoothTr : 0;
    const mdi = smoothTr > 0 ? (100 * smoothMinusDm) / smoothTr : 0;
    plusDi[idx] = pdi;
    minusDi[idx] = mdi;
    const diSum = pdi + mdi;
    dx[idx] = diSum > 0 ? (100 * Math.abs(pdi - mdi)) / diSum : 0;
  };

  computeDiDx(period);

  for (let i = period + 1; i < n; i++) {
    smoothTr = smoothTr - smoothTr / period + tr[i];
    smoothPlusDm = smoothPlusDm - smoothPlusDm / period + plusDm[i];
    smoothMinusDm = smoothMinusDm - smoothMinusDm / period + minusDm[i];
    computeDiDx(i);
  }

  let dxSum = 0;
  const adxStart = period * 2 - 1;
  for (let i = period; i <= adxStart; i++) {
    dxSum += dx[i] ?? 0;
  }
  let prevAdx = dxSum / period;
  adx[adxStart] = prevAdx;

  for (let i = adxStart + 1; i < n; i++) {
    prevAdx = (prevAdx * (period - 1) + (dx[i] ?? 0)) / period;
    adx[i] = prevAdx;
  }

  return { adx, plusDi, minusDi };
}

/**
 * Bollinger Bands (20-period SMA, 2 population standard deviations) + Bandwidth %.
 */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2,
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  bandwidth: (number | null)[];
} {
  const n = closes.length;
  const upper: (number | null)[] = new Array(n).fill(null);
  const middle: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  const bandwidth: (number | null)[] = new Array(n).fill(null);

  if (n < period) return { upper, middle, lower, bandwidth };

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;

    let sqDiffSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - mean;
      sqDiffSum += d * d;
    }
    const sd = Math.sqrt(sqDiffSum / period);

    middle[i] = mean;
    upper[i] = mean + stdDevMult * sd;
    lower[i] = mean - stdDevMult * sd;
    bandwidth[i] = mean > 0 ? ((upper[i]! - lower[i]!) / mean) * 100 : null;
  }

  return { upper, middle, lower, bandwidth };
}

/**
 * Stochastic RSI (RSI 14, Stoch window 14, %K SMA 3, %D SMA 3).
 * Outputs 0..100 scale.
 */
export function calculateStochRSI(
  rsiSeries: (number | null)[],
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: (number | null)[]; d: (number | null)[] } {
  const n = rsiSeries.length;
  const rawStoch: (number | null)[] = new Array(n).fill(null);

  for (let i = stochPeriod - 1; i < n; i++) {
    let minRsi = Infinity;
    let maxRsi = -Infinity;
    let valid = true;

    for (let j = i - stochPeriod + 1; j <= i; j++) {
      const v = rsiSeries[j];
      if (v === null) {
        valid = false;
        break;
      }
      if (v < minRsi) minRsi = v;
      if (v > maxRsi) maxRsi = v;
    }

    if (!valid) continue;
    const cur = rsiSeries[i]!;
    const denom = maxRsi - minRsi;
    rawStoch[i] = denom > 1e-12 ? ((cur - minRsi) / denom) * 100 : 50;
  }

  const k = calculateSMA(rawStoch, kSmooth);
  const d = calculateSMA(k, dSmooth);
  return { k, d };
}

/**
 * On-Balance Volume (OBV).
 */
export function calculateOBV(candles: Candle[]): number[] {
  const n = candles.length;
  const obv: number[] = new Array(n).fill(0);
  if (n === 0) return obv;

  obv[0] = 0;
  for (let i = 1; i < n; i++) {
    if (candles[i].close > candles[i - 1].close) {
      obv[i] = obv[i - 1] + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      obv[i] = obv[i - 1] - candles[i].volume;
    } else {
      obv[i] = obv[i - 1];
    }
  }
  return obv;
}

/**
 * Session-Anchored VWAP using explicit UTC day boundaries (00:00:00 UTC).
 * For daily/weekly candles where each bar is >= 1 UTC day, anchors to a rolling 20-bar VWAP
 * and explicitly marks session anchoring validity.
 */
export function calculateSessionVWAP(candles: Candle[]): {
  vwap: (number | null)[];
  anchorMode: 'UTC_DAILY_SESSION' | 'ROLLING_20_BAR';
  sessionBars: number;
} {
  const n = candles.length;
  const vwap: (number | null)[] = new Array(n).fill(null);
  if (n === 0) {
    return { vwap, anchorMode: 'UTC_DAILY_SESSION', sessionBars: 0 };
  }

  // Detect if bar spacing is >= 1 day
  const barStep = n >= 2 ? candles[n - 1].openTime - candles[n - 2].openTime : 0;
  const isDailyOrHigher = barStep >= 86_400_000 * 0.9;

  if (isDailyOrHigher) {
    const window = 20;
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - window + 1);
      let pv = 0;
      let vol = 0;
      for (let j = start; j <= i; j++) {
        const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
        pv += tp * candles[j].volume;
        vol += candles[j].volume;
      }
      vwap[i] = vol > 0 ? pv / vol : null;
    }
    return { vwap, anchorMode: 'ROLLING_20_BAR', sessionBars: Math.min(n, window) };
  }

  let currentDay = -1;
  let cumPV = 0;
  let cumVol = 0;
  let sessionBars = 0;

  for (let i = 0; i < n; i++) {
    const dayKey = Math.floor(candles[i].openTime / 86_400_000);
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      cumPV = 0;
      cumVol = 0;
      sessionBars = 0;
    }
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += tp * candles[i].volume;
    cumVol += candles[i].volume;
    sessionBars++;
    vwap[i] = cumVol > 0 ? cumPV / cumVol : null;
  }

  return { vwap, anchorMode: 'UTC_DAILY_SESSION', sessionBars };
}

/**
 * Relative Volume (RVOL) compared against the mean volume of the previous `period`
 * completed bars (excludes the current bar from its own baseline).
 */
export function calculateRVOL(candles: Candle[], period = 20): (number | null)[] {
  const n = candles.length;
  const rvol: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return rvol;

  let rollingVol = 0;
  for (let i = 0; i < period; i++) {
    rollingVol += candles[i].volume;
  }

  for (let i = period; i < n; i++) {
    const avgPrev = rollingVol / period;
    rvol[i] = avgPrev > 0 ? candles[i].volume / avgPrev : null;
    rollingVol = rollingVol - candles[i - period].volume + candles[i].volume;
  }

  return rvol;
}

/**
 * Computes all 10 indicator series over a validated candle array.
 */
export function computeAllIndicatorSeries(candles: Candle[]): {
  series: IndicatorSeriesPack;
  vwapMeta: { anchorMode: 'UTC_DAILY_SESSION' | 'ROLLING_20_BAR'; sessionBars: number };
} {
  const closes = candles.map((c) => c.close);
  const ema9 = calculateEMA(closes, 9);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema100 = calculateEMA(closes, 100);
  const ema200 = calculateEMA(closes, 200);
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const adxPack = calculateADX(candles, 14);
  const bb = calculateBollingerBands(closes, 20, 2);
  const stoch = calculateStochRSI(rsi14, 14, 3, 3);
  const obv = calculateOBV(candles);
  const vwapRes = calculateSessionVWAP(candles);
  const rvol20 = calculateRVOL(candles, 20);
  const atrPack = calculateATR(candles, 14);

  return {
    series: {
      ema9,
      ema20,
      ema50,
      ema100,
      ema200,
      rsi14,
      macdLine: macd.macdLine,
      macdSignal: macd.signalLine,
      macdHist: macd.histogram,
      adx14: adxPack.adx,
      plusDi14: adxPack.plusDi,
      minusDi14: adxPack.minusDi,
      bbUpper: bb.upper,
      bbMiddle: bb.middle,
      bbLower: bb.lower,
      bbBandwidth: bb.bandwidth,
      stochRsiK: stoch.k,
      stochRsiD: stoch.d,
      obv,
      vwap: vwapRes.vwap,
      rvol20,
      atr14: atrPack.atr,
      atrPct: atrPack.atrPct,
    },
    vwapMeta: {
      anchorMode: vwapRes.anchorMode,
      sessionBars: vwapRes.sessionBars,
    },
  };
}

/**
 * Detect simple swing-based bullish or bearish divergence between price and an oscillator.
 */
export function detectDivergence(
  candles: Candle[],
  oscillator: (number | null)[],
  lookback = 30,
): 'BULLISH' | 'BEARISH' | 'NONE' {
  const n = candles.length;
  if (n < lookback + 5) return 'NONE';
  const start = Math.max(2, n - lookback);
  const end = n - 2;

  const swingLows: number[] = [];
  const swingHighs: number[] = [];

  for (let i = start; i <= end; i++) {
    if (oscillator[i] === null) continue;
    if (
      candles[i].low <= candles[i - 1].low &&
      candles[i].low <= candles[i - 2].low &&
      candles[i].low <= candles[i + 1].low
    ) {
      swingLows.push(i);
    }
    if (
      candles[i].high >= candles[i - 1].high &&
      candles[i].high >= candles[i - 2].high &&
      candles[i].high >= candles[i + 1].high
    ) {
      swingHighs.push(i);
    }
  }

  // Bullish divergence: lower price low, higher oscillator low
  if (swingLows.length >= 2) {
    const prevIdx = swingLows[swingLows.length - 2];
    const lastIdx = swingLows[swingLows.length - 1];
    const oscPrev = oscillator[prevIdx];
    const oscLast = oscillator[lastIdx];
    if (
      oscPrev !== null &&
      oscLast !== null &&
      candles[lastIdx].low < candles[prevIdx].low * 0.999 &&
      oscLast > oscPrev + 1.5
    ) {
      return 'BULLISH';
    }
  }

  // Bearish divergence: higher price high, lower oscillator high
  if (swingHighs.length >= 2) {
    const prevIdx = swingHighs[swingHighs.length - 2];
    const lastIdx = swingHighs[swingHighs.length - 1];
    const oscPrev = oscillator[prevIdx];
    const oscLast = oscillator[lastIdx];
    if (
      oscPrev !== null &&
      oscLast !== null &&
      candles[lastIdx].high > candles[prevIdx].high * 1.001 &&
      oscLast < oscPrev - 1.5
    ) {
      return 'BEARISH';
    }
  }

  return 'NONE';
}

/**
 * Heikin-Ashi transformation derived strictly from real OHLC candles.
 */
export function toHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (result[i - 1].open + result[i - 1].close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    result.push({
      ...c,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    });
  }
  return result;
}
