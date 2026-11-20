import { create } from 'zustand';
import { DEFAULT_PREFERENCES, DEFAULT_WATCHLIST_MARKETS, EXCHANGE_MARKET_TYPES, EXCHANGE_TIMEFRAMES } from '../shared/constants';
import type {
  AlertEventRecord,
  Candle,
  DataFreshness,
  ExchangeId,
  MarketType,
  NavSection,
  Timeframe,
  UserPreferences,
} from '../shared/types';
import { api } from '../services/api';

export interface LiveTickerPatch {
  canonicalId: string;
  lastPrice: number;
  prevPrice: number;
  change24hPct?: number;
  high24h?: number;
  low24h?: number;
  quoteVolume24h?: number;
  timestamp: number;
}

interface AppState {
  activeSection: NavSection;
  exchange: ExchangeId;
  marketType: MarketType;
  symbol: string; // e.g. BTC/USDT
  timeframe: Timeframe;
  preferences: UserPreferences;
  watchlist: string[];
  wsFreshness: DataFreshness;
  lastStreamTs: number | null;
  liveTickers: Record<string, LiveTickerPatch>;
  liveCandle: { canonicalId: string; timeframe: Timeframe; candle: Candle } | null;
  notifications: AlertEventRecord[];
  commandSearchOpen: boolean;
  mobileNavOpen: boolean;
  initialized: boolean;

  setActiveSection: (section: NavSection) => void;
  selectMarket: (exchange: ExchangeId, marketType: MarketType, symbol: string, openExplorer?: boolean) => void;
  setExchange: (exchange: ExchangeId) => void;
  setMarketType: (marketType: MarketType) => void;
  setTimeframe: (tf: Timeframe) => void;
  setCommandSearchOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  hydrateFromServer: () => Promise<void>;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  toggleWatchlist: (canonicalId: string) => Promise<void>;
  reorderWatchlist: (items: string[]) => Promise<void>;
  applyLiveTicker: (patch: Omit<LiveTickerPatch, 'prevPrice'>) => void;
  applyLiveCandle: (canonicalId: string, timeframe: Timeframe, candle: Candle) => void;
  setWsFreshness: (freshness: DataFreshness, ts?: number) => void;
  pushNotification: (ev: AlertEventRecord) => void;
  clearNotifications: () => void;
}

export function applyThemeToDom(theme: UserPreferences['theme']): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', isDark);
}

export const useAppStore = create<AppState>((set, get) => ({
  activeSection: 'overview',
  exchange: 'binance',
  marketType: 'spot',
  symbol: 'BTC/USDT',
  timeframe: '15m',
  preferences: { ...DEFAULT_PREFERENCES },
  watchlist: [...DEFAULT_WATCHLIST_MARKETS],
  wsFreshness: 'RECONNECTING',
  lastStreamTs: null,
  liveTickers: {},
  liveCandle: null,
  notifications: [],
  commandSearchOpen: false,
  mobileNavOpen: false,
  initialized: false,

  setActiveSection: (section) => set({ activeSection: section, mobileNavOpen: false }),

  selectMarket: (exchange, marketType, symbol, openExplorer = true) => {
    const supportedTypes = EXCHANGE_MARKET_TYPES[exchange];
    const safeType = supportedTypes.includes(marketType) ? marketType : supportedTypes[0];
    const supportedTfs = EXCHANGE_TIMEFRAMES[exchange];
    const curTf = get().timeframe;
    const safeTf = supportedTfs.includes(curTf) ? curTf : '1h';
    set({
      exchange,
      marketType: safeType,
      symbol: symbol.toUpperCase(),
      timeframe: safeTf,
      activeSection: openExplorer ? 'explorer' : get().activeSection,
      commandSearchOpen: false,
    });
  },

  setExchange: (exchange) => {
    const supportedTypes = EXCHANGE_MARKET_TYPES[exchange];
    const nextType = supportedTypes.includes(get().marketType) ? get().marketType : supportedTypes[0];
    const supportedTfs = EXCHANGE_TIMEFRAMES[exchange];
    const nextTf = supportedTfs.includes(get().timeframe) ? get().timeframe : '1h';
    // Adjust quote currency for USD-only exchanges (Kraken/Coinbase) cleanly
    const [base, quote] = get().symbol.split('/');
    let nextSym = get().symbol;
    if ((exchange === 'kraken' || exchange === 'coinbase') && quote === 'USDT') {
      nextSym = `${base}/USD`;
    } else if ((exchange === 'binance' || exchange === 'bybit') && quote === 'USD') {
      nextSym = `${base}/USDT`;
    }
    set({ exchange, marketType: nextType, timeframe: nextTf, symbol: nextSym });
  },

  setMarketType: (marketType) => {
    let exchange = get().exchange;
    if (marketType === 'perpetual' && !EXCHANGE_MARKET_TYPES[exchange].includes('perpetual')) {
      exchange = 'bybit';
    }
    const [base, quote] = get().symbol.split('/');
    const symbol = exchange === 'bybit' && quote === 'USD' ? `${base}/USDT` : get().symbol;
    set({ exchange, marketType, symbol });
  },

  setTimeframe: (timeframe) => set({ timeframe }),
  setCommandSearchOpen: (open) => set({ commandSearchOpen: open }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

  hydrateFromServer: async () => {
    try {
      const [settingsRes, wlRes, alertsRes] = await Promise.all([
        api.getSettings().catch(() => null),
        api.getWatchlist().catch(() => null),
        api.getAlerts().catch(() => null),
      ]);
      const prefs = settingsRes?.preferences ?? DEFAULT_PREFERENCES;
      applyThemeToDom(prefs.theme);
      set({
        preferences: prefs,
        exchange: prefs.defaultExchange || 'binance',
        marketType: prefs.defaultMarketType || 'spot',
        symbol: prefs.defaultPair || 'BTC/USDT',
        timeframe: prefs.defaultTimeframe || '15m',
        watchlist: wlRes?.items ?? DEFAULT_WATCHLIST_MARKETS,
        notifications: alertsRes?.events?.slice(0, 15) ?? [],
        initialized: true,
      });
    } catch {
      applyThemeToDom('dark');
      set({ initialized: true });
    }
  },

  updatePreferences: async (patch) => {
    const merged: UserPreferences = {
      ...get().preferences,
      ...patch,
      weights: { ...get().preferences.weights, ...(patch.weights ?? {}) },
      thresholds: { ...get().preferences.thresholds, ...(patch.thresholds ?? {}) },
    };
    applyThemeToDom(merged.theme);
    set({ preferences: merged });
    try {
      await api.saveSettings(merged);
    } catch {
      // keep optimistic update
    }
  },

  toggleWatchlist: async (canonicalId) => {
    const current = get().watchlist;
    const exists = current.includes(canonicalId);
    const next = exists ? current.filter((x) => x !== canonicalId) : [canonicalId, ...current];
    set({ watchlist: next });
    try {
      await api.saveWatchlist(next);
    } catch {
      // ignore
    }
  },

  reorderWatchlist: async (items) => {
    set({ watchlist: items });
    try {
      await api.saveWatchlist(items);
    } catch {
      // ignore
    }
  },

  applyLiveTicker: (patch) => {
    set((state) => {
      const prev = state.liveTickers[patch.canonicalId]?.lastPrice ?? patch.lastPrice;
      return {
        lastStreamTs: patch.timestamp,
        wsFreshness: 'LIVE',
        liveTickers: {
          ...state.liveTickers,
          [patch.canonicalId]: { ...patch, prevPrice: prev },
        },
      };
    });
  },

  applyLiveCandle: (canonicalId, timeframe, candle) => {
    set({ liveCandle: { canonicalId, timeframe, candle }, lastStreamTs: Date.now(), wsFreshness: 'LIVE' });
  },

  setWsFreshness: (wsFreshness, ts) =>
    set((s) => ({ wsFreshness, lastStreamTs: ts ?? s.lastStreamTs })),

  pushNotification: (ev) =>
    set((state) => ({
      notifications: [ev, ...state.notifications.filter((n) => n.id !== ev.id)].slice(0, 25),
    })),

  clearNotifications: () => set({ notifications: [] }),
}));
