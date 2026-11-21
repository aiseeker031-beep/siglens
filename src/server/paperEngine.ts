import crypto from 'node:crypto';
import { defaultMarketTypeFor } from '../shared/constants';
import type {
  ExchangeId,
  MarketType,
  PaperAccountConfig,
  PaperArenaSnapshot,
  PaperBotDirectionMode,
  PaperBotLeaderboardRow,
  PaperBotLogRecord,
  PaperEquityPoint,
  PaperPosition,
  PaperSide,
  PaperStrategyBot,
  Timeframe,
} from '../shared/types';
import { getDb } from './db';
import { fetchCandles, getMarketTickers } from './providers';
import { runScreenerScan } from './scanner';
import { runFullAssetAnalysis } from '../analytics/signals';
import { getStoredPreferences } from './db';
import { wsHub } from './wsHub';

let schemaReady = false;
let engineLoopTimer: NodeJS.Timeout | null = null;
let cycleRunning = false;
let lastCycleAt: number | null = null;
const lastSymbolCloseAt = new Map<string, number>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensurePaperSchema(): void {
  if (schemaReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_account (
      id TEXT PRIMARY KEY,
      starting_balance_usd REAL NOT NULL,
      cash_balance_usd REAL NOT NULL,
      max_risk_per_trade_pct REAL NOT NULL,
      max_open_positions INTEGER NOT NULL,
      max_daily_drawdown_pct REAL NOT NULL,
      default_leverage REAL NOT NULL,
      fee_bps REAL NOT NULL,
      slippage_bps REAL NOT NULL,
      kill_switch_triggered INTEGER NOT NULL DEFAULT 0,
      kill_switch_reason TEXT,
      daily_start_equity_usd REAL NOT NULL,
      daily_reset_day TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      direction_mode TEXT NOT NULL DEFAULT 'BOTH',
      min_score REAL NOT NULL DEFAULT 40,
      min_agreement_pct REAL NOT NULL DEFAULT 60,
      risk_per_trade_pct REAL NOT NULL DEFAULT 1.5,
      leverage REAL NOT NULL DEFAULT 1,
      trailing_stop_atr_mult REAL,
      partial_tp1_pct REAL NOT NULL DEFAULT 50,
      cooldown_minutes INTEGER NOT NULL DEFAULT 45,
      last_run_at INTEGER,
      last_action_note TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY,
      bot_id TEXT,
      bot_name TEXT NOT NULL,
      canonical_id TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      display_symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      quantity REAL NOT NULL,
      remaining_quantity REAL NOT NULL,
      notional_usd REAL NOT NULL,
      margin_usd REAL NOT NULL,
      leverage REAL NOT NULL,
      stop_loss REAL,
      initial_stop_loss REAL,
      tp1 REAL,
      tp2 REAL,
      tp3 REAL,
      tp1_hit INTEGER NOT NULL DEFAULT 0,
      trailing_atr REAL,
      fees_paid_usd REAL NOT NULL DEFAULT 0,
      realized_pnl_usd REAL NOT NULL DEFAULT 0,
      unrealized_pnl_usd REAL NOT NULL DEFAULT 0,
      unrealized_pnl_pct REAL NOT NULL DEFAULT 0,
      entry_reason TEXT NOT NULL,
      exit_reason TEXT,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_paper_positions_status ON paper_positions (status, opened_at DESC);

    CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      equity_usd REAL NOT NULL,
      cash_usd REAL NOT NULL,
      unrealized_pnl_usd REAL NOT NULL,
      realized_pnl_usd REAL NOT NULL,
      open_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_bot_logs (
      id TEXT PRIMARY KEY,
      bot_id TEXT,
      bot_name TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_paper_logs_time ON paper_bot_logs (timestamp DESC);
  `);

  const existingAcc = db
    .prepare('SELECT id FROM paper_account WHERE id = ?')
    .get('main') as { id: string } | undefined;

  if (!existingAcc) {
    const now = Date.now();
    const day = todayUtc();
    db.prepare(`
      INSERT INTO paper_account (
        id, starting_balance_usd, cash_balance_usd, max_risk_per_trade_pct,
        max_open_positions, max_daily_drawdown_pct, default_leverage,
        fee_bps, slippage_bps, kill_switch_triggered, kill_switch_reason,
        daily_start_equity_usd, daily_reset_day, updated_at
      ) VALUES ('main', 10000, 10000, 2.0, 5, 6.0, 1, 10, 5, 0, NULL, 10000, ?, ?)
    `).run(day, now);

    db.prepare(`
      INSERT INTO paper_equity_snapshots (timestamp, equity_usd, cash_usd, unrealized_pnl_usd, realized_pnl_usd, open_count)
      VALUES (?, 10000, 10000, 0, 0, 0)
    `).run(now);
  }

  schemaReady = true;
}

export function getPaperAccount(): PaperAccountConfig {
  ensurePaperSchema();
  const db = getDb();
  const r = db.prepare('SELECT * FROM paper_account WHERE id = ?').get('main') as Record<string, unknown>;
  return {
    startingBalanceUsd: Number(r.starting_balance_usd),
    cashBalanceUsd: Number(r.cash_balance_usd),
    maxRiskPerTradePct: Number(r.max_risk_per_trade_pct),
    maxOpenPositions: Number(r.max_open_positions),
    maxDailyDrawdownPct: Number(r.max_daily_drawdown_pct),
    defaultLeverage: Number(r.default_leverage),
    feeBps: Number(r.fee_bps),
    slippageBps: Number(r.slippage_bps),
    killSwitchTriggered: Boolean(r.kill_switch_triggered),
    killSwitchReason: r.kill_switch_reason ? String(r.kill_switch_reason) : null,
    dailyStartEquityUsd: Number(r.daily_start_equity_usd),
    dailyResetDay: String(r.daily_reset_day),
    updatedAt: Number(r.updated_at),
  };
}

function savePaperAccount(acc: PaperAccountConfig): PaperAccountConfig {
  ensurePaperSchema();
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    UPDATE paper_account SET
      starting_balance_usd = ?,
      cash_balance_usd = ?,
      max_risk_per_trade_pct = ?,
      max_open_positions = ?,
      max_daily_drawdown_pct = ?,
      default_leverage = ?,
      fee_bps = ?,
      slippage_bps = ?,
      kill_switch_triggered = ?,
      kill_switch_reason = ?,
      daily_start_equity_usd = ?,
      daily_reset_day = ?,
      updated_at = ?
    WHERE id = 'main'
  `).run(
    acc.startingBalanceUsd,
    acc.cashBalanceUsd,
    acc.maxRiskPerTradePct,
    acc.maxOpenPositions,
    acc.maxDailyDrawdownPct,
    acc.defaultLeverage,
    acc.feeBps,
    acc.slippageBps,
    acc.killSwitchTriggered ? 1 : 0,
    acc.killSwitchReason,
    acc.dailyStartEquityUsd,
    acc.dailyResetDay,
    now,
  );
  return { ...acc, updatedAt: now };
}

export function updatePaperAccountConfig(patch: Partial<PaperAccountConfig>): PaperAccountConfig {
  const cur = getPaperAccount();
  const next: PaperAccountConfig = {
    ...cur,
    maxRiskPerTradePct: patch.maxRiskPerTradePct ?? cur.maxRiskPerTradePct,
    maxOpenPositions: patch.maxOpenPositions ?? cur.maxOpenPositions,
    maxDailyDrawdownPct: patch.maxDailyDrawdownPct ?? cur.maxDailyDrawdownPct,
    defaultLeverage: patch.defaultLeverage ?? cur.defaultLeverage,
    feeBps: patch.feeBps ?? cur.feeBps,
    slippageBps: patch.slippageBps ?? cur.slippageBps,
    killSwitchTriggered: patch.killSwitchTriggered ?? cur.killSwitchTriggered,
    killSwitchReason:
      patch.killSwitchTriggered === false ? null : (patch.killSwitchReason ?? cur.killSwitchReason),
  };
  const saved = savePaperAccount(next);
  if (cur.killSwitchTriggered && !saved.killSwitchTriggered) {
    appendBotLog(null, 'Risk Engine', 'INFO', 'Daily drawdown kill-switch manually re-armed.');
  }
  return saved;
}

function mapBotRow(r: Record<string, unknown>): PaperStrategyBot {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    exchange: r.exchange as ExchangeId,
    marketType: r.market_type as MarketType,
    timeframe: r.timeframe as Timeframe,
    enabled: Boolean(r.enabled),
    directionMode: r.direction_mode as PaperBotDirectionMode,
    minScore: Number(r.min_score),
    minAgreementPct: Number(r.min_agreement_pct),
    riskPerTradePct: Number(r.risk_per_trade_pct),
    leverage: Number(r.leverage),
    trailingStopAtrMult: r.trailing_stop_atr_mult !== null && r.trailing_stop_atr_mult !== undefined ? Number(r.trailing_stop_atr_mult) : null,
    partialTp1Pct: Number(r.partial_tp1_pct),
    cooldownMinutes: Number(r.cooldown_minutes),
    lastRunAt: r.last_run_at ? Number(r.last_run_at) : null,
    lastActionNote: r.last_action_note ? String(r.last_action_note) : null,
    createdAt: Number(r.created_at),
  };
}

export function listPaperBots(): PaperStrategyBot[] {
  ensurePaperSchema();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM paper_bots ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(mapBotRow);
}

export function createPaperBot(input: {
  name: string;
  description?: string;
  exchange: ExchangeId;
  marketType?: MarketType;
  timeframe: Timeframe;
  enabled?: boolean;
  directionMode?: PaperBotDirectionMode;
  minScore?: number;
  minAgreementPct?: number;
  riskPerTradePct?: number;
  leverage?: number;
  trailingStopAtrMult?: number | null;
  partialTp1Pct?: number;
  cooldownMinutes?: number;
}): PaperStrategyBot {
  ensurePaperSchema();
  const db = getDb();
  const bot: PaperStrategyBot = {
    id: `bot-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    description: (input.description ?? '').trim() || `Autonomous ${input.exchange.toUpperCase()} ${input.timeframe} signal bot`,
    exchange: input.exchange,
    marketType: input.marketType ?? defaultMarketTypeFor(input.exchange),
    timeframe: input.timeframe,
    enabled: input.enabled ?? true,
    directionMode: input.directionMode ?? 'BOTH',
    minScore: Math.max(20, Math.min(90, input.minScore ?? 35)),
    minAgreementPct: Math.max(40, Math.min(95, input.minAgreementPct ?? 55)),
    riskPerTradePct: Math.max(0.25, Math.min(10, input.riskPerTradePct ?? 1.5)),
    leverage: Math.max(1, Math.min(10, input.leverage ?? 1)),
    trailingStopAtrMult:
      input.trailingStopAtrMult !== undefined ? input.trailingStopAtrMult : 1.5,
    partialTp1Pct: Math.max(0, Math.min(80, input.partialTp1Pct ?? 50)),
    cooldownMinutes: Math.max(5, Math.min(1440, input.cooldownMinutes ?? 45)),
    lastRunAt: null,
    lastActionNote: 'Deployed — awaiting next autonomous scan cycle',
    createdAt: Date.now(),
  };

  db.prepare(`
    INSERT INTO paper_bots (
      id, name, description, exchange, market_type, timeframe, enabled,
      direction_mode, min_score, min_agreement_pct, risk_per_trade_pct,
      leverage, trailing_stop_atr_mult, partial_tp1_pct, cooldown_minutes,
      last_run_at, last_action_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bot.id,
    bot.name,
    bot.description,
    bot.exchange,
    bot.marketType,
    bot.timeframe,
    bot.enabled ? 1 : 0,
    bot.directionMode,
    bot.minScore,
    bot.minAgreementPct,
    bot.riskPerTradePct,
    bot.leverage,
    bot.trailingStopAtrMult,
    bot.partialTp1Pct,
    bot.cooldownMinutes,
    bot.lastRunAt,
    bot.lastActionNote,
    bot.createdAt,
  );

  appendBotLog(bot.id, bot.name, 'INFO', `Bot deployed (${bot.exchange.toUpperCase()} · ${bot.timeframe}, minScore ≥ ${bot.minScore}, risk ${bot.riskPerTradePct}%).`);
  return bot;
}

export function updatePaperBot(id: string, patch: Partial<PaperStrategyBot>): PaperStrategyBot | null {
  ensurePaperSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM paper_bots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const cur = mapBotRow(row);
  const next: PaperStrategyBot = {
    ...cur,
    ...patch,
    id: cur.id,
    createdAt: cur.createdAt,
  };
  db.prepare(`
    UPDATE paper_bots SET
      name = ?, description = ?, exchange = ?, market_type = ?, timeframe = ?,
      enabled = ?, direction_mode = ?, min_score = ?, min_agreement_pct = ?,
      risk_per_trade_pct = ?, leverage = ?, trailing_stop_atr_mult = ?,
      partial_tp1_pct = ?, cooldown_minutes = ?, last_run_at = ?, last_action_note = ?
    WHERE id = ?
  `).run(
    next.name,
    next.description,
    next.exchange,
    next.marketType,
    next.timeframe,
    next.enabled ? 1 : 0,
    next.directionMode,
    next.minScore,
    next.minAgreementPct,
    next.riskPerTradePct,
    next.leverage,
    next.trailingStopAtrMult,
    next.partialTp1Pct,
    next.cooldownMinutes,
    next.lastRunAt,
    next.lastActionNote,
    next.id,
  );
  if (cur.enabled !== next.enabled) {
    appendBotLog(next.id, next.name, 'INFO', next.enabled ? 'Autonomous execution resumed.' : 'Autonomous execution paused.');
  }
  return next;
}

export function deletePaperBot(id: string): void {
  ensurePaperSchema();
  const db = getDb();
  db.prepare('DELETE FROM paper_bots WHERE id = ?').run(id);
}

function mapPositionRow(r: Record<string, unknown>): PaperPosition {
  return {
    id: String(r.id),
    botId: r.bot_id ? String(r.bot_id) : null,
    botName: String(r.bot_name),
    canonicalId: String(r.canonical_id),
    exchange: r.exchange as ExchangeId,
    marketType: r.market_type as MarketType,
    displaySymbol: String(r.display_symbol),
    timeframe: r.timeframe as Timeframe,
    side: r.side as PaperSide,
    status: r.status as 'OPEN' | 'CLOSED',
    entryPrice: Number(r.entry_price),
    currentPrice: Number(r.current_price),
    quantity: Number(r.quantity),
    remainingQuantity: Number(r.remaining_quantity),
    notionalUsd: Number(r.notional_usd),
    marginUsd: Number(r.margin_usd),
    leverage: Number(r.leverage),
    stopLoss: r.stop_loss !== null && r.stop_loss !== undefined ? Number(r.stop_loss) : null,
    initialStopLoss: r.initial_stop_loss !== null && r.initial_stop_loss !== undefined ? Number(r.initial_stop_loss) : null,
    tp1: r.tp1 !== null && r.tp1 !== undefined ? Number(r.tp1) : null,
    tp2: r.tp2 !== null && r.tp2 !== undefined ? Number(r.tp2) : null,
    tp3: r.tp3 !== null && r.tp3 !== undefined ? Number(r.tp3) : null,
    tp1Hit: Boolean(r.tp1_hit),
    trailingAtr: r.trailing_atr !== null && r.trailing_atr !== undefined ? Number(r.trailing_atr) : null,
    feesPaidUsd: Number(r.fees_paid_usd),
    realizedPnlUsd: Number(r.realized_pnl_usd),
    unrealizedPnlUsd: Number(r.unrealized_pnl_usd),
    unrealizedPnlPct: Number(r.unrealized_pnl_pct),
    entryReason: String(r.entry_reason),
    exitReason: r.exit_reason ? String(r.exit_reason) : null,
    openedAt: Number(r.opened_at),
    closedAt: r.closed_at ? Number(r.closed_at) : null,
  };
}

function savePosition(p: PaperPosition): void {
  ensurePaperSchema();
  const db = getDb();
  db.prepare(`
    INSERT INTO paper_positions (
      id, bot_id, bot_name, canonical_id, exchange, market_type, display_symbol,
      timeframe, side, status, entry_price, current_price, quantity, remaining_quantity,
      notional_usd, margin_usd, leverage, stop_loss, initial_stop_loss,
      tp1, tp2, tp3, tp1_hit, trailing_atr, fees_paid_usd, realized_pnl_usd,
      unrealized_pnl_usd, unrealized_pnl_pct, entry_reason, exit_reason, opened_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      current_price = excluded.current_price,
      remaining_quantity = excluded.remaining_quantity,
      margin_usd = excluded.margin_usd,
      stop_loss = excluded.stop_loss,
      tp1_hit = excluded.tp1_hit,
      fees_paid_usd = excluded.fees_paid_usd,
      realized_pnl_usd = excluded.realized_pnl_usd,
      unrealized_pnl_usd = excluded.unrealized_pnl_usd,
      unrealized_pnl_pct = excluded.unrealized_pnl_pct,
      exit_reason = excluded.exit_reason,
      closed_at = excluded.closed_at
  `).run(
    p.id,
    p.botId,
    p.botName,
    p.canonicalId,
    p.exchange,
    p.marketType,
    p.displaySymbol,
    p.timeframe,
    p.side,
    p.status,
    p.entryPrice,
    p.currentPrice,
    p.quantity,
    p.remainingQuantity,
    p.notionalUsd,
    p.marginUsd,
    p.leverage,
    p.stopLoss,
    p.initialStopLoss,
    p.tp1,
    p.tp2,
    p.tp3,
    p.tp1Hit ? 1 : 0,
    p.trailingAtr,
    p.feesPaidUsd,
    p.realizedPnlUsd,
    p.unrealizedPnlUsd,
    p.unrealizedPnlPct,
    p.entryReason,
    p.exitReason,
    p.openedAt,
    p.closedAt,
  );
}

export function listPositions(status?: 'OPEN' | 'CLOSED', limit = 150): PaperPosition[] {
  ensurePaperSchema();
  const db = getDb();
  const rows = status
    ? (db
        .prepare('SELECT * FROM paper_positions WHERE status = ? ORDER BY opened_at DESC LIMIT ?')
        .all(status, limit) as Record<string, unknown>[])
    : (db
        .prepare('SELECT * FROM paper_positions ORDER BY opened_at DESC LIMIT ?')
        .all(limit) as Record<string, unknown>[]);
  return rows.map(mapPositionRow);
}

export function appendBotLog(
  botId: string | null,
  botName: string,
  level: 'INFO' | 'TRADE' | 'WARN',
  message: string,
): PaperBotLogRecord {
  ensurePaperSchema();
  const db = getDb();
  const rec: PaperBotLogRecord = {
    id: `plog-${crypto.randomUUID().slice(0, 8)}`,
    botId,
    botName,
    level,
    message,
    timestamp: Date.now(),
  };
  db.prepare(`
    INSERT INTO paper_bot_logs (id, bot_id, bot_name, level, message, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(rec.id, rec.botId, rec.botName, rec.level, rec.message, rec.timestamp);
  db.prepare(`
    DELETE FROM paper_bot_logs WHERE id NOT IN (
      SELECT id FROM paper_bot_logs ORDER BY timestamp DESC LIMIT 250
    )
  `).run();
  return rec;
}

function listBotLogs(limit = 60): PaperBotLogRecord[] {
  ensurePaperSchema();
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM paper_bot_logs ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    botId: r.bot_id ? String(r.bot_id) : null,
    botName: String(r.bot_name),
    level: r.level as 'INFO' | 'TRADE' | 'WARN',
    message: String(r.message),
    timestamp: Number(r.timestamp),
  }));
}

function listEquityCurve(limit = 200): PaperEquityPoint[] {
  ensurePaperSchema();
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM paper_equity_snapshots ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows
    .reverse()
    .map((r) => ({
      id: Number(r.id),
      timestamp: Number(r.timestamp),
      equityUsd: Number(r.equity_usd),
      cashUsd: Number(r.cash_usd),
      unrealizedPnlUsd: Number(r.unrealized_pnl_usd),
      realizedPnlUsd: Number(r.realized_pnl_usd),
      openCount: Number(r.open_count),
    }));
}

function recordEquitySnapshot(force = false): void {
  ensurePaperSchema();
  const db = getDb();
  const acc = getPaperAccount();
  const open = listPositions('OPEN', 100);
  const closed = listPositions('CLOSED', 500);
  const marginUsed = open.reduce((s, p) => s + p.marginUsd, 0);
  const unrealized = open.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
  const realized = closed.reduce((s, p) => s + p.realizedPnlUsd, 0) + open.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const equity = acc.cashBalanceUsd + marginUsed + unrealized;

  const latest = db
    .prepare('SELECT timestamp, equity_usd FROM paper_equity_snapshots ORDER BY id DESC LIMIT 1')
    .get() as { timestamp: number; equity_usd: number } | undefined;

  const now = Date.now();
  if (!force && latest && now - latest.timestamp < 60_000 && Math.abs(latest.equity_usd - equity) < 0.05) {
    return;
  }

  db.prepare(`
    INSERT INTO paper_equity_snapshots (timestamp, equity_usd, cash_usd, unrealized_pnl_usd, realized_pnl_usd, open_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(now, Number(equity.toFixed(2)), Number(acc.cashBalanceUsd.toFixed(2)), Number(unrealized.toFixed(2)), Number(realized.toFixed(2)), open.length);
}

function applySlippage(price: number, side: PaperSide, isEntry: boolean, slippageBps: number): number {
  const slip = slippageBps / 10_000;
  // Buying slips up, selling slips down
  const isBuy = (side === 'LONG' && isEntry) || (side === 'SHORT' && !isEntry);
  return isBuy ? price * (1 + slip) : price * (1 - slip);
}

function calcPnl(side: PaperSide, entryPrice: number, exitPrice: number, qty: number): number {
  return side === 'LONG' ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty;
}

async function resolveLivePrice(
  exchange: ExchangeId,
  marketType: MarketType,
  displaySymbol: string,
): Promise<number | null> {
  try {
    const tickers = await getMarketTickers(exchange, marketType);
    const symUpper = displaySymbol.toUpperCase();
    const found = tickers.find(
      (t) => t.displaySymbol.toUpperCase() === symUpper || t.canonicalId.toUpperCase() === `${exchange}:${marketType}:${symUpper}`.toUpperCase(),
    );
    if (found && found.lastPrice > 0) return found.lastPrice;
  } catch {
    // fallback to candles below
  }
  try {
    const { candles } = await fetchCandles(exchange, marketType, displaySymbol.toUpperCase(), '15m', 10);
    if (candles.length > 0) return candles[candles.length - 1].close;
  } catch {
    // ignore
  }
  return null;
}

export async function openPaperOrder(input: {
  exchange: ExchangeId;
  marketType?: MarketType;
  symbol: string;
  timeframe?: Timeframe;
  side: PaperSide;
  riskPct?: number;
  notionalUsd?: number;
  leverage?: number;
  stopLoss?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  trailingAtr?: number | null;
  botId?: string | null;
  botName?: string;
  entryReason?: string;
}): Promise<PaperPosition> {
  ensurePaperSchema();
  const acc = getPaperAccount();
  if (acc.killSwitchTriggered) {
    throw new Error(`Daily drawdown kill-switch is active: ${acc.killSwitchReason ?? 'Re-arm in Risk Settings before opening new positions.'}`);
  }

  const openList = listPositions('OPEN', 100);
  if (openList.length >= acc.maxOpenPositions) {
    throw new Error(`Maximum open positions limit (${acc.maxOpenPositions}) reached.`);
  }

  const marketType = input.marketType ?? defaultMarketTypeFor(input.exchange);
  const symbol = input.symbol.trim().toUpperCase();
  const timeframe = input.timeframe ?? '1h';
  const canonicalId = `${input.exchange}:${marketType}:${symbol}`;

  const livePrice = await resolveLivePrice(input.exchange, marketType, symbol);
  if (!livePrice || !Number.isFinite(livePrice) || livePrice <= 0) {
    throw new Error(`Unable to fetch live market price for ${symbol} on ${input.exchange}.`);
  }

  const fillPrice = applySlippage(livePrice, input.side, true, acc.slippageBps);
  const leverage = Math.max(1, Math.min(10, input.leverage ?? acc.defaultLeverage));

  // If SL/TP weren't explicitly provided on a manual order, derive from live deterministic signal engine
  let stopLoss = input.stopLoss ?? null;
  let tp1 = input.tp1 ?? null;
  let tp2 = input.tp2 ?? null;
  let tp3 = input.tp3 ?? null;
  let trailingAtr = input.trailingAtr ?? null;

  if (stopLoss === null && tp1 === null) {
    try {
      const { candles, freshness } = await fetchCandles(input.exchange, marketType, symbol, timeframe, 180);
      const prefs = getStoredPreferences();
      const analysis = runFullAssetAnalysis(candles, {
        canonicalId,
        exchange: input.exchange,
        marketType,
        displaySymbol: symbol,
        timeframe,
        freshness,
        weights: prefs.weights,
        thresholds: prefs.thresholds,
      });
      const setup = analysis.confirmed.signalSetup;
      const atrInd = analysis.confirmed.indicators.find((i) => i.id === 'atr');
      const atrVal = Number(atrInd?.rawValues?.atr14 ?? 0);
      if (atrVal > 0) {
        trailingAtr = atrVal * 1.5;
      }
      if (setup && ((input.side === 'LONG' && setup.direction === 'BUY') || (input.side === 'SHORT' && setup.direction === 'SELL'))) {
        stopLoss = setup.stopLoss;
        tp1 = setup.takeProfits[0]?.price ?? null;
        tp2 = setup.takeProfits[1]?.price ?? null;
        tp3 = setup.takeProfits[2]?.price ?? null;
      } else if (atrVal > 0) {
        stopLoss = input.side === 'LONG' ? fillPrice - atrVal * 1.8 : fillPrice + atrVal * 1.8;
        tp1 = input.side === 'LONG' ? fillPrice + atrVal * 1.8 : fillPrice - atrVal * 1.8;
        tp2 = input.side === 'LONG' ? fillPrice + atrVal * 3.2 : fillPrice - atrVal * 3.2;
        tp3 = input.side === 'LONG' ? fillPrice + atrVal * 4.8 : fillPrice - atrVal * 4.8;
      }
    } catch {
      // allow order with default 2% SL / 4% TP fallback only if candles unavailable
      stopLoss = input.side === 'LONG' ? fillPrice * 0.98 : fillPrice * 1.02;
      tp1 = input.side === 'LONG' ? fillPrice * 1.02 : fillPrice * 0.98;
      tp2 = input.side === 'LONG' ? fillPrice * 1.04 : fillPrice * 0.96;
    }
  }

  // Validate stop loss side sanity
  if (stopLoss !== null) {
    if (input.side === 'LONG' && stopLoss >= fillPrice) stopLoss = fillPrice * 0.985;
    if (input.side === 'SHORT' && stopLoss <= fillPrice) stopLoss = fillPrice * 1.015;
  }

  // Compute current equity for risk-based position sizing
  const marginUsed = openList.reduce((s, p) => s + p.marginUsd, 0);
  const unrealized = openList.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
  const equity = acc.cashBalanceUsd + marginUsed + unrealized;

  const maxNotionalAllowed = acc.cashBalanceUsd * leverage * 0.92;
  if (maxNotionalAllowed < 25) {
    throw new Error('Insufficient available paper cash balance to open a new position.');
  }

  let notionalUsd: number;
  if (input.notionalUsd && input.notionalUsd > 0) {
    notionalUsd = Math.min(input.notionalUsd, maxNotionalAllowed);
  } else {
    const riskPct = Math.min(input.riskPct ?? acc.maxRiskPerTradePct, acc.maxRiskPerTradePct);
    const riskUsd = equity * (riskPct / 100);
    const stopDistPct =
      stopLoss !== null ? Math.max(0.004, Math.abs(fillPrice - stopLoss) / fillPrice) : 0.02;
    const riskBasedNotional = riskUsd / stopDistPct;
    // Cap per-position notional to 35% of leveraged equity or available margin
    const capNotional = Math.min(maxNotionalAllowed, equity * leverage * 0.35);
    notionalUsd = Math.max(50, Math.min(riskBasedNotional, capNotional));
  }

  const marginUsd = notionalUsd / leverage;
  const entryFee = notionalUsd * (acc.feeBps / 10_000);
  if (marginUsd + entryFee > acc.cashBalanceUsd) {
    throw new Error('Order margin + fees exceed available cash balance.');
  }

  const quantity = notionalUsd / fillPrice;
  const now = Date.now();
  const pos: PaperPosition = {
    id: `pos-${crypto.randomUUID().slice(0, 8)}`,
    botId: input.botId ?? null,
    botName: input.botName ?? 'Manual Terminal',
    canonicalId,
    exchange: input.exchange,
    marketType,
    displaySymbol: symbol,
    timeframe,
    side: input.side,
    status: 'OPEN',
    entryPrice: fillPrice,
    currentPrice: livePrice,
    quantity,
    remainingQuantity: quantity,
    notionalUsd,
    marginUsd,
    leverage,
    stopLoss,
    initialStopLoss: stopLoss,
    tp1,
    tp2,
    tp3,
    tp1Hit: false,
    trailingAtr,
    feesPaidUsd: entryFee,
    realizedPnlUsd: -entryFee,
    unrealizedPnlUsd: calcPnl(input.side, fillPrice, livePrice, quantity),
    unrealizedPnlPct: 0,
    entryReason: input.entryReason ?? `Live ${input.side} paper order at $${livePrice.toFixed(4)}`,
    exitReason: null,
    openedAt: now,
    closedAt: null,
  };
  pos.unrealizedPnlPct = pos.marginUsd > 0 ? (pos.unrealizedPnlUsd / pos.marginUsd) * 100 : 0;

  acc.cashBalanceUsd = Math.max(0, acc.cashBalanceUsd - marginUsd - entryFee);
  savePaperAccount(acc);
  savePosition(pos);
  recordEquitySnapshot(true);

  appendBotLog(
    pos.botId,
    pos.botName,
    'TRADE',
    `OPEN ${pos.side} ${pos.displaySymbol} @ $${pos.entryPrice.toFixed(pos.entryPrice >= 100 ? 2 : 4)} · Size $${pos.notionalUsd.toFixed(0)} (${pos.leverage}x) · SL ${pos.stopLoss ? '$' + pos.stopLoss.toFixed(pos.stopLoss >= 100 ? 2 : 4) : '—'}`,
  );

  wsHub.broadcast({ type: 'paper:update', action: 'OPEN', positionId: pos.id, timestamp: now });
  return pos;
}

export async function closePaperPosition(
  positionId: string,
  reason = 'MANUAL_CLOSE',
  overrideLivePrice?: number,
): Promise<PaperPosition> {
  ensurePaperSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM paper_positions WHERE id = ?').get(positionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Position not found');
  const pos = mapPositionRow(row);
  if (pos.status === 'CLOSED') return pos;

  const acc = getPaperAccount();
  const livePrice =
    overrideLivePrice && overrideLivePrice > 0
      ? overrideLivePrice
      : (await resolveLivePrice(pos.exchange, pos.marketType, pos.displaySymbol)) ?? pos.currentPrice;

  const exitPrice = applySlippage(livePrice, pos.side, false, acc.slippageBps);
  const closeNotional = exitPrice * pos.remainingQuantity;
  const exitFee = closeNotional * (acc.feeBps / 10_000);
  const closePnl = calcPnl(pos.side, pos.entryPrice, exitPrice, pos.remainingQuantity);
  const now = Date.now();

  const returnedCash = Math.max(0, pos.marginUsd + closePnl - exitFee);
  acc.cashBalanceUsd += returnedCash;

  pos.status = 'CLOSED';
  pos.currentPrice = exitPrice;
  pos.remainingQuantity = 0;
  pos.marginUsd = 0;
  pos.feesPaidUsd += exitFee;
  pos.realizedPnlUsd += closePnl - exitFee;
  pos.unrealizedPnlUsd = 0;
  pos.unrealizedPnlPct = 0;
  pos.exitReason = reason;
  pos.closedAt = now;

  savePaperAccount(acc);
  savePosition(pos);
  lastSymbolCloseAt.set(pos.canonicalId, now);
  recordEquitySnapshot(true);

  const pnlSign = pos.realizedPnlUsd >= 0 ? '+' : '';
  appendBotLog(
    pos.botId,
    pos.botName,
    'TRADE',
    `CLOSE ${pos.side} ${pos.displaySymbol} @ $${exitPrice.toFixed(exitPrice >= 100 ? 2 : 4)} [${reason}] · Net PnL ${pnlSign}$${pos.realizedPnlUsd.toFixed(2)}`,
  );

  wsHub.broadcast({ type: 'paper:update', action: 'CLOSE', positionId: pos.id, timestamp: now });
  return pos;
}

export async function emergencyStopAndFlatten(): Promise<{ closedCount: number; pausedBots: number }> {
  ensurePaperSchema();
  const bots = listPaperBots();
  let pausedBots = 0;
  for (const bot of bots) {
    if (bot.enabled) {
      updatePaperBot(bot.id, { enabled: false, lastActionNote: 'Paused by Emergency Stop' });
      pausedBots++;
    }
  }
  const open = listPositions('OPEN', 100);
  let closedCount = 0;
  for (const pos of open) {
    await closePaperPosition(pos.id, 'EMERGENCY_FLATTEN');
    closedCount++;
  }
  const acc = getPaperAccount();
  savePaperAccount({
    ...acc,
    killSwitchTriggered: true,
    killSwitchReason: 'Emergency Stop & Flatten triggered by user',
  });
  appendBotLog(null, 'Risk Engine', 'WARN', `EMERGENCY STOP: Flattened ${closedCount} open position(s) and paused ${pausedBots} bot(s).`);
  return { closedCount, pausedBots };
}

export function resetPaperAccount(startingBalanceUsd = 10000): PaperAccountConfig {
  ensurePaperSchema();
  const db = getDb();
  const balance = Math.max(100, Math.min(10_000_000, Number(startingBalanceUsd) || 10000));
  const now = Date.now();
  const day = todayUtc();
  db.exec(`
    DELETE FROM paper_positions;
    DELETE FROM paper_equity_snapshots;
    DELETE FROM paper_bot_logs;
  `);
  const cur = getPaperAccount();
  const next: PaperAccountConfig = {
    ...cur,
    startingBalanceUsd: balance,
    cashBalanceUsd: balance,
    killSwitchTriggered: false,
    killSwitchReason: null,
    dailyStartEquityUsd: balance,
    dailyResetDay: day,
    updatedAt: now,
  };
  savePaperAccount(next);
  db.prepare(`
    INSERT INTO paper_equity_snapshots (timestamp, equity_usd, cash_usd, unrealized_pnl_usd, realized_pnl_usd, open_count)
    VALUES (?, ?, ?, 0, 0, 0)
  `).run(now, balance, balance);
  appendBotLog(null, 'Account', 'INFO', `Paper account reset cleanly to $${balance.toLocaleString('en-US')}.`);
  return next;
}

/**
 * Core autonomous engine cycle:
 * 1) Mark-to-market all open positions using live public market feeds
 * 2) Enforce trailing stops, TP1 partial scaling + breakeven move, SL / TP exits
 * 3) Enforce daily drawdown kill-switch
 * 4) Evaluate enabled autonomous bots against live deterministic 10-indicator scans
 */
export async function runAutonomousPaperCycle(runBots = true): Promise<{
  markedCount: number;
  actionsTaken: number;
  timestamp: number;
}> {
  ensurePaperSchema();
  if (cycleRunning) {
    return { markedCount: 0, actionsTaken: 0, timestamp: Date.now() };
  }
  cycleRunning = true;
  let markedCount = 0;
  let actionsTaken = 0;

  try {
    const now = Date.now();
    let acc = getPaperAccount();
    const openPositions = listPositions('OPEN', 100);
    const botsById = new Map(listPaperBots().map((b) => [b.id, b]));

    // 1. Fetch live ticker prices grouped by exchange+marketType for all open positions
    const venueSet = new Map<string, { exchange: ExchangeId; marketType: MarketType }>();
    for (const p of openPositions) {
      venueSet.set(`${p.exchange}:${p.marketType}`, { exchange: p.exchange, marketType: p.marketType });
    }
    const priceByCanonical = new Map<string, number>();
    await Promise.allSettled(
      Array.from(venueSet.values()).map(async ({ exchange, marketType }) => {
        const tickers = await getMarketTickers(exchange, marketType);
        for (const t of tickers) {
          if (t.lastPrice > 0) priceByCanonical.set(t.canonicalId.toUpperCase(), t.lastPrice);
        }
      }),
    );

    // 2. Mark-to-market & evaluate SL / Trailing / Partial TP1 / Full TP2-TP3
    for (const pos of openPositions) {
      const livePrice = priceByCanonical.get(pos.canonicalId.toUpperCase());
      if (!livePrice || livePrice <= 0) continue;
      markedCount++;

      pos.currentPrice = livePrice;
      const bot = pos.botId ? botsById.get(pos.botId) : null;

      // Trailing ATR stop ratchet (only tightens in favor)
      if (pos.trailingAtr && pos.trailingAtr > 0 && pos.stopLoss !== null) {
        if (pos.side === 'LONG') {
          const candidate = livePrice - pos.trailingAtr;
          if (candidate > pos.stopLoss) {
            pos.stopLoss = candidate;
          }
        } else {
          const candidate = livePrice + pos.trailingAtr;
          if (candidate < pos.stopLoss) {
            pos.stopLoss = candidate;
          }
        }
      }

      // Check Stop Loss breach first (conservative risk execution)
      const slHit =
        pos.stopLoss !== null &&
        ((pos.side === 'LONG' && livePrice <= pos.stopLoss) ||
          (pos.side === 'SHORT' && livePrice >= pos.stopLoss));

      if (slHit) {
        const isTrailing =
          pos.initialStopLoss !== null &&
          pos.stopLoss !== null &&
          ((pos.side === 'LONG' && pos.stopLoss > pos.initialStopLoss) ||
            (pos.side === 'SHORT' && pos.stopLoss < pos.initialStopLoss));
        await closePaperPosition(pos.id, pos.tp1Hit ? 'BREAKEVEN_STOP' : isTrailing ? 'TRAILING_STOP' : 'STOP_LOSS', livePrice);
        actionsTaken++;
        continue;
      }

      // Check Partial TP1 Scaling + Auto Breakeven
      const partialPct = bot ? bot.partialTp1Pct : 50;
      const tp1Reached =
        !pos.tp1Hit &&
        pos.tp1 !== null &&
        partialPct > 0 &&
        ((pos.side === 'LONG' && livePrice >= pos.tp1) || (pos.side === 'SHORT' && livePrice <= pos.tp1));

      if (tp1Reached) {
        const scaleFrac = Math.min(0.8, Math.max(0.1, partialPct / 100));
        const scaleQty = pos.remainingQuantity * scaleFrac;
        const exitPrice = applySlippage(livePrice, pos.side, false, acc.slippageBps);
        const partialFee = exitPrice * scaleQty * (acc.feeBps / 10_000);
        const partialPnl = calcPnl(pos.side, pos.entryPrice, exitPrice, scaleQty);
        const marginReleased = pos.marginUsd * scaleFrac;

        acc = getPaperAccount();
        acc.cashBalanceUsd += Math.max(0, marginReleased + partialPnl - partialFee);
        savePaperAccount(acc);

        pos.remainingQuantity -= scaleQty;
        pos.marginUsd -= marginReleased;
        pos.feesPaidUsd += partialFee;
        pos.realizedPnlUsd += partialPnl - partialFee;
        pos.tp1Hit = true;
        // Move stop loss to break-even
        pos.stopLoss = pos.entryPrice;
        actionsTaken++;

        appendBotLog(
          pos.botId,
          pos.botName,
          'TRADE',
          `TP1 SCALE (${Math.round(scaleFrac * 100)}%) ${pos.displaySymbol} @ $${exitPrice.toFixed(exitPrice >= 100 ? 2 : 4)} · +$${(partialPnl - partialFee).toFixed(2)} · SL moved to Breakeven`,
        );
      }

      // Check Final TP2 / TP3 full exit
      const finalTarget = pos.tp2 ?? pos.tp3 ?? (!pos.tp1Hit ? pos.tp1 : null);
      const finalHit =
        finalTarget !== null &&
        ((pos.side === 'LONG' && livePrice >= finalTarget) ||
          (pos.side === 'SHORT' && livePrice <= finalTarget));

      if (finalHit) {
        await closePaperPosition(pos.id, pos.tp2 ? 'TAKE_PROFIT_2' : 'TAKE_PROFIT', livePrice);
        actionsTaken++;
        continue;
      }

      pos.unrealizedPnlUsd = calcPnl(pos.side, pos.entryPrice, livePrice, pos.remainingQuantity);
      pos.unrealizedPnlPct = pos.marginUsd > 0 ? (pos.unrealizedPnlUsd / pos.marginUsd) * 100 : 0;
      savePosition(pos);
    }

    // 3. Daily Drawdown Reset & Kill-Switch Enforcement
    acc = getPaperAccount();
    const stillOpen = listPositions('OPEN', 100);
    const totalEquity =
      acc.cashBalanceUsd +
      stillOpen.reduce((s, p) => s + p.marginUsd + p.unrealizedPnlUsd, 0);

    const day = todayUtc();
    if (acc.dailyResetDay !== day) {
      acc.dailyResetDay = day;
      acc.dailyStartEquityUsd = totalEquity;
      savePaperAccount(acc);
    }

    const dailyDdPct =
      acc.dailyStartEquityUsd > 0
        ? Math.max(0, ((acc.dailyStartEquityUsd - totalEquity) / acc.dailyStartEquityUsd) * 100)
        : 0;

    if (!acc.killSwitchTriggered && dailyDdPct >= acc.maxDailyDrawdownPct) {
      acc.killSwitchTriggered = true;
      acc.killSwitchReason = `Daily drawdown reached ${dailyDdPct.toFixed(2)}% (limit ${acc.maxDailyDrawdownPct}%).`;
      savePaperAccount(acc);
      appendBotLog(null, 'Risk Engine', 'WARN', `KILL-SWITCH TRIGGERED: ${acc.killSwitchReason}`);
    }

    // 4. Autonomous Bot Signal Evaluation
    if (runBots && !acc.killSwitchTriggered) {
      const enabledBots = listPaperBots().filter((b) => b.enabled);
      for (const bot of enabledBots) {
        try {
          const currentOpen = listPositions('OPEN', 100);
          if (currentOpen.length >= acc.maxOpenPositions) {
            updatePaperBot(bot.id, {
              lastRunAt: now,
              lastActionNote: `Skipped — max open positions (${acc.maxOpenPositions}) reached`,
            });
            continue;
          }

          const scan = await runScreenerScan(bot.exchange, bot.marketType, bot.timeframe, false);
          const openIds = new Set(currentOpen.map((p) => p.canonicalId.toUpperCase()));

          const eligible = scan.rows
            .filter((row) => {
              if (openIds.has(row.canonicalId.toUpperCase())) return false;
              const lastClosed = lastSymbolCloseAt.get(row.canonicalId);
              if (lastClosed && now - lastClosed < bot.cooldownMinutes * 60_000) return false;
              if (row.agreementPct < bot.minAgreementPct) return false;
              const absScore = Math.abs(row.directionalScore);
              if (absScore < bot.minScore) return false;
              const setup = row.signalSetup;
              if (!setup || setup.direction === 'WAIT' || setup.stopLoss === null) return false;
              if (bot.directionMode === 'LONG_ONLY' && setup.direction !== 'BUY') return false;
              if (bot.directionMode === 'SHORT_ONLY' && setup.direction !== 'SELL') return false;
              return true;
            })
            .sort((a, b) => Math.abs(b.directionalScore) - Math.abs(a.directionalScore));

          if (eligible.length === 0) {
            updatePaperBot(bot.id, {
              lastRunAt: now,
              lastActionNote: `Scanned ${scan.rows.length} ${bot.exchange} assets · 0 qualifying setups (score ≥ ${bot.minScore}, agree ≥ ${bot.minAgreementPct}%)`,
            });
            continue;
          }

          // Enter highest-conviction candidate per cycle per bot
          const best = eligible[0];
          const setup = best.signalSetup!;
          const side: PaperSide = setup.direction === 'BUY' ? 'LONG' : 'SHORT';
          const atrAbs = best.atrPct && best.lastPrice > 0 ? (best.atrPct / 100) * best.lastPrice : null;
          const trailingAtr =
            bot.trailingStopAtrMult && atrAbs ? atrAbs * bot.trailingStopAtrMult : null;

          const opened = await openPaperOrder({
            exchange: best.exchange,
            marketType: best.marketType,
            symbol: best.displaySymbol,
            timeframe: bot.timeframe,
            side,
            riskPct: bot.riskPerTradePct,
            leverage: bot.leverage,
            stopLoss: setup.stopLoss,
            tp1: setup.takeProfits[0]?.price ?? null,
            tp2: setup.takeProfits[1]?.price ?? null,
            tp3: setup.takeProfits[2]?.price ?? null,
            trailingAtr,
            botId: bot.id,
            botName: bot.name,
            entryReason: `Score ${best.directionalScore > 0 ? '+' : ''}${best.directionalScore} · Agree ${best.agreementPct}% · ${best.regime}`,
          });

          actionsTaken++;
          updatePaperBot(bot.id, {
            lastRunAt: now,
            lastActionNote: `Entered ${opened.side} ${opened.displaySymbol} @ $${opened.entryPrice.toFixed(opened.entryPrice >= 100 ? 2 : 4)} (Score ${best.directionalScore > 0 ? '+' : ''}${best.directionalScore})`,
          });
        } catch (err) {
          updatePaperBot(bot.id, {
            lastRunAt: now,
            lastActionNote: `Scan skipped: ${err instanceof Error ? err.message : 'provider unavailable'}`,
          });
        }
      }
    }

    recordEquitySnapshot(actionsTaken > 0);
    lastCycleAt = now;
    return { markedCount, actionsTaken, timestamp: now };
  } finally {
    cycleRunning = false;
  }
}

export async function buildPaperArenaSnapshot(refreshPrices = true): Promise<PaperArenaSnapshot> {
  ensurePaperSchema();
  if (refreshPrices) {
    // Fast mark-to-market only (don't block GET /state with full screener scans)
    await runAutonomousPaperCycle(false).catch(() => {});
  }

  const account = getPaperAccount();
  const bots = listPaperBots();
  const openPositions = listPositions('OPEN', 100);
  const closedTrades = listPositions('CLOSED', 150);
  const equityCurve = listEquityCurve(200);
  const recentLogs = listBotLogs(60);

  const marginUsedUsd = openPositions.reduce((s, p) => s + p.marginUsd, 0);
  const unrealizedPnlUsd = openPositions.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
  const realizedPnlUsd =
    closedTrades.reduce((s, p) => s + p.realizedPnlUsd, 0) +
    openPositions.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const totalEquityUsd = account.cashBalanceUsd + marginUsedUsd + unrealizedPnlUsd;
  const totalPnlUsd = totalEquityUsd - account.startingBalanceUsd;
  const totalPnlPct =
    account.startingBalanceUsd > 0 ? (totalPnlUsd / account.startingBalanceUsd) * 100 : 0;

  const dailyDrawdownPct =
    account.dailyStartEquityUsd > 0
      ? Math.max(0, ((account.dailyStartEquityUsd - totalEquityUsd) / account.dailyStartEquityUsd) * 100)
      : 0;

  // Peak-to-trough max drawdown from real equity curve
  let peak = account.startingBalanceUsd;
  let maxDrawdownPct = 0;
  for (const pt of equityCurve) {
    if (pt.equityUsd > peak) peak = pt.equityUsd;
    if (peak > 0) {
      const dd = ((peak - pt.equityUsd) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  const wins = closedTrades.filter((t) => t.realizedPnlUsd > 0);
  const losses = closedTrades.filter((t) => t.realizedPnlUsd < 0);
  const winRatePct = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const grossWins = wins.reduce((s, t) => s + t.realizedPnlUsd, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.realizedPnlUsd, 0));
  const profitFactor =
    grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 99 : null;

  const rValues = closedTrades
    .map((t) => {
      if (!t.initialStopLoss || t.quantity <= 0) return null;
      const riskPerUnit = Math.abs(t.entryPrice - t.initialStopLoss);
      const initialRiskUsd = riskPerUnit * t.quantity;
      if (initialRiskUsd <= 0.01) return null;
      return t.realizedPnlUsd / initialRiskUsd;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const avgRMultiple =
    rValues.length > 0
      ? Number((rValues.reduce((s, r) => s + r, 0) / rValues.length).toFixed(2))
      : null;

  const totalFeesUsd =
    openPositions.reduce((s, p) => s + p.feesPaidUsd, 0) +
    closedTrades.reduce((s, p) => s + p.feesPaidUsd, 0);

  // Per-Bot Strategy Leaderboard
  const botLeaderboard: PaperBotLeaderboardRow[] = bots
    .map((b) => {
      const bOpen = openPositions.filter((p) => p.botId === b.id);
      const bClosed = closedTrades.filter((p) => p.botId === b.id);
      const bWins = bClosed.filter((p) => p.realizedPnlUsd > 0).length;
      const bRealized =
        bClosed.reduce((s, p) => s + p.realizedPnlUsd, 0) +
        bOpen.reduce((s, p) => s + p.realizedPnlUsd, 0);
      const bUnrealized = bOpen.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
      return {
        botId: b.id,
        botName: b.name,
        exchange: b.exchange,
        marketType: b.marketType,
        timeframe: b.timeframe,
        enabled: b.enabled,
        openCount: bOpen.length,
        closedCount: bClosed.length,
        wins: bWins,
        winRatePct: bClosed.length > 0 ? (bWins / bClosed.length) * 100 : 0,
        realizedPnlUsd: bRealized,
        unrealizedPnlUsd: bUnrealized,
        totalPnlUsd: bRealized + bUnrealized,
      };
    })
    .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);

  return {
    account,
    metrics: {
      totalEquityUsd,
      marginUsedUsd,
      unrealizedPnlUsd,
      realizedPnlUsd,
      totalPnlUsd,
      totalPnlPct,
      dailyDrawdownPct,
      maxDrawdownPct,
      winRatePct,
      profitFactor,
      avgRMultiple,
      openPositionsCount: openPositions.length,
      closedTradesCount: closedTrades.length,
      totalFeesUsd,
      activeBotsCount: bots.filter((b) => b.enabled).length,
    },
    bots,
    openPositions,
    closedTrades,
    equityCurve,
    botLeaderboard,
    recentLogs,
    lastCycleAt,
    timestamp: Date.now(),
  };
}

export function startAutonomousPaperLoop(): void {
  if (engineLoopTimer) return;
  ensurePaperSchema();
  // Run autonomous paper cycle every 35 seconds when bots or open positions exist
  engineLoopTimer = setInterval(() => {
    const bots = listPaperBots();
    const open = listPositions('OPEN', 10);
    if (bots.some((b) => b.enabled) || open.length > 0) {
      runAutonomousPaperCycle(true).catch(() => {});
    }
  }, 35_000);
}

