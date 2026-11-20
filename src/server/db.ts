import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PREFERENCES, DEFAULT_WATCHLIST_MARKETS } from '../shared/constants';
import type {
  AIProviderProfile,
  AlertEventRecord,
  AlertRule,
  Candle,
  ScreenerPreset,
  SignalEventRecord,
  UserPreferences,
} from '../shared/types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'cryptolens.db');

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  dbInstance = db;
  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candles_cache (
      canonical_id TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      open_time INTEGER NOT NULL,
      close_time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      is_closed INTEGER NOT NULL,
      PRIMARY KEY (canonical_id, timeframe, open_time)
    );
    CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles_cache (canonical_id, timeframe, open_time);

    CREATE TABLE IF NOT EXISTS signal_snapshots (
      id TEXT PRIMARY KEY,
      canonical_id TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      candle_timestamp INTEGER NOT NULL,
      classification TEXT NOT NULL,
      directional_score REAL NOT NULL,
      agreement_pct REAL NOT NULL,
      regime TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (canonical_id, timeframe, candle_timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_signal_snap_lookup ON signal_snapshots (canonical_id, timeframe, candle_timestamp DESC);

    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      canonical_id TEXT NOT NULL,
      display_symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      event_type TEXT NOT NULL,
      classification TEXT NOT NULL,
      directional_score REAL NOT NULL,
      agreement_pct REAL NOT NULL,
      candle_timestamp INTEGER NOT NULL,
      triggered_at INTEGER NOT NULL,
      summary TEXT NOT NULL,
      indicator_changes_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signal_events_time ON signal_events (triggered_at DESC);

    CREATE TABLE IF NOT EXISTS watchlist_items (
      canonical_id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screener_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      canonical_id TEXT NOT NULL,
      display_symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      condition TEXT NOT NULL,
      threshold REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cooldown_minutes INTEGER NOT NULL DEFAULT 15,
      recurring INTEGER NOT NULL DEFAULT 1,
      webhook_url TEXT,
      last_triggered_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      canonical_id TEXT NOT NULL,
      display_symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      condition TEXT NOT NULL,
      message TEXT NOT NULL,
      triggered_value REAL,
      triggered_at INTEGER NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alert_events_time ON alert_events (triggered_at DESC);

    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT NOT NULL,
      temperature REAL NOT NULL,
      max_tokens INTEGER NOT NULL,
      timeout_ms INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      storage_mode TEXT NOT NULL DEFAULT 'session',
      updated_at INTEGER NOT NULL
    );
  `);

  // Seed default watchlist on first run if empty
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM watchlist_items').get() as { cnt: number };
  if (countRow.cnt === 0) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO watchlist_items (canonical_id, position, added_at) VALUES (?, ?, ?)',
    );
    const now = Date.now();
    DEFAULT_WATCHLIST_MARKETS.forEach((cid, idx) => {
      insert.run(cid, idx, now);
    });
  }

  // Backwards-compatible migration for structured signal setup levels (Entry/SL/TP1-3)
  const evCols = db.prepare('PRAGMA table_info(signal_events)').all() as { name: string }[];
  if (!evCols.some((c) => c.name === 'setup_json')) {
    db.exec('ALTER TABLE signal_events ADD COLUMN setup_json TEXT;');
  }

  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(
    Date.now(),
  );
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(
    Date.now(),
  );
}

// --- Preferences ---
export function getStoredPreferences(): UserPreferences {
  const db = getDb();
  const row = db
    .prepare('SELECT value_json FROM user_preferences WHERE key = ?')
    .get('main') as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_PREFERENCES };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<UserPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      weights: { ...DEFAULT_PREFERENCES.weights, ...(parsed.weights ?? {}) },
      thresholds: { ...DEFAULT_PREFERENCES.thresholds, ...(parsed.thresholds ?? {}) },
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveStoredPreferences(prefs: UserPreferences): UserPreferences {
  const db = getDb();
  db.prepare(
    `INSERT INTO user_preferences (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run('main', JSON.stringify(prefs), Date.now());
  return prefs;
}

// --- Watchlist ---
export function getWatchlist(): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT canonical_id FROM watchlist_items ORDER BY position ASC')
    .all() as { canonical_id: string }[];
  return rows.map((r) => r.canonical_id);
}

export function saveWatchlist(items: string[]): string[] {
  const db = getDb();
  const unique = Array.from(new Set(items));
  db.exec('DELETE FROM watchlist_items');
  const insert = db.prepare(
    'INSERT INTO watchlist_items (canonical_id, position, added_at) VALUES (?, ?, ?)',
  );
  const now = Date.now();
  unique.forEach((cid, idx) => insert.run(cid, idx, now));
  return unique;
}

// --- Candles Cache ---
export function upsertCachedCandles(canonicalId: string, timeframe: string, candles: Candle[]): void {
  if (candles.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO candles_cache (canonical_id, timeframe, open_time, close_time, open, high, low, close, volume, is_closed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_id, timeframe, open_time) DO UPDATE SET
      close_time = excluded.close_time,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      is_closed = excluded.is_closed
  `);
  for (const c of candles.slice(-300)) {
    stmt.run(
      canonicalId,
      timeframe,
      c.openTime,
      c.closeTime,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
      c.isClosed ? 1 : 0,
    );
  }
}

export function getCachedCandles(canonicalId: string, timeframe: string, limit = 300): Candle[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT open_time, close_time, open, high, low, close, volume, is_closed
       FROM candles_cache
       WHERE canonical_id = ? AND timeframe = ?
       ORDER BY open_time DESC LIMIT ?`,
    )
    .all(canonicalId, timeframe, limit) as {
    open_time: number;
    close_time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    is_closed: number;
  }[];
  return rows.reverse().map((r) => ({
    openTime: r.open_time,
    closeTime: r.close_time,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    isClosed: r.is_closed === 1,
  }));
}

export function clearCandlesCache(): void {
  const db = getDb();
  db.exec('DELETE FROM candles_cache');
}

// --- Signal Events ---
export function insertSignalEvents(events: SignalEventRecord[]): void {
  if (events.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO signal_events (
      id, canonical_id, display_symbol, exchange, market_type, timeframe,
      event_type, classification, directional_score, agreement_pct,
      candle_timestamp, triggered_at, summary, indicator_changes_json, setup_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      setup_json = COALESCE(excluded.setup_json, signal_events.setup_json)
  `);
  for (const e of events) {
    stmt.run(
      e.id,
      e.canonicalId,
      e.displaySymbol,
      e.exchange,
      e.marketType,
      e.timeframe,
      e.eventType,
      e.classification,
      e.directionalScore,
      e.agreementPct,
      e.candleTimestamp,
      e.triggeredAt,
      e.summary,
      JSON.stringify(e.indicatorChanges),
      e.signalSetup ? JSON.stringify(e.signalSetup) : null,
    );
  }
}

export function listSignalEvents(limit = 100): SignalEventRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM signal_events ORDER BY candle_timestamp DESC, triggered_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    canonicalId: String(r.canonical_id),
    displaySymbol: String(r.display_symbol),
    exchange: r.exchange as SignalEventRecord['exchange'],
    marketType: r.market_type as SignalEventRecord['marketType'],
    timeframe: r.timeframe as SignalEventRecord['timeframe'],
    eventType: String(r.event_type),
    classification: r.classification as SignalEventRecord['classification'],
    directionalScore: Number(r.directional_score),
    agreementPct: Number(r.agreement_pct),
    candleTimestamp: Number(r.candle_timestamp),
    triggeredAt: Number(r.triggered_at),
    summary: String(r.summary),
    indicatorChanges: JSON.parse(String(r.indicator_changes_json || '[]')) as string[],
    signalSetup: r.setup_json ? JSON.parse(String(r.setup_json)) : null,
  }));
}

// --- Custom Screener Presets ---
export function listCustomPresets(): ScreenerPreset[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM screener_presets ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    category: String(r.category),
    filters: JSON.parse(String(r.filters_json)),
    isBuiltIn: false,
  }));
}

export function saveCustomPreset(preset: Omit<ScreenerPreset, 'isBuiltIn'>): ScreenerPreset {
  const db = getDb();
  db.prepare(
    `INSERT INTO screener_presets (id, name, description, category, filters_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, filters_json=excluded.filters_json`,
  ).run(
    preset.id,
    preset.name,
    preset.description,
    preset.category,
    JSON.stringify(preset.filters),
    Date.now(),
  );
  return { ...preset, isBuiltIn: false };
}

export function deleteCustomPreset(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM screener_presets WHERE id = ?').run(id);
}

// --- Alerts ---
export function listAlertRules(): AlertRule[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM alert_rules ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    canonicalId: String(r.canonical_id),
    displaySymbol: String(r.display_symbol),
    exchange: r.exchange as AlertRule['exchange'],
    marketType: r.market_type as AlertRule['marketType'],
    timeframe: r.timeframe as AlertRule['timeframe'],
    condition: r.condition as AlertRule['condition'],
    threshold: r.threshold === null || r.threshold === undefined ? null : Number(r.threshold),
    enabled: Number(r.enabled) === 1,
    cooldownMinutes: Number(r.cooldown_minutes),
    recurring: Number(r.recurring) === 1,
    webhookUrl: r.webhook_url ? String(r.webhook_url) : null,
    lastTriggeredAt: r.last_triggered_at ? Number(r.last_triggered_at) : null,
    createdAt: Number(r.created_at),
  }));
}

export function upsertAlertRule(rule: AlertRule): AlertRule {
  const db = getDb();
  db.prepare(`
    INSERT INTO alert_rules (
      id, canonical_id, display_symbol, exchange, market_type, timeframe,
      condition, threshold, enabled, cooldown_minutes, recurring, webhook_url, last_triggered_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      threshold = excluded.threshold,
      cooldown_minutes = excluded.cooldown_minutes,
      recurring = excluded.recurring,
      webhook_url = excluded.webhook_url,
      last_triggered_at = excluded.last_triggered_at
  `).run(
    rule.id,
    rule.canonicalId,
    rule.displaySymbol,
    rule.exchange,
    rule.marketType,
    rule.timeframe,
    rule.condition,
    rule.threshold,
    rule.enabled ? 1 : 0,
    rule.cooldownMinutes,
    rule.recurring ? 1 : 0,
    rule.webhookUrl,
    rule.lastTriggeredAt,
    rule.createdAt,
  );
  return rule;
}

export function deleteAlertRule(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
}

export function insertAlertEvent(ev: AlertEventRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO alert_events (
      id, rule_id, canonical_id, display_symbol, timeframe, condition, message, triggered_value, triggered_at, acknowledged
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ev.id,
    ev.ruleId,
    ev.canonicalId,
    ev.displaySymbol,
    ev.timeframe,
    ev.condition,
    ev.message,
    ev.triggeredValue,
    ev.triggeredAt,
    ev.acknowledged ? 1 : 0,
  );
}

export function listAlertEvents(limit = 50): AlertEventRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM alert_events ORDER BY triggered_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    ruleId: String(r.rule_id),
    canonicalId: String(r.canonical_id),
    displaySymbol: String(r.display_symbol),
    timeframe: r.timeframe as AlertEventRecord['timeframe'],
    condition: r.condition as AlertEventRecord['condition'],
    message: String(r.message),
    triggeredValue: r.triggered_value === null ? null : Number(r.triggered_value),
    triggeredAt: Number(r.triggered_at),
    acknowledged: Number(r.acknowledged) === 1,
  }));
}

// --- AI Provider Profile Metadata (never stores raw API keys in SQLite) ---
export function listAIProfiles(): AIProviderProfile[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM ai_provider_profiles ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    providerType: r.provider_type as AIProviderProfile['providerType'],
    model: String(r.model),
    baseUrl: String(r.base_url),
    temperature: Number(r.temperature),
    maxTokens: Number(r.max_tokens),
    timeoutMs: Number(r.timeout_ms),
    enabled: Number(r.enabled) === 1,
    storageMode: (String(r.storage_mode) === 'encrypted_local' ? 'encrypted_local' : 'session'),
  }));
}

export function saveAIProfile(profile: AIProviderProfile): AIProviderProfile {
  const db = getDb();
  db.prepare(`
    INSERT INTO ai_provider_profiles (
      id, name, provider_type, model, base_url, temperature, max_tokens, timeout_ms, enabled, storage_mode, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider_type = excluded.provider_type,
      model = excluded.model,
      base_url = excluded.base_url,
      temperature = excluded.temperature,
      max_tokens = excluded.max_tokens,
      timeout_ms = excluded.timeout_ms,
      enabled = excluded.enabled,
      storage_mode = excluded.storage_mode,
      updated_at = excluded.updated_at
  `).run(
    profile.id,
    profile.name,
    profile.providerType,
    profile.model,
    profile.baseUrl,
    profile.temperature,
    profile.maxTokens,
    profile.timeoutMs,
    profile.enabled ? 1 : 0,
    profile.storageMode,
    Date.now(),
  );
  return profile;
}

export function deleteAIProfile(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM ai_provider_profiles WHERE id = ?').run(id);
}

export function getStorageStats(): { dbSizeBytes: number; cachedCandles: number; signalEvents: number; alertRules: number } {
  const db = getDb();
  const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  const c = (db.prepare('SELECT COUNT(*) as n FROM candles_cache').get() as { n: number }).n;
  const s = (db.prepare('SELECT COUNT(*) as n FROM signal_events').get() as { n: number }).n;
  const a = (db.prepare('SELECT COUNT(*) as n FROM alert_rules').get() as { n: number }).n;
  return { dbSizeBytes: size, cachedCandles: c, signalEvents: s, alertRules: a };
}
