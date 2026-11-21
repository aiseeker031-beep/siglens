export type MarketBackdropCondition = 'bullish' | 'bearish' | 'volatile' | 'neutral';
export type BackdropMode = 'auto' | MarketBackdropCondition;
export type BackdropCadence = 'calm' | 'standard' | 'dynamic';

export interface MarketConditionInput {
  breadthScore?: number | null;
  volatilityRegime?: string | null;
  fearAndGreed?: number | null;
  liveChange24hPcts?: number[];
}

export interface MarketConditionMeta {
  condition: MarketBackdropCondition;
  label: string;
  shortLabel: string;
  rationale: string;
  accentHex: string;
}

export const CONDITION_META: Record<MarketBackdropCondition, Omit<MarketConditionMeta, 'rationale'>> = {
  bullish: {
    condition: 'bullish',
    label: 'Bullish Momentum',
    shortLabel: 'Bullish',
    accentHex: '#22E59B',
  },
  bearish: {
    condition: 'bearish',
    label: 'Bearish Pressure',
    shortLabel: 'Bearish',
    accentHex: '#F16B72',
  },
  volatile: {
    condition: 'volatile',
    label: 'High Volatility',
    shortLabel: 'Volatile',
    accentHex: '#FF9843',
  },
  neutral: {
    condition: 'neutral',
    label: 'Balanced Range',
    shortLabel: 'Neutral',
    accentHex: '#D8A36A',
  },
};

const VOLATILE_LIVE_ABS_PCT_THRESHOLD = 4.5;
const DIRECTIONAL_THRESHOLD = 15;

/**
 * Deterministically classifies live market conditions into one of four visual regimes
 * for SIGLENS's abstract minimal background slideshow.
 */
export function deriveMarketBackdropCondition(input: MarketConditionInput): MarketConditionMeta {
  const validChanges = (input.liveChange24hPcts ?? []).filter(
    (v) => typeof v === 'number' && Number.isFinite(v),
  );

  const avgAbsChange =
    validChanges.length > 0
      ? validChanges.reduce((acc, v) => acc + Math.abs(v), 0) / validChanges.length
      : null;

  const avgSignedChange =
    validChanges.length > 0
      ? validChanges.reduce((acc, v) => acc + v, 0) / validChanges.length
      : null;

  const volStr = (input.volatilityRegime ?? '').toLowerCase();
  const isHighVolRegime = volStr.includes('high') || volStr.includes('extreme');
  const isHighLiveDispersion =
    avgAbsChange !== null && validChanges.length >= 3 && avgAbsChange >= VOLATILE_LIVE_ABS_PCT_THRESHOLD;

  if (isHighVolRegime || isHighLiveDispersion) {
    const reason = isHighVolRegime
      ? `Volatility regime: ${input.volatilityRegime}`
      : `Avg 24h move ${avgAbsChange!.toFixed(1)}% across active pairs`;
    return {
      ...CONDITION_META.volatile,
      rationale: reason,
    };
  }

  const hasBreadth = typeof input.breadthScore === 'number' && Number.isFinite(input.breadthScore);
  const hasFng = typeof input.fearAndGreed === 'number' && Number.isFinite(input.fearAndGreed);

  // Composite directional score on [-100, +100]
  let composite = 0;
  if (hasBreadth) {
    const liveNudge =
      avgSignedChange !== null ? Math.max(-12, Math.min(12, avgSignedChange * 3)) : 0;
    composite = input.breadthScore! * 0.85 + liveNudge;
  } else if (avgSignedChange !== null) {
    composite = Math.max(-100, Math.min(100, avgSignedChange * 10));
  } else if (hasFng) {
    composite = (input.fearAndGreed! - 50) * 1.4;
  }

  if (composite >= DIRECTIONAL_THRESHOLD) {
    const detail = hasBreadth
      ? `Market breadth +${Math.round(input.breadthScore!)}`
      : avgSignedChange !== null
        ? `Live pairs avg +${avgSignedChange.toFixed(2)}%`
        : `Sentiment index ${Math.round(input.fearAndGreed!)}/100`;
    return {
      ...CONDITION_META.bullish,
      rationale: detail,
    };
  }

  if (composite <= -DIRECTIONAL_THRESHOLD) {
    const detail = hasBreadth
      ? `Market breadth ${Math.round(input.breadthScore!)}`
      : avgSignedChange !== null
        ? `Live pairs avg ${avgSignedChange.toFixed(2)}%`
        : `Sentiment index ${Math.round(input.fearAndGreed!)}/100`;
    return {
      ...CONDITION_META.bearish,
      rationale: detail,
    };
  }

  const neutralDetail = hasBreadth
    ? `Breadth ${input.breadthScore! >= 0 ? '+' : ''}${Math.round(input.breadthScore!)} · ${input.volatilityRegime || 'Normal volatility'}`
    : 'Awaiting directional expansion';

  return {
    ...CONDITION_META.neutral,
    rationale: neutralDetail,
  };
}

/**
 * Resolves the active visual condition considering user mode override vs live auto-sync.
 */
export function resolveEffectiveCondition(
  mode: BackdropMode,
  liveResult: MarketConditionMeta,
): MarketConditionMeta {
  if (mode === 'auto') return liveResult;
  return {
    ...CONDITION_META[mode],
    rationale: `Manual preview · Live market is ${liveResult.shortLabel}`,
  };
}

/**
 * Wraps slideshow index cleanly forward or backward for any non-empty slide list.
 */
export function getNextSlideIndex(currentIndex: number, totalSlides: number, step = 1): number {
  if (totalSlides <= 1) return 0;
  const normalized = ((currentIndex + step) % totalSlides + totalSlides) % totalSlides;
  return normalized;
}

/**
 * Returns milliseconds between automatic slide transitions for each cadence preset.
 */
export function getSlideIntervalMs(cadence: BackdropCadence): number {
  switch (cadence) {
    case 'calm':
      return 30_000;
    case 'dynamic':
      return 9_000;
    case 'standard':
    default:
      return 16_000;
  }
}
