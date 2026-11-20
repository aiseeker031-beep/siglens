import { formatPrice } from '../shared/format';
import type {
  SignalClassification,
  SignalSetupPlan,
  SignalTakeProfitTarget,
  SupportResistanceZone,
} from '../shared/types';

export interface SignalSetupInputs {
  displaySymbol: string;
  classification: SignalClassification;
  closePrice: number | null;
  atr14: number | null;
  ema20: number | null;
  vwap: number | null;
  supportResistance?: SupportResistanceZone[];
}

function roundToAssetPrecision(price: number): number {
  if (!Number.isFinite(price)) return 0;
  const abs = Math.abs(price);
  if (abs >= 1000) return Number(price.toFixed(2));
  if (abs >= 1) return Number(price.toFixed(4));
  if (abs >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(8));
}

export function toCompactTicker(displaySymbol: string): string {
  return displaySymbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Pure deterministic calculator for structured signal setup levels:
 * - Symbol (compact ticker e.g. BTCUSDT)
 * - Direction: BUY (long) / SELL (short) / WAIT (neutral or insufficient data)
 * - Entry: NOW (strong trend confluence) or pullback ZONE (moderate confluence)
 * - Stop Loss (SL): anchored to structural S/R within [0.8*ATR, 3.0*ATR] or 1.5*ATR fallback
 * - Take Profit (TP1, TP2, TP3): 1.0R / 2.0R / 3.0R multiples with structural snapping
 */
export function computeSignalSetup(input: SignalSetupInputs): SignalSetupPlan {
  const symbol = toCompactTicker(input.displaySymbol);
  const price = input.closePrice;

  if (
    price === null ||
    !Number.isFinite(price) ||
    price <= 0 ||
    input.classification === 'INSUFFICIENT_DATA' ||
    input.classification === 'NEUTRAL'
  ) {
    return {
      symbol,
      direction: 'WAIT',
      directionLabel: 'NEUTRAL (WAIT)',
      entryMode: 'ZONE',
      entryPrice: price !== null && Number.isFinite(price) ? roundToAssetPrecision(price) : null,
      entryZoneLow: null,
      entryZoneHigh: null,
      stopLoss: null,
      stopLossPct: null,
      takeProfits: [],
      riskRewardTp2: null,
      atr14: input.atr14,
      methodology:
        input.classification === 'INSUFFICIENT_DATA'
          ? 'Insufficient completed candles to establish deterministic entry/SL/TP levels.'
          : 'Directional confluence is neutral; no BUY or SELL setup is active.',
    };
  }

  const isBuy =
    input.classification === 'STRONG_BULLISH' || input.classification === 'BULLISH';
  const isStrong =
    input.classification === 'STRONG_BULLISH' || input.classification === 'STRONG_BEARISH';

  // Volatility unit from ATR(14), falling back strictly to 1% of close if ATR unavailable
  const atr =
    input.atr14 !== null && Number.isFinite(input.atr14) && input.atr14 > 0
      ? input.atr14
      : price * 0.01;

  const entryMode: 'NOW' | 'ZONE' = isStrong ? 'NOW' : 'ZONE';
  const srZones = input.supportResistance ?? [];

  // Entry price & execution zone
  const halfBand = atr * (isStrong ? 0.2 : 0.35);
  let entryPrice = price;
  let entryZoneLow = price - halfBand;
  let entryZoneHigh = price + halfBand;

  if (!isStrong) {
    // Anchor pullback zone toward EMA20 or VWAP when reasonably close (<= 1.2 * ATR)
    const anchors = [input.ema20, input.vwap].filter(
      (v): v is number => v !== null && Number.isFinite(v) && Math.abs(v - price) <= atr * 1.2,
    );
    if (anchors.length > 0) {
      const pullTarget = isBuy
        ? Math.min(price, ...anchors)
        : Math.max(price, ...anchors);
      if (isBuy) {
        entryZoneLow = Math.max(price * 0.5, Math.min(pullTarget, price - atr * 0.25));
        entryZoneHigh = price + atr * 0.15;
      } else {
        entryZoneLow = price - atr * 0.15;
        entryZoneHigh = Math.max(pullTarget, price + atr * 0.25);
      }
      entryPrice = (entryZoneLow + entryZoneHigh) / 2;
    }
  }

  // Stop Loss: prefer structural S/R zone within [0.8*ATR, 3.0*ATR] on invalidation side, else 1.5*ATR
  let rawStopLoss = isBuy ? entryPrice - atr * 1.5 : entryPrice + atr * 1.5;
  let slAnchorNote = '1.5× ATR(14) volatility stop';

  if (isBuy) {
    const validSupports = srZones
      .filter((z) => z.type === 'SUPPORT' && z.zoneLow < entryPrice)
      .map((z) => z.zoneLow - atr * 0.2)
      .filter((lvl) => {
        const dist = entryPrice - lvl;
        return lvl > 0 && dist >= atr * 0.8 && dist <= atr * 3.0;
      })
      .sort((a, b) => b - a); // nearest valid support below entry

    if (validSupports.length > 0) {
      rawStopLoss = validSupports[0];
      slAnchorNote = 'structural support + 0.2× ATR buffer';
    }
    rawStopLoss = Math.max(entryPrice * 0.05, Math.min(rawStopLoss, entryPrice - atr * 0.5));
  } else {
    const validResistances = srZones
      .filter((z) => z.type === 'RESISTANCE' && z.zoneHigh > entryPrice)
      .map((z) => z.zoneHigh + atr * 0.2)
      .filter((lvl) => {
        const dist = lvl - entryPrice;
        return dist >= atr * 0.8 && dist <= atr * 3.0;
      })
      .sort((a, b) => a - b); // nearest valid resistance above entry

    if (validResistances.length > 0) {
      rawStopLoss = validResistances[0];
      slAnchorNote = 'structural resistance + 0.2× ATR buffer';
    }
    rawStopLoss = Math.max(rawStopLoss, entryPrice + atr * 0.5);
  }

  const riskUnit = Math.abs(entryPrice - rawStopLoss);

  // Take Profit targets: 1.0R, 2.0R, 3.0R with optional gentle snap to nearby S/R levels
  const rMultiples: { label: 'TP1' | 'TP2' | 'TP3'; mult: number }[] = [
    { label: 'TP1', mult: 1.0 },
    { label: 'TP2', mult: 2.0 },
    { label: 'TP3', mult: 3.0 },
  ];

  const candidateSr = srZones
    .filter((z) => (isBuy ? z.price > entryPrice : z.price < entryPrice))
    .map((z) => z.price);

  const takeProfits: SignalTakeProfitTarget[] = [];
  let prevTarget = entryPrice;

  for (const { label, mult } of rMultiples) {
    let rawTarget = isBuy ? entryPrice + riskUnit * mult : entryPrice - riskUnit * mult;

    // Gently snap to structural level if within ±12% of riskUnit AND preserves strict monotonicity
    const snap = candidateSr.find((srPrice) => Math.abs(srPrice - rawTarget) <= riskUnit * 0.12);
    if (snap !== undefined) {
      if ((isBuy && snap > prevTarget) || (!isBuy && snap < prevTarget && snap > 0)) {
        rawTarget = snap;
      }
    }

    if (!isBuy && rawTarget <= 0) {
      rawTarget = Math.max(entryPrice * (1 - 0.15 * mult), entryPrice * 0.05);
    }

    // Guarantee strict ordering
    if (isBuy && rawTarget <= prevTarget) {
      rawTarget = prevTarget + riskUnit * 0.5;
    } else if (!isBuy && rawTarget >= prevTarget) {
      rawTarget = Math.max(entryPrice * 0.01, prevTarget - riskUnit * 0.5);
    }

    prevTarget = rawTarget;
    const roundedTarget = roundToAssetPrecision(rawTarget);
    const pctFromEntry = Number((((roundedTarget - entryPrice) / entryPrice) * 100).toFixed(2));
    const rrRatio = Number((Math.abs(roundedTarget - entryPrice) / Math.max(riskUnit, 1e-12)).toFixed(2));

    takeProfits.push({
      label,
      price: roundedTarget,
      pctFromEntry,
      rrRatio,
    });
  }

  const roundedEntry = roundToAssetPrecision(entryPrice);
  const roundedLow = roundToAssetPrecision(Math.max(entryZoneLow, 0));
  const roundedHigh = roundToAssetPrecision(entryZoneHigh);
  const roundedSl = roundToAssetPrecision(rawStopLoss);
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
    riskRewardTp2: takeProfits[1]?.rrRatio ?? 2.0,
    atr14: input.atr14,
    methodology: `Entry (${entryMode}) & ${slAnchorNote}; TP1/TP2/TP3 scaled at 1R/2R/3R from ATR(14) & S/R pivots.`,
  };
}

/**
 * Formats a SignalSetupPlan into the exact 5-bullet structured format requested by the user.
 */
export function formatSignalCopyText(
  setup: SignalSetupPlan,
  timeframe: string,
  livePrice?: number | null,
): string {
  const entryText =
    setup.direction === 'WAIT'
      ? `WAIT (Current: $${formatPrice(livePrice ?? setup.entryPrice)})`
      : setup.entryMode === 'NOW'
        ? `NOW ($${formatPrice(livePrice ?? setup.entryPrice)}) | Zone: $${formatPrice(setup.entryZoneLow)} – $${formatPrice(setup.entryZoneHigh)}`
        : `$${formatPrice(setup.entryZoneLow)} – $${formatPrice(setup.entryZoneHigh)} (Ref: $${formatPrice(setup.entryPrice)})`;

  const slText =
    setup.stopLoss !== null
      ? `$${formatPrice(setup.stopLoss)} (${setup.stopLossPct !== null && setup.stopLossPct > 0 ? '+' : ''}${setup.stopLossPct?.toFixed(2)}%)`
      : 'N/A';

  const tpLines =
    setup.takeProfits.length > 0
      ? setup.takeProfits
          .map(
            (tp) =>
              `  ${tp.label}: $${formatPrice(tp.price)} (${tp.pctFromEntry > 0 ? '+' : ''}${tp.pctFromEntry.toFixed(2)}% · ${tp.rrRatio.toFixed(1)}R)`,
          )
          .join('\n')
      : '  N/A (Neutral / Wait)';

  return [
    `• Symbol: ${setup.symbol} (${timeframe})`,
    `• Direction: ${setup.directionLabel}`,
    `• Entry: ${entryText}`,
    `• Stop Loss (SL): ${slText}`,
    `• Take Profit (TP):\n${tpLines}`,
  ].join('\n');
}
