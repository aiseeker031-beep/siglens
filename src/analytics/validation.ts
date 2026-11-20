import { TIMEFRAME_MS } from '../shared/constants';
import type { Candle, CandleValidationResult, Timeframe } from '../shared/types';

/**
 * Validates OHLCV candle arrays rigorously:
 * - Finite numeric OHLCV values
 * - High >= max(Open, Close), Low <= min(Open, Close), High >= Low
 * - Nonnegative volume, positive price
 * - Chronological ordering & deduplication by openTime (latest wins)
 * - Gap detection against expected timeframe interval
 * - Clean separation between confirmed completed candles and currently forming candle
 */
export function validateCandles(
  rawCandles: Candle[],
  timeframe: Timeframe,
  nowMs: number = Date.now(),
): CandleValidationResult {
  const intervalMs = TIMEFRAME_MS[timeframe];
  const issues: string[] = [];
  let rejectedCount = 0;
  let duplicateCount = 0;

  const byOpenTime = new Map<number, Candle>();

  for (const c of rawCandles) {
    if (
      !Number.isFinite(c.openTime) ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      !Number.isFinite(c.volume)
    ) {
      rejectedCount++;
      continue;
    }

    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 || c.volume < 0) {
      rejectedCount++;
      continue;
    }

    if (
      c.high < Math.max(c.open, c.close) - 1e-12 ||
      c.low > Math.min(c.open, c.close) + 1e-12 ||
      c.high < c.low
    ) {
      rejectedCount++;
      continue;
    }

    if (byOpenTime.has(c.openTime)) {
      duplicateCount++;
    }

    const closeTime =
      Number.isFinite(c.closeTime) && c.closeTime > c.openTime
        ? c.closeTime
        : c.openTime + intervalMs - 1;

    const isClosed = typeof c.isClosed === 'boolean' ? c.isClosed : closeTime < nowMs;

    byOpenTime.set(c.openTime, {
      ...c,
      closeTime,
      isClosed,
    });
  }

  const validCandles = Array.from(byOpenTime.values()).sort((a, b) => a.openTime - b.openTime);

  let hasGaps = false;
  let gapCount = 0;
  for (let i = 1; i < validCandles.length; i++) {
    const diff = validCandles[i].openTime - validCandles[i - 1].openTime;
    if (diff > intervalMs * 1.5) {
      hasGaps = true;
      gapCount++;
    }
  }

  if (rejectedCount > 0) {
    issues.push(`Rejected ${rejectedCount} malformed OHLCV bar(s).`);
  }
  if (duplicateCount > 0) {
    issues.push(`Deduplicated ${duplicateCount} overlapping candle timestamp(s).`);
  }
  if (gapCount > 0) {
    issues.push(`Detected ${gapCount} time gap(s) exceeding the ${timeframe} interval.`);
  }

  const completedCandles: Candle[] = [];
  let formingCandle: Candle | null = null;

  for (let i = 0; i < validCandles.length; i++) {
    const c = validCandles[i];
    const isLast = i === validCandles.length - 1;
    if (isLast && !c.isClosed) {
      formingCandle = c;
    } else {
      completedCandles.push({ ...c, isClosed: true });
    }
  }

  return {
    validCandles,
    completedCandles,
    formingCandle,
    issues,
    hasGaps,
    duplicateCount,
    rejectedCount,
  };
}
