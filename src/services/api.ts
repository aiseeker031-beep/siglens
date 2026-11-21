import type {
  AIProviderProfile,
  AlertEventRecord,
  AlertRule,
  Candle,
  DataFreshness,
  DefiOverview,
  DerivativesMarket,
  DualSignalResponse,
  ExchangeId,
  MarketOverviewPayload,
  MarketTicker,
  MarketType,
  MultiTimeframeSummary,
  OrderBookSnapshot,
  ProviderStatus,
  ScreenerPreset,
  ScreenerRow,
  SignalEventRecord,
  Timeframe,
  UserPreferences,
} from '../shared/types';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(
      res.ok
        ? 'Server returned a non-JSON response while warming up.'
        : `Request failed (${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`,
    );
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Invalid JSON payload from server (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      (data as { error?: string } | null)?.error || `Request failed (${res.status})`,
    );
  }
  return data as T;
}

export interface AssetSignalBundle extends DualSignalResponse {
  canonicalId: string;
  source: string;
  freshness: DataFreshness;
  candles: Candle[];
}

export const api = {
  getOverview: (exchange: ExchangeId, marketType: MarketType) =>
    apiJson<MarketOverviewPayload>(
      `/api/market-overview?exchange=${exchange}&marketType=${marketType}`,
    ),

  getMarkets: (exchange: ExchangeId | 'all', marketType: MarketType | 'all') =>
    apiJson<{ markets: MarketTicker[]; count: number; timestamp: number }>(
      `/api/markets?exchange=${exchange}&marketType=${marketType}`,
    ),

  searchMarkets: (q: string) =>
    apiJson<{ results: MarketTicker[] }>(`/api/markets/search?q=${encodeURIComponent(q)}`),

  getAssetSignals: (
    exchange: ExchangeId,
    marketType: MarketType,
    symbol: string,
    timeframe: Timeframe,
    limit = 260,
  ) =>
    apiJson<AssetSignalBundle>(
      `/api/signals/current?exchange=${exchange}&marketType=${marketType}&symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`,
    ),

  getMultiTimeframe: (exchange: ExchangeId, marketType: MarketType, symbol: string) =>
    apiJson<MultiTimeframeSummary>(
      `/api/signals/mtf?exchange=${exchange}&marketType=${marketType}&symbol=${encodeURIComponent(symbol)}`,
    ),

  getOrderBook: (exchange: ExchangeId, marketType: MarketType, symbol: string) =>
    apiJson<OrderBookSnapshot>(
      `/api/orderbook?exchange=${exchange}&marketType=${marketType}&symbol=${encodeURIComponent(symbol)}`,
    ),

  getSignalFeed: (limit = 120) =>
    apiJson<{ events: SignalEventRecord[]; count: number }>(`/api/signals/feed?limit=${limit}`),

  getScreener: (
    exchange: ExchangeId,
    marketType: MarketType,
    timeframe: Timeframe,
    refresh = false,
  ) =>
    apiJson<{
      rows: ScreenerRow[];
      totalScanned: number;
      universeSize: number;
      completedCount: number;
      inProgress: boolean;
      scannedAt: number;
      exchange: ExchangeId;
      marketType: MarketType;
      timeframe: Timeframe;
    }>(
      `/api/screener?exchange=${exchange}&marketType=${marketType}&timeframe=${timeframe}&refresh=${refresh}`,
    ),

  getScreenerPresets: () => apiJson<{ presets: ScreenerPreset[] }>('/api/screener/presets'),

  saveScreenerPreset: (payload: {
    name: string;
    description: string;
    category: string;
    filters: Record<string, unknown>;
  }) =>
    apiJson<{ preset: ScreenerPreset }>('/api/screener/presets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteScreenerPreset: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/screener/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getMarketBreadth: (exchange: ExchangeId, timeframe: Timeframe) =>
    apiJson<{
      analyzedAssets: number;
      bullishCount: number;
      bearishCount: number;
      neutralCount: number;
      bullishPct: number;
      bearishPct: number;
      neutralPct: number;
      aboveEma50Pct: number;
      aboveEma200Pct: number;
      positiveMomentumPct: number;
      breadthScore: number;
      universeNote: string;
      scannedAt: number;
      rows: ScreenerRow[];
    }>(`/api/market-breadth?exchange=${exchange}&timeframe=${timeframe}`),

  getCorrelation: (symbols: string[], exchange: ExchangeId, timeframe: Timeframe, lookback: number) =>
    apiJson<{
      symbols: string[];
      matrix: (number | null)[][];
      sampleCounts: number[][];
      exchange: ExchangeId;
      timeframe: Timeframe;
      lookback: number;
      updatedAt: number;
    }>(
      `/api/correlation?symbols=${encodeURIComponent(symbols.join(','))}&exchange=${exchange}&timeframe=${timeframe}&lookback=${lookback}`,
    ),

  compareAssets: (
    symbols: string[],
    exchange: ExchangeId,
    marketType: MarketType,
    timeframe: Timeframe,
  ) =>
    apiJson<{
      exchange: ExchangeId;
      marketType: MarketType;
      timeframe: Timeframe;
      normalized: { timestamps: number[]; series: Record<string, number[]> };
      correlation: { symbols: string[]; matrix: (number | null)[][]; sampleCounts: number[][] };
      assets: {
        symbol: string;
        canonicalId: string;
        close: number | null;
        periodReturnPct: number | null;
        confirmed: DualSignalResponse['confirmed'];
        supportResistance: DualSignalResponse['supportResistance'];
      }[];
      updatedAt: number;
    }>(
      `/api/compare?symbols=${encodeURIComponent(symbols.join(','))}&exchange=${exchange}&marketType=${marketType}&timeframe=${timeframe}`,
    ),

  getDerivatives: () =>
    apiJson<{ markets: DerivativesMarket[]; source: string; updatedAt: number }>('/api/derivatives'),

  getDerivativesDetail: (base: string) =>
    apiJson<{
      symbol: string;
      fundingHistory: { timestamp: number; fundingRatePct: number }[];
      openInterestHistory: { timestamp: number; openInterest: number }[];
      longShortHistory: { timestamp: number; buyRatio: number; sellRatio: number }[];
      source: string;
    }>(`/api/derivatives/${encodeURIComponent(base)}`),

  getDefi: () => apiJson<DefiOverview>('/api/defi'),

  getWatchlist: () => apiJson<{ items: string[] }>('/api/watchlists'),

  saveWatchlist: (items: string[]) =>
    apiJson<{ items: string[] }>('/api/watchlists', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  getAlerts: () => apiJson<{ rules: AlertRule[]; events: AlertEventRecord[] }>('/api/alerts'),

  createAlert: (payload: {
    canonicalId: string;
    timeframe: Timeframe;
    condition: string;
    threshold: number | null;
    cooldownMinutes: number;
    recurring: boolean;
    webhookUrl: string | null;
  }) =>
    apiJson<{ rule: AlertRule }>('/api/alerts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleAlert: (id: string, enabled: boolean) =>
    apiJson<{ rule: AlertRule }>(`/api/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  deleteAlert: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getSettings: () => apiJson<{ preferences: UserPreferences }>('/api/settings'),

  saveSettings: (preferences: Partial<UserPreferences>) =>
    apiJson<{ preferences: UserPreferences }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),

  getDiagnostics: () =>
    apiJson<{
      providers: ProviderStatus[];
      storage: { dbSizeBytes: number; cachedCandles: number; signalEvents: number; alertRules: number };
      uptimeSeconds: number;
      timestamp: number;
    }>('/api/diagnostics'),

  clearCache: () => apiJson<{ ok: boolean }>('/api/cache/clear', { method: 'POST' }),

  getAIProfiles: () => apiJson<{ profiles: AIProviderProfile[] }>('/api/ai/profiles'),

  saveAIProfile: (profile: Partial<AIProviderProfile>) =>
    apiJson<{ profile: AIProviderProfile }>('/api/ai/profiles', {
      method: 'POST',
      body: JSON.stringify(profile),
    }),

  deleteAIProfile: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/ai/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  testAIConnection: (payload: {
    providerType: AIProviderProfile['providerType'];
    model: string;
    baseUrl: string;
    apiKey?: string;
    timeoutMs: number;
  }) =>
    apiJson<{ ok: boolean; modelUsed: string; sample: string }>('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  analyzeWithAI: (payload: {
    prompt: string;
    mode: 'explain' | 'nl_screen';
    canonicalId: string;
    timeframe: Timeframe;
    provider: {
      providerType: AIProviderProfile['providerType'];
      model: string;
      baseUrl: string;
      apiKey?: string;
      temperature: number;
      maxTokens: number;
      timeoutMs: number;
    };
  }) =>
    apiJson<{
      response: string;
      modelUsed: string;
      contextUsed: Record<string, unknown>;
      screenerResults: {
        interpretedRules: string[];
        matchedCount: number;
        scannedUniverse: number;
        matches: ScreenerRow[];
      } | null;
      timestamp: number;
    }>('/api/ai/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
