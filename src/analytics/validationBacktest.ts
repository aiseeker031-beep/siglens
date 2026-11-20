import { DEFAULT_WEIGHTS } from '../shared/constants';
import type {
  Candle,
  ExchangeId,
  HistoricalHorizonMetric,
  HistoricalValidationSummary,
  IndicatorWeights,
  MarketType,
  SignalClassification,
  Timeframe,
} from '../shared/types';
import { computeAllIndicatorSeries } from './indicators';
import { classifyMarketRegime } from './regime';
import { evaluateIndicatorsAtIndex } from './signals';

const HORIZONS = [1, 3, 5, 10];
const MIN_SAMPLE_SIZE = 12;

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Historical Signal Validation Engine (Non-repainting, Zero Future Leakage).
 * Evaluates historical completed candles strictly using indicator state available at index `i`
 * (every indicator in `computeAllIndicatorSeries` is causal / backward-looking only)
 * and measures observable forward price excursions over 1, 3, 5, and 10 bars.
 */
export function evaluateHistoricalSignals(
  completedCandles: Candle[],
  canonicalId: string,
  exchange: ExchangeId,
  marketType: MarketType,
  displaySymbol: string,
  timeframe: Timeframe,
  weights: IndicatorWeights = DEFAULT_WEIGHTS,
): HistoricalValidationSummary {
  const classDistribution: Record<SignalClassification, number> = {
    STRONG_BULLISH: 0,
    BULLISH: 0,
    NEUTRAL: 0,
    BEARISH: 0,
    STRONG_BEARISH: 0,
    INSUFFICIENT_DATA: 0,
  };

  if (completedCandles.length < 70) {
    return {
      canonicalId,
      timeframe,
      totalConfirmedSignals: 0,
      classDistribution,
      horizons: HORIZONS.map((h) => ({
        horizonBars: h,
        observations: 0,
        directionalAccuracyPct: null,
        avgForwardReturnPct: null,
        medianForwardReturnPct: null,
        avgMaxFavorablePct: null,
        avgMaxAdversePct: null,
        sufficientSample: false,
      })),
      regimeBreakdown: [],
      methodologyNote:
        'Causal bar-by-bar replay over completed candles. Directional match = forward return > 0 for Bullish/Strong Bullish or < 0 for Bearish/Strong Bearish. Directional accuracy does not imply trading profitability.',
      insufficientHistoryWarning: `Only ${completedCandles.length} completed candles available; at least 70 bars are required for walk-forward signal validation.`,
    };
  }

  const { series, vwapMeta } = computeAllIndicatorSeries(completedCandles);
  const startIdx = Math.max(45, completedCandles.length - 160);
  const endIdx = completedCandles.length - 2; // leave at least 1 forward bar

  interface ReplayPoint {
    idx: number;
    classification: SignalClassification;
    direction: 1 | -1 | 0;
    regime: string;
  }

  const points: ReplayPoint[] = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const evalRes = evaluateIndicatorsAtIndex(completedCandles, series, vwapMeta, i, weights);
    const directional = evalRes.indicators.filter((x) => x.role === 'directional' && x.available);
    const activeW = directional.reduce((s, x) => s + x.effectiveWeight, 0);
    if (activeW <= 0) {
      classDistribution.INSUFFICIENT_DATA++;
      continue;
    }
    const raw = (directional.reduce((s, x) => s + x.evidence * x.effectiveWeight, 0) / activeW) * 100;
    const score = raw * evalRes.volatilityModifier;

    let cls: SignalClassification;
    let dir: 1 | -1 | 0 = 0;
    if (score >= 60) {
      cls = 'STRONG_BULLISH';
      dir = 1;
    } else if (score >= 25) {
      cls = 'BULLISH';
      dir = 1;
    } else if (score <= -60) {
      cls = 'STRONG_BEARISH';
      dir = -1;
    } else if (score <= -25) {
      cls = 'BEARISH';
      dir = -1;
    } else {
      cls = 'NEUTRAL';
      dir = 0;
    }

    classDistribution[cls]++;
    // Only record non-neutral signals spaced cleanly or regime transitions for overlap transparency
    if (dir !== 0) {
      const reg = classifyMarketRegime(completedCandles.slice(0, i + 1), series);
      points.push({ idx: i, classification: cls, direction: dir, regime: reg.trendRegime });
    }
  }

  const horizons: HistoricalHorizonMetric[] = HORIZONS.map((h) => {
    const returns: number[] = [];
    const mfeList: number[] = [];
    const maeList: number[] = [];
    let matches = 0;

    for (const p of points) {
      const targetIdx = p.idx + h;
      if (targetIdx >= completedCandles.length) continue;
      const entryClose = completedCandles[p.idx].close;
      const exitClose = completedCandles[targetIdx].close;
      const rawRetPct = ((exitClose - entryClose) / entryClose) * 100;
      const signedRetPct = rawRetPct * p.direction;

      let maxHigh = entryClose;
      let minLow = entryClose;
      for (let k = p.idx + 1; k <= targetIdx; k++) {
        if (completedCandles[k].high > maxHigh) maxHigh = completedCandles[k].high;
        if (completedCandles[k].low < minLow) minLow = completedCandles[k].low;
      }

      const favorablePct =
        p.direction === 1
          ? ((maxHigh - entryClose) / entryClose) * 100
          : ((entryClose - minLow) / entryClose) * 100;
      const adversePct =
        p.direction === 1
          ? ((entryClose - minLow) / entryClose) * 100
          : ((maxHigh - entryClose) / entryClose) * 100;

      returns.push(signedRetPct);
      mfeList.push(Math.max(0, favorablePct));
      maeList.push(Math.max(0, adversePct));
      if (signedRetPct > 0) matches++;
    }

    const obs = returns.length;
    const sufficientSample = obs >= MIN_SAMPLE_SIZE;
    return {
      horizonBars: h,
      observations: obs,
      directionalAccuracyPct: obs > 0 ? Number(((matches / obs) * 100).toFixed(1)) : null,
      avgForwardReturnPct:
        obs > 0 ? Number((returns.reduce((a, b) => a + b, 0) / obs).toFixed(3)) : null,
      medianForwardReturnPct: obs > 0 ? Number((median(returns) ?? 0).toFixed(3)) : null,
      avgMaxFavorablePct:
        obs > 0 ? Number((mfeList.reduce((a, b) => a + b, 0) / obs).toFixed(3)) : null,
      avgMaxAdversePct:
        obs > 0 ? Number((maeList.reduce((a, b) => a + b, 0) / obs).toFixed(3)) : null,
      sufficientSample,
    };
  });

  // Regime breakdown using 5-bar horizon
  const regimeMap = new Map<string, { obs: number; matches: number; sumRet: number }>();
  for (const p of points) {
    const targetIdx = p.idx + 5;
    if (targetIdx >= completedCandles.length) continue;
    const entryClose = completedCandles[p.idx].close;
    const exitClose = completedCandles[targetIdx].close;
    const signedRet = (((exitClose - entryClose) / entryClose) * 100) * p.direction;
    const cur = regimeMap.get(p.regime) ?? { obs: 0, matches: 0, sumRet: 0 };
    cur.obs++;
    if (signedRet > 0) cur.matches++;
    cur.sumRet += signedRet;
    regimeMap.set(p.regime, cur);
  }

  const regimeBreakdown = Array.from(regimeMap.entries()).map(([regime, stats]) => ({
    regime,
    observations: stats.obs,
    directionalAccuracyPct:
      stats.obs > 0 ? Number(((stats.matches / stats.obs) * 100).toFixed(1)) : null,
    avgForwardReturn5Pct: stats.obs > 0 ? Number((stats.sumRet / stats.obs).toFixed(3)) : null,
  }));

  const h5 = horizons.find((h) => h.horizonBars === 5);
  const insufficientHistoryWarning =
    !h5 || !h5.sufficientSample
      ? `Sample size (n=${h5?.observations ?? 0}) is below minimum calibration threshold (n>=${MIN_SAMPLE_SIZE}). Treat statistics as exploratory only.`
      : null;

  return {
    canonicalId,
    timeframe,
    totalConfirmedSignals: points.length,
    classDistribution,
    horizons,
    regimeBreakdown,
    methodologyNote:
      'Evaluated causally on completed historical bars without future candle leakage or repainting. Overlapping consecutive directional bars are included; directional match does not guarantee future performance or profitability.',
    insufficientHistoryWarning,
  };
}
