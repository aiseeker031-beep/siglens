import { computeAllIndicatorSeries } from '../analytics/indicators';
import { runFullAssetAnalysis } from '../analytics/signals';
import { toCompactTicker } from '../analytics/signalSetup';
import { validateCandles } from '../analytics/validation';
import {
  CFD_UNIVERSE,
  EXCHANGE_TIMEFRAMES,
  TIMEFRAME_MS,
} from '../shared/constants';
import type {
  Candle,
  ExchangeId,
  LockedSignalState,
  LockedSignalStatus,
  MarketIntelligenceSnapshot,
  MarketTicker,
  MarketType,
  QuantAssetCategory,
  QuantHistoricalEdge,
  QuantSignalGrade,
  QuantSignalRow,
  QuantSignalsPayload,
  SignalAssetClass,
  SignalSetupPlan,
  SignalTakeProfitTarget,
  SupportResistanceZone,
  Timeframe,
} from '../shared/types';
import { getDb, getStoredPreferences } from './db';
import { getAssetSentimentContext, getMarketIntelligence } from './marketIntel';
import { fetchCandles, getMarketTickers } from './providers';

const QUANT_CACHE_TTL_MS = 45_000;
const quantCache = new Map<string, { payload: QuantSignalsPayload; expiresAt: number }>();
const quantInFlight = new Map<string, Promise<QuantSignalsPayload>>();

const COMMODITY_BASE_SET = new Set(
  CFD_UNIVERSE.filter((c) => c.category === 'Commodity CFD').map((c) => c.base.toUpperCase()),
);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function roundPrice(price: number): number {
  if (!Number.isFinite(price)) return 0;
  const abs = Math.abs(price);
  if (abs >= 1000) return Number(price.toFixed(2));
  if (abs >= 1) return Number(price.toFixed(4));
  if (abs >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(8));
}

export function inferAssetCategory(
  exchange: ExchangeId,
  baseAsset: string,
): QuantAssetCategory {
  if (exchange === 'stocks') return 'stocks';
  if (exchange === 'cfds' || COMMODITY_BASE_SET.has(baseAsset.toUpperCase())) {
    return 'commodities';
  }
  return 'crypto';
}

function lockDurationMsForTimeframe(timeframe: Timeframe): number {
  switch (timeframe) {
    case '1m':
    case '3m':
    case '5m':
      return 4 * 3_600_000; // 4 hours static lock
    case '15m':
      return 8 * 3_600_000; // 8 hours static lock
    case '30m':
      return 12 * 3_600_000; // 12 hours static lock
    case '1h':
    case '2h':
      return 24 * 3_600_000; // 24 hours static lock
    case '4h':
    case '6h':
    case '12h':
      return 72 * 3_600_000; // 3 days static lock
    case '1d':
    case '1w':
    default:
      return 7 * 24 * 3_600_000; // 7 days static lock
  }
}

export function resolveHigherTimeframe(
  exchange: ExchangeId,
  timeframe: Timeframe,
): Timeframe | null {
  const supported = EXCHANGE_TIMEFRAMES[exchange] ?? ['15m', '1h', '4h', '1d'];
  const preferredMap: Record<Timeframe, Timeframe[]> = {
    '1m': ['15m', '1h', '4h'],
    '3m': ['15m', '1h', '4h'],
    '5m': ['1h', '4h', '6h', '1d'],
    '15m': ['4h', '6h', '1h', '1d'],
    '30m': ['4h', '6h', '1d'],
    '1h': ['4h', '6h', '1d'],
    '2h': ['1d', '4h'],
    '4h': ['1d', '1w'],
    '6h': ['1d', '1w'],
    '12h': ['1d', '1w'],
    '1d': ['1w'],
    '1w': [],
  };
  for (const cand of preferredMap[timeframe] ?? []) {
    if (cand !== timeframe && supported.includes(cand)) return cand;
  }
  return null;
}

// =========================================================================
// 0. SQLITE STATIC LOCKED SIGNALS STORE (NON-REPAINTING PERSISTENCE)
// =========================================================================

let lockTableReady = false;

export function ensureLockedSignalsTable(): void {
  if (lockTableReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS locked_quant_signals (
      id TEXT PRIMARY KEY,
      canonical_id TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      display_symbol TEXT NOT NULL,
      base_asset TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      action TEXT NOT NULL,
      grade TEXT NOT NULL,
      alpha_score INTEGER NOT NULL,
      locked_entry_price REAL NOT NULL,
      entry_zone_low REAL,
      entry_zone_high REAL,
      stop_loss REAL NOT NULL,
      tp1 REAL NOT NULL,
      tp2 REAL NOT NULL,
      tp3 REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      tp1_hit_at INTEGER,
      tp2_hit_at INTEGER,
      tp3_hit_at INTEGER,
      sl_hit_at INTEGER,
      closed_at INTEGER,
      closed_price REAL,
      realized_pct REAL,
      candle_open_time INTEGER NOT NULL,
      locked_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_locked_quant_lookup
      ON locked_quant_signals (canonical_id, timeframe, status);
    CREATE INDEX IF NOT EXISTS idx_locked_quant_class
      ON locked_quant_signals (asset_class, timeframe, locked_at DESC);
  `);
  lockTableReady = true;
}

interface LockedSignalDbRow {
  id: string;
  canonical_id: string;
  asset_class: string;
  exchange: string;
  market_type: string;
  display_symbol: string;
  base_asset: string;
  timeframe: string;
  action: 'BUY' | 'SELL';
  grade: QuantSignalGrade;
  alpha_score: number;
  locked_entry_price: number;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  status: LockedSignalStatus;
  tp1_hit_at: number | null;
  tp2_hit_at: number | null;
  tp3_hit_at: number | null;
  sl_hit_at: number | null;
  closed_at: number | null;
  closed_price: number | null;
  realized_pct: number | null;
  candle_open_time: number;
  locked_at: number;
  expires_at: number;
  payload_json: string;
}

function calcDirectionalPct(action: 'BUY' | 'SELL', entry: number, current: number): number {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(current)) return 0;
  const raw = action === 'BUY' ? ((current - entry) / entry) * 100 : ((entry - current) / entry) * 100;
  return Number(raw.toFixed(2));
}

function dbRowToSignalRow(
  dbRow: LockedSignalDbRow,
  livePrice: number | null,
  change24hPct?: number,
): QuantSignalRow | null {
  try {
    const parsed = JSON.parse(dbRow.payload_json) as QuantSignalRow;
    const currentPx =
      livePrice !== null && Number.isFinite(livePrice) && livePrice > 0
        ? livePrice
        : dbRow.closed_price ?? dbRow.locked_entry_price;
    const isResolved =
      dbRow.status === 'TP3_HIT' ||
      dbRow.status === 'TP1_SECURED' ||
      dbRow.status === 'SL_HIT' ||
      dbRow.status === 'EXPIRED';

    const lockState: LockedSignalState = {
      lockId: dbRow.id,
      isLocked: true,
      status: dbRow.status,
      lockedAt: dbRow.locked_at,
      expiresAt: dbRow.expires_at,
      candleOpenTime: dbRow.candle_open_time,
      lockedEntryPrice: dbRow.locked_entry_price,
      livePnlPct: isResolved
        ? dbRow.realized_pct
        : calcDirectionalPct(dbRow.action, dbRow.locked_entry_price, currentPx),
      tp1HitAt: dbRow.tp1_hit_at,
      tp2HitAt: dbRow.tp2_hit_at,
      tp3HitAt: dbRow.tp3_hit_at,
      slHitAt: dbRow.sl_hit_at,
      closedAt: dbRow.closed_at,
      closedPrice: dbRow.closed_price,
      realizedPct: dbRow.realized_pct,
    };

    return {
      ...parsed,
      assetClass: (dbRow.asset_class as QuantAssetCategory) || parsed.assetClass || 'crypto',
      price: currentPx,
      change24hPct:
        change24hPct !== undefined && Number.isFinite(change24hPct)
          ? change24hPct
          : parsed.change24hPct,
      lockState,
    };
  } catch {
    return null;
  }
}

/**
 * Reconciles a candidate closed-candle evaluation against SQLite persistent locked signals.
 * - If an OPEN locked signal exists for (canonicalId, timeframe), its Entry/SL/TP1/TP2/TP3
 *   and BUY/SELL direction remain 100% STATIC (never repainted on market price shift).
 *   Only its real milestone status (TP1_HIT, TP2_HIT, TP3_HIT, TP1_SECURED, SL_HIT, EXPIRED)
 *   is evaluated against live price & candles since lock.
 * - If no open locked signal exists and the closed-candle candidate is actionable (A+/A/B)
 *   and outside post-close cooldown, it is persisted & locked in SQLite.
 */
export function reconcileStaticLockedSignal(params: {
  candidate: QuantSignalRow;
  livePrice: number;
  completedCandles: Candle[];
  nowMs?: number;
}): QuantSignalRow {
  ensureLockedSignalsTable();
  const db = getDb();
  const now = params.nowMs ?? Date.now();
  const { candidate, livePrice, completedCandles } = params;

  const openRow = db
    .prepare(
      `SELECT * FROM locked_quant_signals
       WHERE canonical_id = ? AND timeframe = ? AND status IN ('ACTIVE', 'TP1_HIT', 'TP2_HIT')
       ORDER BY locked_at DESC LIMIT 1`,
    )
    .get(candidate.canonicalId, candidate.timeframe) as LockedSignalDbRow | undefined;

  if (openRow) {
    // Evaluate strictly against STATIC frozen Entry / SL / TP1 / TP2 / TP3
    const barsSinceLock = completedCandles.filter((c) => c.openTime > openRow.candle_open_time);
    let highSince = livePrice;
    let lowSince = livePrice;
    for (const bar of barsSinceLock) {
      if (bar.high > highSince) highSince = bar.high;
      if (bar.low < lowSince) lowSince = bar.low;
    }

    let status: LockedSignalStatus = openRow.status;
    let tp1HitAt = openRow.tp1_hit_at;
    let tp2HitAt = openRow.tp2_hit_at;
    let tp3HitAt = openRow.tp3_hit_at;
    let slHitAt = openRow.sl_hit_at;
    let closedAt = openRow.closed_at;
    let closedPrice = openRow.closed_price;
    let realizedPct = openRow.realized_pct;

    const isBuy = openRow.action === 'BUY';
    const entry = openRow.locked_entry_price;

    if (isBuy) {
      // Check Stop Loss first if TP1 hasn't been hit yet
      if (status === 'ACTIVE' && lowSince <= openRow.stop_loss) {
        status = 'SL_HIT';
        slHitAt = now;
        closedAt = now;
        closedPrice = openRow.stop_loss;
        realizedPct = calcDirectionalPct('BUY', entry, openRow.stop_loss);
      } else {
        if (!tp1HitAt && highSince >= openRow.tp1) {
          tp1HitAt = now;
          status = 'TP1_HIT';
        }
        if (!tp2HitAt && highSince >= openRow.tp2) {
          tp2HitAt = now;
          status = 'TP2_HIT';
        }
        if (highSince >= openRow.tp3) {
          tp3HitAt = now;
          status = 'TP3_HIT';
          closedAt = now;
          closedPrice = openRow.tp3;
          realizedPct = calcDirectionalPct('BUY', entry, openRow.tp3);
        } else if ((status === 'TP1_HIT' || status === 'TP2_HIT') && livePrice <= entry) {
          // Breakeven protection triggered after TP1 was already secured
          status = 'TP1_SECURED';
          closedAt = now;
          closedPrice = entry;
          // 50% booked at TP1 + 50% exited at breakeven
          realizedPct = Number((calcDirectionalPct('BUY', entry, openRow.tp1) * 0.5).toFixed(2));
        }
      }
    } else {
      // SELL (SHORT)
      if (status === 'ACTIVE' && highSince >= openRow.stop_loss) {
        status = 'SL_HIT';
        slHitAt = now;
        closedAt = now;
        closedPrice = openRow.stop_loss;
        realizedPct = calcDirectionalPct('SELL', entry, openRow.stop_loss);
      } else {
        if (!tp1HitAt && lowSince <= openRow.tp1) {
          tp1HitAt = now;
          status = 'TP1_HIT';
        }
        if (!tp2HitAt && lowSince <= openRow.tp2) {
          tp2HitAt = now;
          status = 'TP2_HIT';
        }
        if (lowSince <= openRow.tp3) {
          tp3HitAt = now;
          status = 'TP3_HIT';
          closedAt = now;
          closedPrice = openRow.tp3;
          realizedPct = calcDirectionalPct('SELL', entry, openRow.tp3);
        } else if ((status === 'TP1_HIT' || status === 'TP2_HIT') && livePrice >= entry) {
          status = 'TP1_SECURED';
          closedAt = now;
          closedPrice = entry;
          realizedPct = Number((calcDirectionalPct('SELL', entry, openRow.tp1) * 0.5).toFixed(2));
        }
      }
    }

    // Expire untouched signal only after its full timeframe lock window elapses
    if ((status === 'ACTIVE' || status === 'TP1_HIT' || status === 'TP2_HIT') && now >= openRow.expires_at) {
      if (status === 'TP1_HIT' || status === 'TP2_HIT') {
        status = 'TP1_SECURED';
        realizedPct = calcDirectionalPct(openRow.action, entry, livePrice);
      } else {
        status = 'EXPIRED';
        realizedPct = calcDirectionalPct(openRow.action, entry, livePrice);
      }
      closedAt = now;
      closedPrice = livePrice;
    }

    if (
      status !== openRow.status ||
      tp1HitAt !== openRow.tp1_hit_at ||
      tp2HitAt !== openRow.tp2_hit_at ||
      tp3HitAt !== openRow.tp3_hit_at ||
      closedAt !== openRow.closed_at
    ) {
      db.prepare(
        `UPDATE locked_quant_signals
         SET status = ?, tp1_hit_at = ?, tp2_hit_at = ?, tp3_hit_at = ?, sl_hit_at = ?,
             closed_at = ?, closed_price = ?, realized_pct = ?
         WHERE id = ?`,
      ).run(
        status,
        tp1HitAt,
        tp2HitAt,
        tp3HitAt,
        slHitAt,
        closedAt,
        closedPrice,
        realizedPct,
        openRow.id,
      );
    }

    const updatedDbRow: LockedSignalDbRow = {
      ...openRow,
      status,
      tp1_hit_at: tp1HitAt,
      tp2_hit_at: tp2HitAt,
      tp3_hit_at: tp3HitAt,
      sl_hit_at: slHitAt,
      closed_at: closedAt,
      closed_price: closedPrice,
      realized_pct: realizedPct,
    };

    const hydrated = dbRowToSignalRow(updatedDbRow, livePrice, candidate.change24hPct);
    if (hydrated && (status === 'ACTIVE' || status === 'TP1_HIT' || status === 'TP2_HIT')) {
      return hydrated;
    }
    // If it just resolved on this check, return WAIT with cooldown note so user sees it in Resolved History
    if (hydrated) {
      return {
        ...candidate,
        action: 'WAIT',
        grade: 'C',
        rejectionReasons: [
          `Previous locked ${openRow.action} signal just resolved (${status.replace(/_/g, ' ')}, ${
            realizedPct !== null && realizedPct >= 0 ? '+' : ''
          }${realizedPct ?? 0}%) — cooling down before next closed-candle lock.`,
        ],
        lockState: null,
      };
    }
  }

  // No open locked signal: enforce 2-bar post-resolution cooldown so stop-outs don't immediately re-fire
  const cooldownMs = Math.max(TIMEFRAME_MS[candidate.timeframe] * 2, 15 * 60_000);
  const recentClosed = db
    .prepare(
      `SELECT id, status, closed_at, realized_pct FROM locked_quant_signals
       WHERE canonical_id = ? AND timeframe = ? AND closed_at IS NOT NULL AND closed_at > ?
       ORDER BY closed_at DESC LIMIT 1`,
    )
    .get(candidate.canonicalId, candidate.timeframe, now - cooldownMs) as
    | { id: string; status: string; closed_at: number; realized_pct: number | null }
    | undefined;

  if (recentClosed && candidate.action !== 'WAIT') {
    const minsLeft = Math.max(1, Math.ceil((recentClosed.closed_at + cooldownMs - now) / 60_000));
    return {
      ...candidate,
      action: 'WAIT',
      grade: 'C',
      rejectionReasons: [
        `Post-resolution cooldown (${minsLeft}m remaining after ${recentClosed.status.replace(/_/g, ' ')}) to prevent whipsaw re-entry.`,
      ],
      setup: {
        ...candidate.setup,
        direction: 'WAIT',
        directionLabel: 'NEUTRAL (WAIT)',
        stopLoss: null,
        stopLossPct: null,
        takeProfits: [],
        riskRewardTp2: null,
      },
      lockState: null,
    };
  }

  // Lock new high-conviction closed-candle signal (A+, A, or B) into SQLite!
  if (
    candidate.action !== 'WAIT' &&
    candidate.setup.entryPrice !== null &&
    candidate.setup.stopLoss !== null &&
    candidate.setup.takeProfits.length >= 3
  ) {
    const lastCompleted = completedCandles[completedCandles.length - 1];
    const candleOpenTime = lastCompleted?.openTime ?? now;
    const lockId = `lock-${candidate.canonicalId}-${candidate.timeframe}-${candleOpenTime}`;
    const expiresAt = now + lockDurationMsForTimeframe(candidate.timeframe);

    const lockedEntryPrice = candidate.setup.entryPrice;
    const lockState: LockedSignalState = {
      lockId,
      isLocked: true,
      status: 'ACTIVE',
      lockedAt: now,
      expiresAt,
      candleOpenTime,
      lockedEntryPrice,
      livePnlPct: calcDirectionalPct(candidate.action, lockedEntryPrice, livePrice),
      tp1HitAt: null,
      tp2HitAt: null,
      tp3HitAt: null,
      slHitAt: null,
      closedAt: null,
      closedPrice: null,
      realizedPct: null,
    };

    const frozenCandidate: QuantSignalRow = {
      ...candidate,
      price: livePrice,
      lockState,
    };

    db.prepare(
      `INSERT OR REPLACE INTO locked_quant_signals (
        id, canonical_id, asset_class, exchange, market_type, display_symbol, base_asset,
        timeframe, action, grade, alpha_score, locked_entry_price, entry_zone_low, entry_zone_high,
        stop_loss, tp1, tp2, tp3, status, tp1_hit_at, tp2_hit_at, tp3_hit_at, sl_hit_at,
        closed_at, closed_price, realized_pct, candle_open_time, locked_at, expires_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
    ).run(
      lockId,
      candidate.canonicalId,
      candidate.assetClass,
      candidate.exchange,
      candidate.marketType,
      candidate.displaySymbol,
      candidate.baseAsset,
      candidate.timeframe,
      candidate.action,
      candidate.grade,
      candidate.alphaScore,
      lockedEntryPrice,
      candidate.setup.entryZoneLow,
      candidate.setup.entryZoneHigh,
      candidate.setup.stopLoss,
      candidate.setup.takeProfits[0].price,
      candidate.setup.takeProfits[1].price,
      candidate.setup.takeProfits[2].price,
      candleOpenTime,
      now,
      expiresAt,
      JSON.stringify(frozenCandidate),
    );

    return frozenCandidate;
  }

  return { ...candidate, price: livePrice, lockState: null };
}

function listRecentResolvedLockedSignals(
  assetClass: SignalAssetClass,
  exchange: ExchangeId,
  timeframe: Timeframe,
  limit = 18,
): {
  resolved: QuantSignalRow[];
  winsCount: number;
  lossesCount: number;
  resolvedCount: number;
} {
  ensureLockedSignalsTable();
  const db = getDb();
  const sinceMs = Date.now() - 72 * 3_600_000;

  let rows: LockedSignalDbRow[];
  if (assetClass === 'all') {
    rows = db
      .prepare(
        `SELECT * FROM locked_quant_signals
         WHERE timeframe = ? AND status IN ('TP3_HIT', 'TP1_SECURED', 'SL_HIT', 'EXPIRED')
           AND closed_at >= ?
         ORDER BY closed_at DESC LIMIT ?`,
      )
      .all(timeframe, sinceMs, limit) as unknown as LockedSignalDbRow[];
  } else if (assetClass === 'crypto') {
    rows = db
      .prepare(
        `SELECT * FROM locked_quant_signals
         WHERE asset_class = 'crypto' AND exchange = ? AND timeframe = ?
           AND status IN ('TP3_HIT', 'TP1_SECURED', 'SL_HIT', 'EXPIRED')
           AND closed_at >= ?
         ORDER BY closed_at DESC LIMIT ?`,
      )
      .all(exchange, timeframe, sinceMs, limit) as unknown as LockedSignalDbRow[];
  } else {
    rows = db
      .prepare(
        `SELECT * FROM locked_quant_signals
         WHERE asset_class = ? AND timeframe = ?
           AND status IN ('TP3_HIT', 'TP1_SECURED', 'SL_HIT', 'EXPIRED')
           AND closed_at >= ?
         ORDER BY closed_at DESC LIMIT ?`,
      )
      .all(assetClass, timeframe, sinceMs, limit) as unknown as LockedSignalDbRow[];
  }

  const resolved: QuantSignalRow[] = [];
  let winsCount = 0;
  let lossesCount = 0;

  for (const r of rows) {
    const hydrated = dbRowToSignalRow(r, r.closed_price);
    if (hydrated) resolved.push(hydrated);
    if (r.status === 'TP3_HIT' || r.status === 'TP1_SECURED' || (r.realized_pct !== null && r.realized_pct > 0)) {
      winsCount += 1;
    } else if (r.status === 'SL_HIT' || (r.realized_pct !== null && r.realized_pct < 0)) {
      lossesCount += 1;
    }
  }

  return { resolved, winsCount, lossesCount, resolvedCount: rows.length };
}

// =========================================================================
// 1. CAUSAL WALK-FORWARD HISTORICAL TRADE SIMULATOR (ZERO LOOKAHEAD)
// =========================================================================

export function simulateHistoricalEdge(
  completedCandles: Candle[],
  targetDirection: 'BUY' | 'SELL',
): QuantHistoricalEdge {
  if (completedCandles.length < 75) {
    return {
      sampleTrades: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      expectancyR: null,
      profitFactor: null,
      avgWinR: null,
      avgLossR: null,
      passed: true,
      note: 'Insufficient historical bars for walk-forward simulation; relying on live multi-factor gates.',
    };
  }

  const { series } = computeAllIndicatorSeries(completedCandles);
  const startIdx = 52;
  const maxHorizon = 24;
  const endIdx = completedCandles.length - 8;

  const realizedRs: number[] = [];
  let nextAllowedIdx = startIdx;

  for (let i = startIdx; i < endIdx; i++) {
    if (i < nextAllowedIdx) continue;

    const close = completedCandles[i].close;
    const ema20 = series.ema20[i];
    const ema50 = series.ema50[i];
    const rsi = series.rsi14[i];
    const macdHist = series.macdHist[i];
    const adx = series.adx14[i];
    const atr = series.atr14[i];
    const vwap = series.vwap[i];

    if (
      ema20 === null ||
      ema50 === null ||
      rsi === null ||
      macdHist === null ||
      adx === null ||
      atr === null ||
      atr <= 0
    ) {
      continue;
    }

    if (adx < 18) continue;
    const distAtr = Math.abs(close - ema20) / atr;
    if (distAtr > 2.2) continue;

    let triggerMatch = false;
    if (targetDirection === 'BUY') {
      const emaAligned = close > ema20 && ema20 > ema50;
      const momOk = macdHist > 0 && rsi >= 48 && rsi <= 72;
      const vwapOk = vwap === null || close >= vwap * 0.996;
      triggerMatch = emaAligned && momOk && vwapOk;
    } else {
      const emaAligned = close < ema20 && ema20 < ema50;
      const momOk = macdHist < 0 && rsi <= 52 && rsi >= 28;
      const vwapOk = vwap === null || close <= vwap * 1.004;
      triggerMatch = emaAligned && momOk && vwapOk;
    }

    if (!triggerMatch) continue;

    const entry = close;
    const risk = atr * 2.0;
    let currentSl = targetDirection === 'BUY' ? entry - risk : entry + risk;
    const tp1 = targetDirection === 'BUY' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = targetDirection === 'BUY' ? entry + risk * 2.6 : entry - risk * 2.6;

    let hitTp1 = false;
    let tradeR: number | null = null;
    const lastBar = Math.min(completedCandles.length - 1, i + maxHorizon);

    for (let j = i + 1; j <= lastBar; j++) {
      const bar = completedCandles[j];
      if (targetDirection === 'BUY') {
        if (bar.low <= currentSl) {
          tradeR = hitTp1 ? 0.75 : -1.0;
          break;
        }
        if (!hitTp1 && bar.high >= tp1) {
          hitTp1 = true;
          currentSl = entry;
        }
        if (bar.high >= tp2) {
          tradeR = 2.05;
          break;
        }
      } else {
        if (bar.high >= currentSl) {
          tradeR = hitTp1 ? 0.75 : -1.0;
          break;
        }
        if (!hitTp1 && bar.low <= tp1) {
          hitTp1 = true;
          currentSl = entry;
        }
        if (bar.low <= tp2) {
          tradeR = 2.05;
          break;
        }
      }
    }

    if (tradeR === null) {
      const exitClose = completedCandles[lastBar].close;
      const remR =
        targetDirection === 'BUY' ? (exitClose - entry) / risk : (entry - exitClose) / risk;
      tradeR = hitTp1 ? 0.75 + 0.5 * remR : remR;
    }

    const netR = Number((tradeR - 0.08).toFixed(3));
    realizedRs.push(netR);
    nextAllowedIdx = i + 6;
  }

  const sampleTrades = realizedRs.length;
  if (sampleTrades === 0) {
    return {
      sampleTrades: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      expectancyR: null,
      profitFactor: null,
      avgWinR: null,
      avgLossR: null,
      passed: true,
      note: `No prior ${targetDirection} trend triggers in the last ${completedCandles.length} bars (fresh regime shift).`,
    };
  }

  const winRs = realizedRs.filter((r) => r > 0);
  const lossRs = realizedRs.filter((r) => r <= 0);
  const wins = winRs.length;
  const losses = lossRs.length;
  const winRatePct = Number(((wins / sampleTrades) * 100).toFixed(1));
  const expectancyR = Number(
    (realizedRs.reduce((sum, r) => sum + r, 0) / sampleTrades).toFixed(2),
  );
  const grossWin = winRs.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(lossRs.reduce((sum, r) => sum + r, 0));
  const profitFactor =
    grossLoss > 0
      ? Number((grossWin / grossLoss).toFixed(2))
      : grossWin > 0
        ? 9.99
        : 0;
  const avgWinR = wins > 0 ? Number((grossWin / wins).toFixed(2)) : null;
  const avgLossR = losses > 0 ? Number((grossLoss / losses).toFixed(2)) : null;

  const passed = sampleTrades < 3 ? true : winRatePct >= 42 && expectancyR >= 0.05;
  const note =
    sampleTrades < 3
      ? `${sampleTrades} historical ${targetDirection} setup(s) in window (${winRatePct}% win, ${expectancyR >= 0 ? '+' : ''}${expectancyR}R) — small sample.`
      : passed
        ? `Positive walk-forward edge: ${wins}/${sampleTrades} wins (${winRatePct}%), expectancy ${expectancyR >= 0 ? '+' : ''}${expectancyR}R, PF ${profitFactor}.`
        : `Negative historical edge: ${wins}/${sampleTrades} wins (${winRatePct}%), expectancy ${expectancyR >= 0 ? '+' : ''}${expectancyR}R — filtered to avoid losses.`;

  return {
    sampleTrades,
    wins,
    losses,
    winRatePct,
    expectancyR,
    profitFactor,
    avgWinR,
    avgLossR,
    passed,
    note,
  };
}

// =========================================================================
// 2. CLOSED-CANDLE STATIC ANTI-WICK QUANT TRADE SETUP BUILDER
// =========================================================================

function buildQuantSignalSetup(params: {
  displaySymbol: string;
  action: 'BUY' | 'SELL' | 'WAIT';
  closedCandlePrice: number;
  atr14: number | null;
  ema20: number | null;
  vwap: number | null;
  srZones: SupportResistanceZone[];
  overextended: boolean;
  eventRiskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  rejectionSummary?: string;
}): SignalSetupPlan {
  const symbol = toCompactTicker(params.displaySymbol);
  const price = params.closedCandlePrice;

  if (params.action === 'WAIT' || !Number.isFinite(price) || price <= 0) {
    return {
      symbol,
      direction: 'WAIT',
      directionLabel: 'NEUTRAL (WAIT)',
      entryMode: 'ZONE',
      entryPrice: Number.isFinite(price) && price > 0 ? roundPrice(price) : null,
      entryZoneLow: null,
      entryZoneHigh: null,
      stopLoss: null,
      stopLossPct: null,
      takeProfits: [],
      riskRewardTp2: null,
      atr14: params.atr14,
      methodology:
        params.rejectionSummary ||
        'Blocked by multi-factor quant filters (HTF trend, historical expectancy, chop, or event risk).',
    };
  }

  const isBuy = params.action === 'BUY';
  const atr =
    params.atr14 !== null && Number.isFinite(params.atr14) && params.atr14 > 0
      ? params.atr14
      : price * 0.01;

  const entryMode: 'NOW' | 'ZONE' = params.overextended ? 'ZONE' : 'NOW';
  let entryPrice = price;
  let entryZoneLow = price - atr * 0.25;
  let entryZoneHigh = price + atr * 0.25;

  if (params.overextended) {
    const anchors = [params.ema20, params.vwap].filter(
      (v): v is number => v !== null && Number.isFinite(v) && v > 0,
    );
    const pullAnchor =
      anchors.length > 0
        ? isBuy
          ? Math.min(...anchors)
          : Math.max(...anchors)
        : isBuy
          ? price - atr * 0.9
          : price + atr * 0.9;

    if (isBuy) {
      const clampedAnchor = clamp(pullAnchor, price - atr * 1.5, price - atr * 0.35);
      entryZoneLow = Math.max(price * 0.5, clampedAnchor - atr * 0.25);
      entryZoneHigh = Math.min(price - atr * 0.1, clampedAnchor + atr * 0.35);
    } else {
      const clampedAnchor = clamp(pullAnchor, price + atr * 0.35, price + atr * 1.5);
      entryZoneLow = Math.max(price + atr * 0.1, clampedAnchor - atr * 0.35);
      entryZoneHigh = clampedAnchor + atr * 0.25;
    }
    entryPrice = (entryZoneLow + entryZoneHigh) / 2;
  }

  const baseSlMult = params.eventRiskLevel === 'HIGH' ? 2.25 : 1.9;
  const minSlMult = 1.4;
  const maxSlMult = 2.9;
  let rawSl = isBuy ? entryPrice - atr * baseSlMult : entryPrice + atr * baseSlMult;
  let slNote = `${baseSlMult.toFixed(2)}× ATR anti-wick stop`;

  if (isBuy) {
    const validSupports = params.srZones
      .filter((z) => z.type === 'SUPPORT' && z.zoneLow < entryPrice)
      .map((z) => z.zoneLow - atr * 0.35)
      .filter((lvl) => {
        const dist = entryPrice - lvl;
        return lvl > 0 && dist >= atr * minSlMult && dist <= atr * maxSlMult;
      })
      .sort((a, b) => b - a);
    if (validSupports.length > 0) {
      rawSl = validSupports[0];
      slNote = 'structural support − 0.35× ATR anti-wick buffer';
    }
    rawSl = Math.max(entryPrice * 0.1, Math.min(rawSl, entryPrice - atr * minSlMult));
  } else {
    const validRes = params.srZones
      .filter((z) => z.type === 'RESISTANCE' && z.zoneHigh > entryPrice)
      .map((z) => z.zoneHigh + atr * 0.35)
      .filter((lvl) => {
        const dist = lvl - entryPrice;
        return dist >= atr * minSlMult && dist <= atr * maxSlMult;
      })
      .sort((a, b) => a - b);
    if (validRes.length > 0) {
      rawSl = validRes[0];
      slNote = 'structural resistance + 0.35× ATR anti-wick buffer';
    }
    rawSl = Math.max(rawSl, entryPrice + atr * minSlMult);
  }

  const riskUnit = Math.abs(entryPrice - rawSl);

  const targets: { label: 'TP1' | 'TP2' | 'TP3'; mult: number }[] = [
    { label: 'TP1', mult: 1.5 },
    { label: 'TP2', mult: 2.5 },
    { label: 'TP3', mult: 3.5 },
  ];

  const takeProfits: SignalTakeProfitTarget[] = targets.map(({ label, mult }) => {
    const rawTarget = isBuy
      ? entryPrice + riskUnit * mult
      : Math.max(entryPrice * 0.05, entryPrice - riskUnit * mult);
    const roundedTarget = roundPrice(rawTarget);
    const pctFromEntry = Number((((roundedTarget - entryPrice) / entryPrice) * 100).toFixed(2));
    const rrRatio = Number(
      (Math.abs(roundedTarget - entryPrice) / Math.max(riskUnit, 1e-12)).toFixed(2),
    );
    return { label, price: roundedTarget, pctFromEntry, rrRatio };
  });

  const roundedEntry = roundPrice(entryPrice);
  const roundedLow = roundPrice(Math.max(entryZoneLow, 0));
  const roundedHigh = roundPrice(entryZoneHigh);
  const roundedSl = roundPrice(rawSl);
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
    riskRewardTp2: takeProfits[1]?.rrRatio ?? 2.5,
    atr14: params.atr14,
    methodology: `Static closed-candle anchor · ${entryMode === 'ZONE' ? 'Anti-Chase Pullback Limit' : 'Locked Trend Execution'} · ${slNote} · 1.5R / 2.5R / 3.5R targets.`,
  };
}

// =========================================================================
// 3. PURE PER-ASSET 4-PILLAR CLOSED-CANDLE QUANT EVALUATOR
// =========================================================================

export function evaluateQuantAsset(params: {
  canonicalId: string;
  assetClass?: QuantAssetCategory;
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  htfTimeframe: Timeframe | null;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  candles: Candle[];
  htfCandles: Candle[] | null;
  intel: MarketIntelligenceSnapshot;
}): QuantSignalRow {
  const nowMs = Date.now();
  const prefs = getStoredPreferences();
  const assetClass = params.assetClass ?? inferAssetCategory(params.exchange, params.baseAsset);

  let htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let htfDirectionalScore = 0;
  let htfClassification:
    | 'STRONG_BULLISH'
    | 'BULLISH'
    | 'NEUTRAL'
    | 'BEARISH'
    | 'STRONG_BEARISH'
    | 'INSUFFICIENT_DATA'
    | null = null;

  if (params.htfCandles && params.htfCandles.length >= 40 && params.htfTimeframe) {
    const htfAnalysis = runFullAssetAnalysis(params.htfCandles, {
      canonicalId: params.canonicalId,
      exchange: params.exchange,
      marketType: params.marketType,
      displaySymbol: params.displaySymbol,
      timeframe: params.htfTimeframe,
      freshness: 'LIVE',
      weights: prefs.weights,
      thresholds: prefs.thresholds,
    });
    htfDirectionalScore = htfAnalysis.confirmed.directionalScore;
    htfClassification = htfAnalysis.confirmed.classification;
    if (htfDirectionalScore >= 14) htfBias = 'BULLISH';
    else if (htfDirectionalScore <= -14) htfBias = 'BEARISH';
    else htfBias = 'NEUTRAL';
  }

  const analysis = runFullAssetAnalysis(params.candles, {
    canonicalId: params.canonicalId,
    exchange: params.exchange,
    marketType: params.marketType,
    displaySymbol: params.displaySymbol,
    timeframe: params.timeframe,
    freshness: 'LIVE',
    weights: prefs.weights,
    thresholds: prefs.thresholds,
    minCoveragePct: prefs.minCoveragePct,
    minAgreementForStrongPct: prefs.minAgreementForStrongPct,
    higherTimeframeBias: htfClassification,
  });

  const confirmed = analysis.confirmed;
  const validated = validateCandles(params.candles, params.timeframe);
  const completed = validated.completedCandles;
  const { series } = computeAllIndicatorSeries(completed);
  const lastIdx = completed.length - 1;

  // CRITICAL FOR STATIC SIGNALS: Anchor Entry/SL/TP strictly to the CLOSED candle close,
  // never the live intra-bar tick! Live price is stored separately as `price`.
  const closedCandlePrice =
    lastIdx >= 0 && Number.isFinite(completed[lastIdx].close) && completed[lastIdx].close > 0
      ? completed[lastIdx].close
      : params.price;
  const liveReferencePrice =
    Number.isFinite(params.price) && params.price > 0 ? params.price : closedCandlePrice;

  const ema20 = lastIdx >= 0 ? series.ema20[lastIdx] : null;
  const vwap = lastIdx >= 0 ? series.vwap[lastIdx] : null;
  const atr14 = lastIdx >= 0 ? series.atr14[lastIdx] : null;
  const atrPct = lastIdx >= 0 ? series.atrPct[lastIdx] : null;
  const adx14 = lastIdx >= 0 ? series.adx14[lastIdx] : null;
  const rsi14 = lastIdx >= 0 ? series.rsi14[lastIdx] : null;
  const rvol20 = lastIdx >= 0 ? series.rvol20[lastIdx] : null;
  const srZones = analysis.supportResistance;

  const dirScore = confirmed.directionalScore;
  const agreementPct = confirmed.agreement.agreementPct;

  let rawDirection: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (dirScore >= 20) rawDirection = 'BUY';
  else if (dirScore <= -20) rawDirection = 'SELL';

  const distanceAtrFromEma20 =
    ema20 !== null && atr14 !== null && atr14 > 0
      ? Number(((closedCandlePrice - ema20) / atr14).toFixed(2))
      : null;

  const overextended =
    rawDirection === 'BUY'
      ? (distanceAtrFromEma20 !== null && distanceAtrFromEma20 > 1.8) ||
        (rsi14 !== null && rsi14 > 73)
      : rawDirection === 'SELL'
        ? (distanceAtrFromEma20 !== null && distanceAtrFromEma20 < -1.8) ||
          (rsi14 !== null && rsi14 < 27)
        : false;

  let technicalScore = clamp(
    Math.round(
      Math.min(100, Math.abs(dirScore) * 1.15) * 0.55 +
        agreementPct * 0.35 +
        (adx14 !== null ? clamp((adx14 - 12) * 3.2, 0, 100) : 40) * 0.1,
    ),
    0,
    100,
  );
  if (rvol20 !== null && rvol20 >= 1.35) technicalScore = Math.min(100, technicalScore + 5);
  if (overextended) technicalScore = Math.max(0, technicalScore - 12);

  const htfAligned =
    rawDirection === 'NEUTRAL'
      ? false
      : (rawDirection === 'BUY' && htfBias === 'BULLISH') ||
        (rawDirection === 'SELL' && htfBias === 'BEARISH');
  const htfOpposed =
    (rawDirection === 'BUY' && htfBias === 'BEARISH') ||
    (rawDirection === 'SELL' && htfBias === 'BULLISH');

  const htfScore =
    rawDirection === 'NEUTRAL'
      ? 40
      : htfAligned
        ? clamp(Math.round(72 + Math.min(28, Math.abs(htfDirectionalScore) * 0.45)), 72, 100)
        : htfOpposed
          ? clamp(Math.round(28 - Math.min(20, Math.abs(htfDirectionalScore) * 0.3)), 8, 28)
          : 56;

  const historicalEdge: QuantHistoricalEdge =
    rawDirection === 'NEUTRAL'
      ? {
          sampleTrades: 0,
          wins: 0,
          losses: 0,
          winRatePct: null,
          expectancyR: null,
          profitFactor: null,
          avgWinR: null,
          avgLossR: null,
          passed: false,
          note: 'No active directional signal to backtest.',
        }
      : simulateHistoricalEdge(completed, rawDirection);

  let historicalScore = 52;
  if (
    historicalEdge.sampleTrades >= 3 &&
    historicalEdge.winRatePct !== null &&
    historicalEdge.expectancyR !== null
  ) {
    const wrPart = clamp((historicalEdge.winRatePct - 25) * 1.4, 0, 60);
    const expPart = clamp((historicalEdge.expectancyR + 0.35) * 45, 0, 40);
    historicalScore = clamp(Math.round(wrPart + expPart), 0, 100);
  } else if (historicalEdge.sampleTrades > 0 && historicalEdge.expectancyR !== null) {
    historicalScore = clamp(Math.round(52 + historicalEdge.expectancyR * 18), 30, 75);
  }

  const assetSent = getAssetSentimentContext(params.baseAsset, params.intel);
  const directionalSentAlignment =
    rawDirection === 'BUY'
      ? assetSent.score
      : rawDirection === 'SELL'
        ? -assetSent.score
        : 0;
  let sentimentScore = clamp(Math.round(54 + directionalSentAlignment * 0.55), 5, 100);
  if (assetSent.blocksLong && rawDirection === 'BUY') sentimentScore = 5;
  if (assetSent.blocksShort && rawDirection === 'SELL') sentimentScore = 10;

  const rawAlphaScore = clamp(
    Math.round(
      technicalScore * 0.35 +
        htfScore * 0.25 +
        historicalScore * 0.25 +
        sentimentScore * 0.15,
    ),
    0,
    100,
  );

  const gatesPassed: string[] = [];
  const rejectionReasons: string[] = [];

  if (rawDirection === 'NEUTRAL') {
    rejectionReasons.push(
      `Weak technical consensus (score ${dirScore > 0 ? '+' : ''}${dirScore}, requires ≥ ±20).`,
    );
  } else {
    gatesPassed.push(
      `Closed-Candle Confluence (${dirScore > 0 ? '+' : ''}${dirScore}, ${agreementPct}% agreement)`,
    );
  }

  if (adx14 !== null && adx14 < 18) {
    rejectionReasons.push(`Choppy sideways market (ADX ${adx14.toFixed(1)} < 18 — whipsaw risk).`);
  } else if (adx14 !== null) {
    gatesPassed.push(`Trend Strength Confirmed (ADX ${adx14.toFixed(1)})`);
  }

  if (rawDirection !== 'NEUTRAL') {
    if (htfOpposed) {
      const eliteReversal = Math.abs(dirScore) >= 68 && agreementPct >= 75;
      if (!eliteReversal) {
        rejectionReasons.push(
          `Counter-trend vs ${params.htfTimeframe ?? 'HTF'} (${htfBias}) — trading against primary trend blocked.`,
        );
      } else {
        gatesPassed.push(`Extreme Reversal Override vs ${params.htfTimeframe ?? 'HTF'}`);
      }
    } else if (htfAligned) {
      gatesPassed.push(`HTF ${params.htfTimeframe ?? ''} Aligned (${htfBias})`);
    } else {
      gatesPassed.push(`HTF ${params.htfTimeframe ?? ''} Neutral (No Conflict)`);
    }
  }

  if (rawDirection !== 'NEUTRAL') {
    if (historicalEdge.sampleTrades >= 3 && !historicalEdge.passed) {
      rejectionReasons.push(
        `Negative historical edge (${historicalEdge.winRatePct}% win, ${historicalEdge.expectancyR}R across ${historicalEdge.sampleTrades} trades).`,
      );
    } else if (historicalEdge.sampleTrades >= 3) {
      gatesPassed.push(
        `Historical Edge +${historicalEdge.expectancyR}R (${historicalEdge.winRatePct}% win / ${historicalEdge.sampleTrades} trades)`,
      );
    }
  }

  if (rawDirection === 'BUY' && assetSent.blocksLong) {
    rejectionReasons.push(`Shock catalyst blocks LONG: ${assetSent.shockWarning}`);
  } else if (rawDirection === 'SELL' && assetSent.blocksShort) {
    rejectionReasons.push('Active bullish ETF catalyst blocks blind SHORT entry.');
  } else {
    gatesPassed.push('No Active Negative Shock Catalyst');
  }

  if (params.intel.eventRiskLevel === 'HIGH' && rawAlphaScore < 72 && rawDirection !== 'NEUTRAL') {
    rejectionReasons.push(
      `High-impact macro event imminent (${params.intel.eventRiskSummary}) — requires Alpha ≥ 72.`,
    );
  } else if (params.intel.eventRiskLevel === 'LOW') {
    gatesPassed.push('Clear Macro Event Window');
  }

  if (rawDirection !== 'NEUTRAL' && agreementPct < 55) {
    rejectionReasons.push(`Low indicator agreement (${agreementPct}% < 55% minimum).`);
  }

  const hasHardRejection = rejectionReasons.length > 0;
  let grade: QuantSignalGrade;
  let action: 'BUY' | 'SELL' | 'WAIT';
  let finalAlphaScore = rawAlphaScore;

  if (hasHardRejection || rawDirection === 'NEUTRAL') {
    grade = rawDirection === 'NEUTRAL' ? 'C' : 'BLOCKED';
    action = 'WAIT';
    finalAlphaScore = Math.min(rawAlphaScore, 54);
  } else if (rawAlphaScore >= 80) {
    grade = 'A+';
    action = rawDirection;
  } else if (rawAlphaScore >= 70) {
    grade = 'A';
    action = rawDirection;
  } else if (rawAlphaScore >= 60) {
    grade = 'B';
    action = rawDirection;
  } else {
    grade = 'C';
    action = 'WAIT';
    rejectionReasons.push(
      `Combined 4-pillar Alpha Score (${rawAlphaScore}) below B-grade threshold (60).`,
    );
  }

  const setup = buildQuantSignalSetup({
    displaySymbol: params.displaySymbol,
    action,
    closedCandlePrice,
    atr14,
    ema20,
    vwap,
    srZones,
    overextended,
    eventRiskLevel: params.intel.eventRiskLevel,
    rejectionSummary: rejectionReasons[0],
  });

  const keySummary =
    action !== 'WAIT'
      ? `Locked ${grade} ${action} (${finalAlphaScore}/100) · HTF ${htfBias} · ${
          historicalEdge.sampleTrades >= 3
            ? `Hist ${historicalEdge.winRatePct}% win (+${historicalEdge.expectancyR}R)`
            : 'Fresh regime'
        } · Sentiment ${assetSent.label}.`
      : rejectionReasons[0] || 'No high-conviction edge detected.';

  return {
    canonicalId: params.canonicalId,
    assetClass,
    exchange: params.exchange,
    marketType: params.marketType,
    displaySymbol: params.displaySymbol,
    baseAsset: params.baseAsset,
    timeframe: params.timeframe,
    htfTimeframe: params.htfTimeframe,
    price: liveReferencePrice,
    change24hPct: params.change24hPct,
    volume24hUsd: params.volume24hUsd,
    grade,
    alphaScore: finalAlphaScore,
    action,
    rawDirection,
    pillars: {
      technicalScore,
      htfScore,
      historicalScore,
      sentimentScore,
    },
    technicalSummary: {
      directionalScore: dirScore,
      agreementPct,
      adx14: adx14 !== null ? Number(adx14.toFixed(1)) : null,
      rsi14: rsi14 !== null ? Number(rsi14.toFixed(1)) : null,
      atrPct: atrPct !== null ? Number(atrPct.toFixed(2)) : null,
      rvol20: rvol20 !== null ? Number(rvol20.toFixed(2)) : null,
      trendRegime: confirmed.regime.trendRegime,
    },
    htfBias,
    htfAligned,
    historicalEdge,
    assetSentiment: {
      score: assetSent.score,
      label: assetSent.label,
      trendingRank: assetSent.trendingRank,
      fundingPct: assetSent.fundingPct,
      headlinesCount: assetSent.headlinesCount,
      shockWarning: assetSent.shockWarning,
    },
    antiChase: {
      distanceAtrFromEma20,
      overextended,
      entryMode: overextended ? 'PULLBACK_ZONE' : 'NOW',
    },
    gatesPassed,
    rejectionReasons,
    setup,
    lockState: null,
    keySummary,
    scannedAt: nowMs,
  };
}

// =========================================================================
// 4. MULTI-ASSET LIVE STATIC-LOCK SCANNER (CRYPTO, US STOCKS, COMMODITIES)
// =========================================================================

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        const res = await fn(items[idx]);
        if (res !== null) results.push(res);
      } catch {
        // skip transient single-pair error cleanly
      }
    }
  });

  await Promise.all(workers);
  return results;
}

async function scanSingleCategory(params: {
  category: QuantAssetCategory;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  maxPairs: number;
  intel: MarketIntelligenceSnapshot;
}): Promise<{ rows: QuantSignalRow[]; universeCount: number; htfTimeframe: Timeframe | null }> {
  const supported = EXCHANGE_TIMEFRAMES[params.exchange] ?? ['15m', '1h', '4h', '1d'];
  const tf: Timeframe = supported.includes(params.timeframe)
    ? params.timeframe
    : supported.includes('1h')
      ? '1h'
      : supported[0];
  const htfTimeframe = resolveHigherTimeframe(params.exchange, tf);

  let tickers: MarketTicker[] = [];
  try {
    tickers = await getMarketTickers(params.exchange, params.marketType);
  } catch {
    return { rows: [], universeCount: 0, htfTimeframe };
  }

  let filtered = tickers.filter((t) => Number.isFinite(t.lastPrice) && t.lastPrice > 0);
  if (params.category === 'commodities') {
    filtered = filtered.filter((t) => COMMODITY_BASE_SET.has(t.baseAsset.toUpperCase()));
  }

  const universe = filtered
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, params.maxPairs);

  const rows = await mapWithConcurrency(universe, 5, async (ticker) => {
    const [activeRes, htfRes] = await Promise.all([
      fetchCandles(params.exchange, params.marketType, ticker.displaySymbol, tf, 220),
      htfTimeframe
        ? fetchCandles(params.exchange, params.marketType, ticker.displaySymbol, htfTimeframe, 100).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);

    if (!activeRes.candles || activeRes.candles.length < 40) return null;

    const validated = validateCandles(activeRes.candles, tf);
    const candidate = evaluateQuantAsset({
      canonicalId: ticker.canonicalId,
      assetClass: params.category,
      exchange: params.exchange,
      marketType: params.marketType,
      displaySymbol: ticker.displaySymbol,
      baseAsset: ticker.baseAsset,
      timeframe: tf,
      htfTimeframe,
      price: ticker.lastPrice,
      change24hPct: ticker.change24hPct,
      volume24hUsd: ticker.quoteVolume24h,
      candles: activeRes.candles,
      htfCandles: htfRes?.candles ?? null,
      intel: params.intel,
    });

    return reconcileStaticLockedSignal({
      candidate,
      livePrice: ticker.lastPrice,
      completedCandles: validated.completedCandles,
    });
  });

  return { rows, universeCount: universe.length, htfTimeframe };
}

export async function runQuantSignalScan(
  exchange: ExchangeId,
  marketType: MarketType,
  timeframe: Timeframe,
  forceRefresh = false,
  assetClass: SignalAssetClass = 'all',
): Promise<QuantSignalsPayload> {
  const effectiveExchange: ExchangeId =
    assetClass === 'stocks'
      ? 'stocks'
      : assetClass === 'commodities'
        ? 'cfds'
        : exchange === 'stocks' || exchange === 'cfds'
          ? 'binance'
          : exchange;
  const effectiveMarketType: MarketType =
    assetClass === 'stocks'
      ? 'equity'
      : assetClass === 'commodities'
        ? 'cfd'
        : effectiveExchange === 'binance'
          ? 'spot'
          : marketType;

  const cacheKey = `${assetClass}:${effectiveExchange}:${effectiveMarketType}:${timeframe}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = quantCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.payload;
    }
    const pending = quantInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const run = (async (): Promise<QuantSignalsPayload> => {
    const intel = await getMarketIntelligence(forceRefresh);

    let allRows: QuantSignalRow[] = [];
    let scannedUniverseCount = 0;
    let htfTimeframe: Timeframe | null = resolveHigherTimeframe(effectiveExchange, timeframe);

    if (assetClass === 'all') {
      const [cryptoRes, stocksRes, commRes] = await Promise.all([
        scanSingleCategory({
          category: 'crypto',
          exchange: effectiveExchange,
          marketType: effectiveMarketType,
          timeframe,
          maxPairs: 12,
          intel,
        }),
        scanSingleCategory({
          category: 'stocks',
          exchange: 'stocks',
          marketType: 'equity',
          timeframe,
          maxPairs: 12,
          intel,
        }),
        scanSingleCategory({
          category: 'commodities',
          exchange: 'cfds',
          marketType: 'cfd',
          timeframe,
          maxPairs: 8,
          intel,
        }),
      ]);
      allRows = [...cryptoRes.rows, ...stocksRes.rows, ...commRes.rows];
      scannedUniverseCount =
        cryptoRes.universeCount + stocksRes.universeCount + commRes.universeCount;
      htfTimeframe = cryptoRes.htfTimeframe ?? stocksRes.htfTimeframe ?? commRes.htfTimeframe;
    } else {
      const res = await scanSingleCategory({
        category: assetClass,
        exchange: effectiveExchange,
        marketType: effectiveMarketType,
        timeframe,
        maxPairs: assetClass === 'commodities' ? 8 : 16,
        intel,
      });
      allRows = res.rows;
      scannedUniverseCount = res.universeCount;
      htfTimeframe = res.htfTimeframe;
    }

    // Sort: Locked Active signals first (by grade & alphaScore), then WAIT/BLOCKED below
    const gradeOrder: Record<QuantSignalGrade, number> = {
      'A+': 0,
      A: 1,
      B: 2,
      C: 3,
      BLOCKED: 4,
    };
    allRows.sort((a, b) => {
      const aAct = a.action !== 'WAIT' ? 0 : 1;
      const bAct = b.action !== 'WAIT' ? 0 : 1;
      if (aAct !== bAct) return aAct - bAct;
      const gd = gradeOrder[a.grade] - gradeOrder[b.grade];
      if (gd !== 0) return gd;
      return b.alphaScore - a.alphaScore;
    });

    const actionableCount = allRows.filter((r) => r.action !== 'WAIT').length;
    const blockedCount = allRows.length - actionableCount;

    const history = listRecentResolvedLockedSignals(assetClass, effectiveExchange, timeframe, 18);
    const totalDecided = history.winsCount + history.lossesCount;
    const winRatePct =
      totalDecided > 0 ? Number(((history.winsCount / totalDecided) * 100).toFixed(1)) : null;

    const payload: QuantSignalsPayload = {
      assetClass,
      exchange: effectiveExchange,
      marketType: effectiveMarketType,
      timeframe,
      htfTimeframe,
      signals: allRows,
      resolvedSignals: history.resolved,
      actionableCount,
      blockedCount,
      scannedUniverseCount,
      trackRecord: {
        activeLockedCount: actionableCount,
        resolvedCount: history.resolvedCount,
        winsCount: history.winsCount,
        lossesCount: history.lossesCount,
        winRatePct,
      },
      intelligence: intel,
      scannedAt: Date.now(),
      methodologyNote:
        'Static Locked Quant Signals (Crypto · US Stocks · Commodities): Entry, SL, and TP1/TP2/TP3 are anchored strictly to closed candles and persisted in SQLite so levels NEVER repaint or flip on intra-candle price shifts. A locked signal stays active until TP3, Stop Loss, Breakeven after TP1, or Timeframe Expiry.',
    };

    quantCache.set(cacheKey, { payload, expiresAt: Date.now() + QUANT_CACHE_TTL_MS });
    return payload;
  })();

  quantInFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    quantInFlight.delete(cacheKey);
  }
}
