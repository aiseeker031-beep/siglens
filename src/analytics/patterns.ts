import type {
  Candle,
  PatternDetection,
  SupportResistanceZone,
  Timeframe,
} from '../shared/types';

interface SwingPoint {
  index: number;
  price: number;
  time: number;
  type: 'HIGH' | 'LOW';
}

function findSwingPivots(candles: Candle[], leftRight = 3): SwingPoint[] {
  const pivots: SwingPoint[] = [];
  for (let i = leftRight; i < candles.length - leftRight; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) {
      pivots.push({ index: i, price: candles[i].high, time: candles[i].openTime, type: 'HIGH' });
    }
    if (isLow) {
      pivots.push({ index: i, price: candles[i].low, time: candles[i].openTime, type: 'LOW' });
    }
  }
  return pivots;
}

/**
 * Deterministic Candlestick Pattern Detection on recent completed candles.
 * Supports: Doji, Hammer, Inverted Hammer, Shooting Star, Bullish/Bearish Engulfing,
 * Morning/Evening Star, Three White Soldiers, Three Black Crows, Harami.
 */
export function detectCandlestickPatterns(
  candles: Candle[],
  timeframe: Timeframe,
): PatternDetection[] {
  const detected: PatternDetection[] = [];
  const n = candles.length;
  if (n < 5) return detected;

  const scanStart = Math.max(3, n - 12);

  for (let i = scanStart; i < n; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];

    const range = c.high - c.low;
    if (range <= 0) continue;

    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const isBull = c.close > c.open;
    const isBear = c.close < c.open;

    const prevBody = Math.abs(prev.close - prev.open);
    const prevBull = prev.close > prev.open;
    const prevBear = prev.close < prev.open;

    // 5-bar local trend context
    const priorTrend = c.close - candles[Math.max(0, i - 5)].close;

    // 1. Doji
    if (body / range <= 0.1) {
      detected.push({
        id: `cdl-doji-${c.openTime}`,
        name: 'Doji',
        category: 'candlestick',
        direction: 'NEUTRAL',
        timeframe,
        startTimestamp: c.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: c.high, lower: c.low },
        detectionMethod: `Body (${((body / range) * 100).toFixed(1)}% of bar range) <= 10% threshold.`,
        invalidationCriteria: 'Directional close breaking outside Doji high/low range.',
        qualityScore: Math.round((1 - body / range) * 85),
        qualityMeaning: 'Geometric body-to-range compression fit (not predictive probability).',
      });
    }

    // 2. Hammer (downtrend context, long lower wick >= 2x body, tiny upper wick)
    if (priorTrend < 0 && lowerWick >= body * 2 && upperWick <= body * 0.5 && body / range >= 0.08) {
      detected.push({
        id: `cdl-hammer-${c.openTime}`,
        name: 'Hammer',
        category: 'candlestick',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: c.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: c.high, lower: c.low, breakoutLevel: c.high },
        detectionMethod: `Lower wick (${(lowerWick / Math.max(body, 1e-9)).toFixed(1)}x body) after downward drift.`,
        invalidationCriteria: `Close below Hammer low (${c.low.toFixed(4)}).`,
        qualityScore: 74,
        qualityMeaning: 'Structural ratio fit based on wick-to-body geometry.',
      });
    }

    // 3. Inverted Hammer
    if (priorTrend < 0 && upperWick >= body * 2 && lowerWick <= body * 0.5 && body / range >= 0.08) {
      detected.push({
        id: `cdl-invhammer-${c.openTime}`,
        name: 'Inverted Hammer',
        category: 'candlestick',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: c.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: c.high, lower: c.low, breakoutLevel: c.high },
        detectionMethod: `Upper wick >= 2x body after downward drift with minimal lower shadow.`,
        invalidationCriteria: `Close below bar low (${c.low.toFixed(4)}).`,
        qualityScore: 68,
        qualityMeaning: 'Structural ratio fit based on wick-to-body geometry.',
      });
    }

    // 4. Shooting Star
    if (priorTrend > 0 && upperWick >= body * 2 && lowerWick <= body * 0.5 && body / range >= 0.08) {
      detected.push({
        id: `cdl-shootingstar-${c.openTime}`,
        name: 'Shooting Star',
        category: 'candlestick',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: c.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: c.high, lower: c.low, breakoutLevel: c.low },
        detectionMethod: `Upper rejection wick >= 2x body following an upward swing.`,
        invalidationCriteria: `Close above Shooting Star high (${c.high.toFixed(4)}).`,
        qualityScore: 74,
        qualityMeaning: 'Structural ratio fit based on wick-to-body geometry.',
      });
    }

    // 5. Bullish Engulfing
    if (
      prevBear &&
      isBull &&
      c.open <= prev.close &&
      c.close >= prev.open &&
      body > prevBody * 1.05
    ) {
      detected.push({
        id: `cdl-bulleng-${c.openTime}`,
        name: 'Bullish Engulfing',
        category: 'candlestick',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: prev.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: Math.max(c.high, prev.high), lower: Math.min(c.low, prev.low), breakoutLevel: c.high },
        detectionMethod: 'Bullish real body completely engulfs prior bearish real body.',
        invalidationCriteria: `Close below engulfing low (${Math.min(c.low, prev.low).toFixed(4)}).`,
        qualityScore: 80,
        qualityMeaning: 'Two-bar body overlap ratio and directional reversal completeness.',
      });
    }

    // 6. Bearish Engulfing
    if (
      prevBull &&
      isBear &&
      c.open >= prev.close &&
      c.close <= prev.open &&
      body > prevBody * 1.05
    ) {
      detected.push({
        id: `cdl-beareng-${c.openTime}`,
        name: 'Bearish Engulfing',
        category: 'candlestick',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: prev.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: Math.max(c.high, prev.high), lower: Math.min(c.low, prev.low), breakoutLevel: c.low },
        detectionMethod: 'Bearish real body completely engulfs prior bullish real body.',
        invalidationCriteria: `Close above engulfing high (${Math.max(c.high, prev.high).toFixed(4)}).`,
        qualityScore: 80,
        qualityMeaning: 'Two-bar body overlap ratio and directional reversal completeness.',
      });
    }

    // 7. Harami (Bullish or Bearish)
    if (
      prevBody > 0 &&
      body < prevBody * 0.5 &&
      Math.max(c.open, c.close) < Math.max(prev.open, prev.close) &&
      Math.min(c.open, c.close) > Math.min(prev.open, prev.close)
    ) {
      const dir = prevBear && isBull ? 'BULLISH' : prevBull && isBear ? 'BEARISH' : 'NEUTRAL';
      if (dir !== 'NEUTRAL') {
        detected.push({
          id: `cdl-harami-${c.openTime}`,
          name: dir === 'BULLISH' ? 'Bullish Harami' : 'Bearish Harami',
          category: 'candlestick',
          direction: dir,
          timeframe,
          startTimestamp: prev.openTime,
          confirmationTimestamp: c.closeTime,
          status: 'CONFIRMED',
          priceBoundaries: { upper: prev.high, lower: prev.low },
          detectionMethod: 'Inside bar real body (< 50% of prior bar) contained strictly within prior real body.',
          invalidationCriteria: `Break beyond mother bar range (${prev.low.toFixed(4)} – ${prev.high.toFixed(4)}).`,
          qualityScore: 66,
          qualityMeaning: 'Inside-bar containment ratio.',
        });
      }
    }

    // 8. Morning Star / Evening Star
    const prev2Range = prev2.high - prev2.low;
    const prev2Body = Math.abs(prev2.close - prev2.open);
    const prevRange = prev.high - prev.low;
    if (prev2Range > 0 && prevRange > 0) {
      const midPrev2 = (prev2.open + prev2.close) / 2;
      if (
        prev2.close < prev2.open &&
        prev2Body / prev2Range > 0.5 &&
        prevBody / prevRange < 0.3 &&
        isBull &&
        c.close > midPrev2
      ) {
        detected.push({
          id: `cdl-mstar-${c.openTime}`,
          name: 'Morning Star',
          category: 'candlestick',
          direction: 'BULLISH',
          timeframe,
          startTimestamp: prev2.openTime,
          confirmationTimestamp: c.closeTime,
          status: 'CONFIRMED',
          priceBoundaries: {
            upper: Math.max(prev2.high, c.high),
            lower: Math.min(prev2.low, prev.low, c.low),
            breakoutLevel: c.high,
          },
          detectionMethod: 'Three-bar reversal: strong bearish bar, small-body transition bar, bullish close above bar-1 midpoint.',
          invalidationCriteria: `Close below 3-bar swing low (${Math.min(prev2.low, prev.low, c.low).toFixed(4)}).`,
          qualityScore: 82,
          qualityMeaning: 'Three-bar reversal symmetry score.',
        });
      } else if (
        prev2.close > prev2.open &&
        prev2Body / prev2Range > 0.5 &&
        prevBody / prevRange < 0.3 &&
        isBear &&
        c.close < midPrev2
      ) {
        detected.push({
          id: `cdl-estar-${c.openTime}`,
          name: 'Evening Star',
          category: 'candlestick',
          direction: 'BEARISH',
          timeframe,
          startTimestamp: prev2.openTime,
          confirmationTimestamp: c.closeTime,
          status: 'CONFIRMED',
          priceBoundaries: {
            upper: Math.max(prev2.high, prev.high, c.high),
            lower: Math.min(prev2.low, c.low),
            breakoutLevel: c.low,
          },
          detectionMethod: 'Three-bar reversal: strong bullish bar, small-body transition bar, bearish close below bar-1 midpoint.',
          invalidationCriteria: `Close above 3-bar swing high (${Math.max(prev2.high, prev.high, c.high).toFixed(4)}).`,
          qualityScore: 82,
          qualityMeaning: 'Three-bar reversal symmetry score.',
        });
      }
    }

    // 9. Three White Soldiers / Three Black Crows
    if (
      prev2.close > prev2.open &&
      prev.close > prev.open &&
      isBull &&
      prev.close > prev2.close &&
      c.close > prev.close &&
      body / range > 0.55
    ) {
      detected.push({
        id: `cdl-3ws-${c.openTime}`,
        name: 'Three White Soldiers',
        category: 'candlestick',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: prev2.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: c.high, lower: prev2.low },
        detectionMethod: 'Three consecutive strong bullish closes stepping higher with >55% real body.',
        invalidationCriteria: `Close below first soldier open (${prev2.open.toFixed(4)}).`,
        qualityScore: 78,
        qualityMeaning: 'Consecutive impulse expansion consistency.',
      });
    } else if (
      prev2.close < prev2.open &&
      prev.close < prev.open &&
      isBear &&
      prev.close < prev2.close &&
      c.close < prev.close &&
      body / range > 0.55
    ) {
      detected.push({
        id: `cdl-3bc-${c.openTime}`,
        name: 'Three Black Crows',
        category: 'candlestick',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: prev2.openTime,
        confirmationTimestamp: c.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: prev2.high, lower: c.low },
        detectionMethod: 'Three consecutive strong bearish closes stepping lower with >55% real body.',
        invalidationCriteria: `Close above first crow open (${prev2.open.toFixed(4)}).`,
        qualityScore: 78,
        qualityMeaning: 'Consecutive selling impulse consistency.',
      });
    }
  }

  return detected.slice(-8).reverse();
}

/**
 * Deterministic Structural Pattern Detection using confirmed swing highs and swing lows.
 */
export function detectStructuralPatterns(
  candles: Candle[],
  timeframe: Timeframe,
): PatternDetection[] {
  const results: PatternDetection[] = [];
  if (candles.length < 30) return results;

  const recent = candles.slice(-100);
  const pivots = findSwingPivots(recent, 3);
  const highs = pivots.filter((p) => p.type === 'HIGH');
  const lows = pivots.filter((p) => p.type === 'LOW');
  const lastCandle = recent[recent.length - 1];

  // 1. Double Top
  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const diffPct = Math.abs(h2.price - h1.price) / h1.price;
    const valley = lows.find((l) => l.index > h1.index && l.index < h2.index);
    if (diffPct <= 0.015 && valley && h2.index - h1.index >= 5) {
      const confirmed = lastCandle.close < valley.price;
      results.push({
        id: `str-dtop-${h2.time}`,
        name: 'Double Top',
        category: 'structural',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: h1.time,
        confirmationTimestamp: confirmed ? lastCandle.closeTime : null,
        status: confirmed ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: {
          upper: Math.max(h1.price, h2.price),
          lower: valley.price,
          breakoutLevel: valley.price,
        },
        detectionMethod: `Two swing highs within ${(diffPct * 100).toFixed(2)}% tolerance separated by intervening swing low neckline.`,
        invalidationCriteria: `Sustained close above twin peaks (${Math.max(h1.price, h2.price).toFixed(4)}).`,
        qualityScore: Math.round(Math.max(55, 90 - diffPct * 1500)),
        qualityMeaning: 'Peak symmetry and neckline structure fit.',
      });
    }
  }

  // 2. Double Bottom
  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    const diffPct = Math.abs(l2.price - l1.price) / l1.price;
    const peak = highs.find((h) => h.index > l1.index && h.index < l2.index);
    if (diffPct <= 0.015 && peak && l2.index - l1.index >= 5) {
      const confirmed = lastCandle.close > peak.price;
      results.push({
        id: `str-dbot-${l2.time}`,
        name: 'Double Bottom',
        category: 'structural',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: l1.time,
        confirmationTimestamp: confirmed ? lastCandle.closeTime : null,
        status: confirmed ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: {
          upper: peak.price,
          lower: Math.min(l1.price, l2.price),
          breakoutLevel: peak.price,
        },
        detectionMethod: `Two swing lows within ${(diffPct * 100).toFixed(2)}% tolerance separated by intervening swing high neckline.`,
        invalidationCriteria: `Sustained close below twin troughs (${Math.min(l1.price, l2.price).toFixed(4)}).`,
        qualityScore: Math.round(Math.max(55, 90 - diffPct * 1500)),
        qualityMeaning: 'Trough symmetry and neckline structure fit.',
      });
    }
  }

  // 3. Head and Shoulders / Inverse Head and Shoulders
  if (highs.length >= 3) {
    const [s1, head, s2] = highs.slice(-3);
    const shoulderDiff = Math.abs(s2.price - s1.price) / s1.price;
    if (head.price > s1.price * 1.01 && head.price > s2.price * 1.01 && shoulderDiff <= 0.025) {
      const neckLows = lows.filter((l) => l.index > s1.index && l.index < s2.index);
      if (neckLows.length >= 1) {
        const neckline = neckLows.reduce((a, b) => a + b.price, 0) / neckLows.length;
        const confirmed = lastCandle.close < neckline;
        results.push({
          id: `str-hs-${s2.time}`,
          name: 'Head and Shoulders',
          category: 'structural',
          direction: 'BEARISH',
          timeframe,
          startTimestamp: s1.time,
          confirmationTimestamp: confirmed ? lastCandle.closeTime : null,
          status: confirmed ? 'CONFIRMED' : 'FORMING',
          priceBoundaries: { upper: head.price, lower: neckline, breakoutLevel: neckline },
          detectionMethod: 'Three consecutive swing highs with higher central peak and symmetrical shoulders.',
          invalidationCriteria: `Close above right shoulder (${s2.price.toFixed(4)}).`,
          qualityScore: 76,
          qualityMeaning: 'Shoulder height symmetry and head prominence.',
        });
      }
    }
  }

  if (lows.length >= 3) {
    const [s1, head, s2] = lows.slice(-3);
    const shoulderDiff = Math.abs(s2.price - s1.price) / s1.price;
    if (head.price < s1.price * 0.99 && head.price < s2.price * 0.99 && shoulderDiff <= 0.025) {
      const neckHighs = highs.filter((h) => h.index > s1.index && h.index < s2.index);
      if (neckHighs.length >= 1) {
        const neckline = neckHighs.reduce((a, b) => a + b.price, 0) / neckHighs.length;
        const confirmed = lastCandle.close > neckline;
        results.push({
          id: `str-ihs-${s2.time}`,
          name: 'Inverse Head and Shoulders',
          category: 'structural',
          direction: 'BULLISH',
          timeframe,
          startTimestamp: s1.time,
          confirmationTimestamp: confirmed ? lastCandle.closeTime : null,
          status: confirmed ? 'CONFIRMED' : 'FORMING',
          priceBoundaries: { upper: neckline, lower: head.price, breakoutLevel: neckline },
          detectionMethod: 'Three consecutive swing lows with deeper central trough and symmetrical shoulders.',
          invalidationCriteria: `Close below right shoulder (${s2.price.toFixed(4)}).`,
          qualityScore: 76,
          qualityMeaning: 'Shoulder symmetry and trough prominence.',
        });
      }
    }
  }

  // 4. Triangles, Wedges, and Channels from the last 2 swing highs & 2 swing lows
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];

    const highSlope = (h2.price - h1.price) / Math.max(1, h2.index - h1.index) / h1.price;
    const lowSlope = (l2.price - l1.price) / Math.max(1, l2.index - l1.index) / l1.price;
    const flatEps = 0.0004;

    const startTs = Math.min(h1.time, l1.time);
    const upperBound = Math.max(h1.price, h2.price);
    const lowerBound = Math.min(l1.price, l2.price);

    if (Math.abs(highSlope) <= flatEps && lowSlope > flatEps) {
      results.push({
        id: `str-asctri-${h2.time}`,
        name: 'Ascending Triangle',
        category: 'structural',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp: lastCandle.close > upperBound ? lastCandle.closeTime : null,
        status: lastCandle.close > upperBound ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: { upper: upperBound, lower: l2.price, breakoutLevel: upperBound },
        detectionMethod: 'Horizontal resistance pivots paired with rising swing low support.',
        invalidationCriteria: `Close below rising support pivot (${l2.price.toFixed(4)}).`,
        qualityScore: 74,
        qualityMeaning: 'Trendline slope convergence quality.',
      });
    } else if (highSlope < -flatEps && Math.abs(lowSlope) <= flatEps) {
      results.push({
        id: `str-desctri-${l2.time}`,
        name: 'Descending Triangle',
        category: 'structural',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp: lastCandle.close < lowerBound ? lastCandle.closeTime : null,
        status: lastCandle.close < lowerBound ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: { upper: h2.price, lower: lowerBound, breakoutLevel: lowerBound },
        detectionMethod: 'Declining swing high resistance paired with flat swing low support.',
        invalidationCriteria: `Close above falling resistance pivot (${h2.price.toFixed(4)}).`,
        qualityScore: 74,
        qualityMeaning: 'Trendline slope convergence quality.',
      });
    } else if (highSlope < -flatEps && lowSlope > flatEps) {
      results.push({
        id: `str-symtri-${Math.max(h2.time, l2.time)}`,
        name: 'Symmetrical Triangle',
        category: 'structural',
        direction: 'NEUTRAL',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp:
          lastCandle.close > h2.price || lastCandle.close < l2.price ? lastCandle.closeTime : null,
        status: lastCandle.close > h2.price || lastCandle.close < l2.price ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: { upper: h2.price, lower: l2.price },
        detectionMethod: 'Converging lower swing highs and higher swing lows compressing volatility.',
        invalidationCriteria: 'Directional close outside triangle boundaries.',
        qualityScore: 72,
        qualityMeaning: 'Compression geometry symmetry.',
      });
    } else if (highSlope > flatEps && lowSlope > highSlope * 1.25) {
      results.push({
        id: `str-risewedge-${h2.time}`,
        name: 'Rising Wedge',
        category: 'structural',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp: lastCandle.close < l2.price ? lastCandle.closeTime : null,
        status: lastCandle.close < l2.price ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: { upper: h2.price, lower: l2.price, breakoutLevel: l2.price },
        detectionMethod: 'Both highs and lows rising with steeper lower boundary convergence.',
        invalidationCriteria: `Sustained breakout above upper wedge boundary (${h2.price.toFixed(4)}).`,
        qualityScore: 70,
        qualityMeaning: 'Wedge slope convergence ratio.',
      });
    } else if (lowSlope < -flatEps && highSlope < lowSlope * 1.25) {
      results.push({
        id: `str-fallwedge-${l2.time}`,
        name: 'Falling Wedge',
        category: 'structural',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp: lastCandle.close > h2.price ? lastCandle.closeTime : null,
        status: lastCandle.close > h2.price ? 'CONFIRMED' : 'FORMING',
        priceBoundaries: { upper: h2.price, lower: l2.price, breakoutLevel: h2.price },
        detectionMethod: 'Both highs and lows declining with steeper upper resistance convergence.',
        invalidationCriteria: `Breakdown below lower wedge boundary (${l2.price.toFixed(4)}).`,
        qualityScore: 70,
        qualityMeaning: 'Wedge slope convergence ratio.',
      });
    } else if (highSlope > flatEps && lowSlope > flatEps) {
      results.push({
        id: `str-ascchan-${h2.time}`,
        name: 'Ascending Channel',
        category: 'structural',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp: lastCandle.closeTime,
        status: 'FORMING',
        priceBoundaries: { upper: h2.price, lower: l2.price },
        detectionMethod: 'Parallel rising swing highs and swing lows defining an upward trend channel.',
        invalidationCriteria: `Close below lower channel pivot (${l2.price.toFixed(4)}).`,
        qualityScore: 75,
        qualityMeaning: 'Channel slope parallelism fit.',
      });
    } else if (highSlope < -flatEps && lowSlope < -flatEps) {
      results.push({
        id: `str-descchan-${l2.time}`,
        name: 'Descending Channel',
        category: 'structural',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: startTs,
        confirmationTimestamp: lastCandle.closeTime,
        status: 'FORMING',
        priceBoundaries: { upper: h2.price, lower: l2.price },
        detectionMethod: 'Parallel falling swing highs and swing lows defining a downward trend channel.',
        invalidationCriteria: `Close above upper channel pivot (${h2.price.toFixed(4)}).`,
        qualityScore: 75,
        qualityMeaning: 'Channel slope parallelism fit.',
      });
    }
  }

  // 5. Range Breakout check against prior 20-bar box
  if (recent.length >= 25) {
    const box = recent.slice(-21, -1);
    const boxHigh = Math.max(...box.map((c) => c.high));
    const boxLow = Math.min(...box.map((c) => c.low));
    const boxRangePct = (boxHigh - boxLow) / boxLow;
    if (boxRangePct < 0.08 && lastCandle.close > boxHigh) {
      results.push({
        id: `str-brk-up-${lastCandle.openTime}`,
        name: 'Range Breakout (Upside)',
        category: 'structural',
        direction: 'BULLISH',
        timeframe,
        startTimestamp: box[0].openTime,
        confirmationTimestamp: lastCandle.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: boxHigh, lower: boxLow, breakoutLevel: boxHigh },
        detectionMethod: `Completed close above 20-bar consolidation high (${boxHigh.toFixed(4)}).`,
        invalidationCriteria: `Re-entry close back below ${boxHigh.toFixed(4)}.`,
        qualityScore: 79,
        qualityMeaning: 'Consolidation width and breakout close decisiveness.',
      });
    } else if (boxRangePct < 0.08 && lastCandle.close < boxLow) {
      results.push({
        id: `str-brk-dn-${lastCandle.openTime}`,
        name: 'Range Breakdown (Downside)',
        category: 'structural',
        direction: 'BEARISH',
        timeframe,
        startTimestamp: box[0].openTime,
        confirmationTimestamp: lastCandle.closeTime,
        status: 'CONFIRMED',
        priceBoundaries: { upper: boxHigh, lower: boxLow, breakoutLevel: boxLow },
        detectionMethod: `Completed close below 20-bar consolidation low (${boxLow.toFixed(4)}).`,
        invalidationCriteria: `Reclaim close back above ${boxLow.toFixed(4)}.`,
        qualityScore: 79,
        qualityMeaning: 'Consolidation width and breakdown close decisiveness.',
      });
    }
  }

  return results.slice(0, 6);
}

/**
 * Computes estimated Support & Resistance zones via swing pivot clustering.
 * Zones represent historical reaction clusters, not guaranteed price barriers.
 */
export function detectSupportResistance(candles: Candle[]): SupportResistanceZone[] {
  if (candles.length < 20) return [];
  const lastCandle = candles[candles.length - 1];
  const currentPrice = lastCandle.close;
  const pivots = findSwingPivots(candles.slice(-200), 3);
  if (pivots.length === 0) return [];

  const tolerancePct = 0.008; // 0.8% zone clustering bandwidth
  interface Cluster {
    prices: number[];
    times: number[];
    indices: number[];
  }
  const clusters: Cluster[] = [];

  for (const p of pivots) {
    let matched = false;
    for (const c of clusters) {
      const mean = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
      if (Math.abs(p.price - mean) / mean <= tolerancePct) {
        c.prices.push(p.price);
        c.times.push(p.time);
        c.indices.push(p.index);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ prices: [p.price], times: [p.time], indices: [p.index] });
    }
  }

  const totalBars = Math.min(candles.length, 200);
  const zones: SupportResistanceZone[] = clusters
    .filter((c) => c.prices.length >= 2)
    .map((c, i) => {
      const mean = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
      const zoneLow = Math.min(...c.prices) * 0.998;
      const zoneHigh = Math.max(...c.prices) * 1.002;
      const distancePct = ((mean - currentPrice) / currentPrice) * 100;
      const type: 'SUPPORT' | 'RESISTANCE' = mean <= currentPrice ? 'SUPPORT' : 'RESISTANCE';
      const firstIdx = Math.min(...c.indices);
      const status: 'ACTIVE' | 'TESTING' | 'BROKEN' =
        Math.abs(distancePct) <= 0.6 ? 'TESTING' : 'ACTIVE';

      return {
        id: `sr-${type.toLowerCase()}-${i}-${Math.round(mean * 100)}`,
        type,
        price: mean,
        zoneLow,
        zoneHigh,
        distancePct,
        touches: c.prices.length,
        firstTouchTime: Math.min(...c.times),
        lastTouchTime: Math.max(...c.times),
        ageBars: totalBars - firstIdx,
        status,
      };
    });

  // Sort by proximity to current price and return top 3 supports + top 3 resistances
  const supports = zones
    .filter((z) => z.type === 'SUPPORT')
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 3);
  const resistances = zones
    .filter((z) => z.type === 'RESISTANCE')
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 3);

  return [...resistances.reverse(), ...supports];
}
