import type { Candle, ScreenerRow } from '../shared/types';

/**
 * Computes Pearson correlation between two assets using strictly aligned candle timestamps
 * and log returns. Returns null when fewer than `minAligned` overlapping return periods exist.
 */
export function computePearsonCorrelation(
  candlesA: Candle[],
  candlesB: Candle[],
  lookbackBars = 60,
  minAligned = 15,
): { correlation: number | null; alignedSamples: number } {
  const mapA = new Map<number, number>();
  for (const c of candlesA.slice(-(lookbackBars + 5))) {
    mapA.set(c.openTime, c.close);
  }

  const commonTimes: number[] = [];
  const mapB = new Map<number, number>();
  for (const c of candlesB.slice(-(lookbackBars + 5))) {
    mapB.set(c.openTime, c.close);
    if (mapA.has(c.openTime)) {
      commonTimes.push(c.openTime);
    }
  }

  commonTimes.sort((a, b) => a - b);
  const trimmed = commonTimes.slice(-(lookbackBars + 1));
  if (trimmed.length - 1 < minAligned) {
    return { correlation: null, alignedSamples: Math.max(0, trimmed.length - 1) };
  }

  const retA: number[] = [];
  const retB: number[] = [];

  for (let i = 1; i < trimmed.length; i++) {
    const t0 = trimmed[i - 1];
    const t1 = trimmed[i];
    const a0 = mapA.get(t0)!;
    const a1 = mapA.get(t1)!;
    const b0 = mapB.get(t0)!;
    const b1 = mapB.get(t1)!;
    if (a0 > 0 && a1 > 0 && b0 > 0 && b1 > 0) {
      retA.push(Math.log(a1 / a0));
      retB.push(Math.log(b1 / b0));
    }
  }

  const n = retA.length;
  if (n < minAligned) return { correlation: null, alignedSamples: n };

  const meanA = retA.reduce((s, v) => s + v, 0) / n;
  const meanB = retB.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = retA[i] - meanA;
    const db = retB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom <= 1e-12) return { correlation: 0, alignedSamples: n };
  return {
    correlation: Number(Math.max(-1, Math.min(1, cov / denom)).toFixed(3)),
    alignedSamples: n,
  };
}

/**
 * Builds a pairwise Pearson correlation matrix for a set of assets.
 */
export function buildCorrelationMatrix(
  assets: { symbol: string; candles: Candle[] }[],
  lookbackBars = 60,
): {
  symbols: string[];
  matrix: (number | null)[][];
  sampleCounts: number[][];
} {
  const symbols = assets.map((a) => a.symbol);
  const n = assets.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
  const sampleCounts: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    sampleCounts[i][i] = Math.min(lookbackBars, Math.max(0, assets[i].candles.length - 1));
    for (let j = i + 1; j < n; j++) {
      const res = computePearsonCorrelation(assets[i].candles, assets[j].candles, lookbackBars);
      matrix[i][j] = res.correlation;
      matrix[j][i] = res.correlation;
      sampleCounts[i][j] = res.alignedSamples;
      sampleCounts[j][i] = res.alignedSamples;
    }
  }

  return { symbols, matrix, sampleCounts };
}

/**
 * Normalizes multiple asset candle histories onto common synchronized timestamps
 * starting at 0.0% return at the first aligned timestamp.
 */
export function buildNormalizedPerformance(
  assets: { symbol: string; candles: Candle[] }[],
  maxPoints = 120,
): {
  timestamps: number[];
  series: Record<string, number[]>;
} {
  if (assets.length === 0) return { timestamps: [], series: {} };

  const maps = assets.map((a) => {
    const m = new Map<number, number>();
    for (const c of a.candles) m.set(c.openTime, c.close);
    return m;
  });

  // Intersection of all timestamps
  const firstKeys = Array.from(maps[0].keys());
  const common = firstKeys
    .filter((t) => maps.every((m) => m.has(t)))
    .sort((a, b) => a - b)
    .slice(-maxPoints);

  const series: Record<string, number[]> = {};
  for (let i = 0; i < assets.length; i++) {
    const sym = assets[i].symbol;
    if (common.length === 0) {
      series[sym] = [];
      continue;
    }
    const base = maps[i].get(common[0])!;
    series[sym] = common.map((t) => {
      const val = maps[i].get(t)!;
      return base > 0 ? Number((((val - base) / base) * 100).toFixed(3)) : 0;
    });
  }

  return { timestamps: common, series };
}

/**
 * Computes transparent market breadth statistics over an analyzed asset universe.
 */
export function computeMarketBreadth(rows: ScreenerRow[]) {
  const total = rows.length;
  if (total === 0) {
    return {
      analyzedAssets: 0,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0,
      bullishPct: 0,
      bearishPct: 0,
      neutralPct: 0,
      aboveEma50Pct: 0,
      aboveEma200Pct: 0,
      positiveMomentumPct: 0,
      breadthScore: 0,
    };
  }

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let ema50Valid = 0;
  let aboveEma50 = 0;
  let ema200Valid = 0;
  let aboveEma200 = 0;
  let positiveMomentum = 0;

  for (const r of rows) {
    if (r.classification === 'STRONG_BULLISH' || r.classification === 'BULLISH') bullishCount++;
    else if (r.classification === 'STRONG_BEARISH' || r.classification === 'BEARISH') bearishCount++;
    else neutralCount++;

    if (r.aboveEma50 !== null) {
      ema50Valid++;
      if (r.aboveEma50) aboveEma50++;
    }
    if (r.aboveEma200 !== null) {
      ema200Valid++;
      if (r.aboveEma200) aboveEma200++;
    }
    if ((r.rsi14 ?? 50) > 50) positiveMomentum++;
  }

  const breadthScore = Math.round(((bullishCount - bearishCount) / total) * 100);

  return {
    analyzedAssets: total,
    bullishCount,
    bearishCount,
    neutralCount,
    bullishPct: Number(((bullishCount / total) * 100).toFixed(1)),
    bearishPct: Number(((bearishCount / total) * 100).toFixed(1)),
    neutralPct: Number(((neutralCount / total) * 100).toFixed(1)),
    aboveEma50Pct: ema50Valid > 0 ? Number(((aboveEma50 / ema50Valid) * 100).toFixed(1)) : 0,
    aboveEma200Pct: ema200Valid > 0 ? Number(((aboveEma200 / ema200Valid) * 100).toFixed(1)) : 0,
    positiveMomentumPct: Number(((positiveMomentum / total) * 100).toFixed(1)),
    breadthScore,
  };
}
