import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import {
  Activity,
  ChevronDown,
  Coins,
  Edit3,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { EChartBox } from '../components/charts/EChartBox';
import { api, type AssetSignalBundle } from '../services/api';
import { EXCHANGE_LABELS, EXCHANGE_TIMEFRAMES } from '../shared/constants';
import { formatCompactUsd, formatPercent, formatPrice, formatTimestamp } from '../shared/format';
import type {
  ExchangeId,
  MarketTicker,
  MarketType,
  PaperArenaSnapshot,
  PaperPosition,
  PaperSide,
  Timeframe,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type MarginMode = 'Cross' | 'Isolated';
type OrderMode = 'Market' | 'Limit';
type SizeUnit = 'USDT' | 'BASE';
type BottomTab = 'positions' | 'orders' | 'history' | 'assets';
type MarketFilterCat = 'all' | 'crypto_spot' | 'perpetual' | 'stocks' | 'cfds';

interface PendingLimitOrder {
  id: string;
  canonicalId: string;
  exchange: ExchangeId;
  marketType: MarketType;
  symbol: string;
  side: PaperSide;
  limitPrice: number;
  notionalUsd: number;
  leverage: number;
  marginMode: MarginMode;
  stopLoss: number | null;
  tp1: number | null;
  createdAt: number;
}

const LIMIT_ORDERS_KEY = 'siglens_demo_limit_orders_v1';
const LEVERAGE_PRESETS = [1, 2, 5, 10, 20, 25, 50];
const CHART_TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1d' },
  { value: '1w', label: '1w' },
];

function coinAccent(base: string): { bg: string; glyph: string } {
  const b = base.toUpperCase();
  if (b === 'BTC') return { bg: 'bg-[#F7931A] text-white', glyph: '₿' };
  if (b === 'ETH') return { bg: 'bg-[#627EEA] text-white', glyph: 'Ξ' };
  if (b === 'SOL') return { bg: 'bg-[#14F195] text-[#0B0E11]', glyph: 'S' };
  if (b === 'BNB') return { bg: 'bg-[#F3BA2F] text-[#0B0E11]', glyph: 'B' };
  if (b === 'XRP') return { bg: 'bg-[#3B82F6] text-white', glyph: '✕' };
  if (b === 'DOGE') return { bg: 'bg-[#C2A633] text-[#0B0E11]', glyph: 'Ð' };
  if (b === 'AVAX') return { bg: 'bg-[#E84142] text-white', glyph: 'A' };
  if (b === 'XAU' || b === 'XAG') return { bg: 'bg-[#EAB308] text-[#0B0E11]', glyph: b.slice(0, 2) };
  return { bg: 'bg-[#0ECB81] text-[#0B0E11]', glyph: b.slice(0, 2) || '•' };
}

function calcLiquidationPrice(side: PaperSide, entryPrice: number, leverage: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  const lev = Math.max(1, leverage);
  if (lev <= 1) return side === 'LONG' ? 0 : entryPrice * 2;
  const maintBuffer = 0.9 / lev;
  return side === 'LONG'
    ? Math.max(0, entryPrice * (1 - maintBuffer))
    : entryPrice * (1 + maintBuffer);
}

function loadStoredLimitOrders(): PendingLimitOrder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LIMIT_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const DemoTradeView: React.FC = () => {
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const preferences = useAppStore((s) => s.preferences);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const liveCandle = useAppStore((s) => s.liveCandle);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setTimeframe = useAppStore((s) => s.setTimeframe);

  // Market catalog & chart state
  const [allMarkets, setAllMarkets] = useState<MarketTicker[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCat, setPickerCat] = useState<MarketFilterCat>('all');

  const [bundle, setBundle] = useState<AssetSignalBundle | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);

  // Chart overlay toggles
  const [showEma9, setShowEma9] = useState(true);
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showPosLines, setShowPosLines] = useState(true);

  // Paper / Demo account state
  const [snapshot, setSnapshot] = useState<PaperArenaSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);

  // Right Trade Panel state
  const [marginMode, setMarginMode] = useState<MarginMode>('Cross');
  const [leverage, setLeverage] = useState<number>(10);
  const [leverageOpen, setLeverageOpen] = useState(false);
  const [orderMode, setOrderMode] = useState<OrderMode>('Market');
  const [limitPriceInput, setLimitPriceInput] = useState<string>('');
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>('USDT');
  const [sizeInput, setSizeInput] = useState<string>('500');
  const [sliderPct, setSliderPct] = useState<number>(0);
  const [tpSlEnabled, setTpSlEnabled] = useState<boolean>(false);
  const [tpInput, setTpInput] = useState<string>('');
  const [slInput, setSlInput] = useState<string>('');
  const [fundsModalOpen, setFundsModalOpen] = useState(false);

  // Bottom dock state
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const [allMarketsFilter, setAllMarketsFilter] = useState<boolean>(true);
  const [limitOrders, setLimitOrders] = useState<PendingLimitOrder[]>(() => loadStoredLimitOrders());
  const [editingPos, setEditingPos] = useState<PaperPosition | null>(null);
  const [editTpVal, setEditTpVal] = useState<string>('');
  const [editSlVal, setEditSlVal] = useState<string>('');

  const pickerRef = useRef<HTMLDivElement>(null);
  const executingLimitIdsRef = useRef<Set<string>>(new Set());

  const flashBanner = useCallback((kind: 'ok' | 'err' | 'info', text: string) => {
    setBanner({ kind, text });
    window.setTimeout(() => {
      setBanner((cur) => (cur?.text === text ? null : cur));
    }, 4500);
  }, []);

  // Persist limit orders
  useEffect(() => {
    try {
      window.localStorage.setItem(LIMIT_ORDERS_KEY, JSON.stringify(limitOrders));
    } catch {
      // ignore storage quota errors
    }
  }, [limitOrders]);

  // Close market picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  // Load ALL markets across exchanges/asset classes
  const loadAllMarkets = useCallback(async () => {
    try {
      const res = await api.getMarkets('all', 'all');
      setAllMarkets(res.markets || []);
    } catch {
      // fallback to active exchange only
      try {
        const res = await api.getMarkets(exchange, marketType);
        setAllMarkets(res.markets || []);
      } catch {
        // ignore
      }
    } finally {
      setMarketsLoading(false);
    }
  }, [exchange, marketType]);

  useEffect(() => {
    loadAllMarkets();
    const id = window.setInterval(loadAllMarkets, 45_000);
    return () => window.clearInterval(id);
  }, [loadAllMarkets]);

  // Load Demo Account & Positions snapshot
  const loadDemoAccount = useCallback(async (refresh = true) => {
    try {
      const data = await api.getPaperState(refresh);
      setSnapshot(data);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Unable to load demo account state.');
    } finally {
      setSnapshotLoading(false);
    }
  }, [flashBanner]);

  useEffect(() => {
    loadDemoAccount(true);
    const id = window.setInterval(() => loadDemoAccount(true), 20_000);
    return () => window.clearInterval(id);
  }, [loadDemoAccount]);

  // Load active market candlesticks + indicators
  const loadCandles = useCallback(async () => {
    setChartLoading(true);
    setChartError(null);
    try {
      const res = await api.getAssetSignals(exchange, marketType, symbol, timeframe, 220);
      setBundle(res);
    } catch (err) {
      setChartError(err instanceof Error ? err.message : 'Unable to load live candles.');
      setBundle(null);
    } finally {
      setChartLoading(false);
    }
  }, [exchange, marketType, symbol, timeframe]);

  useEffect(() => {
    loadCandles();
    const id = window.setInterval(loadCandles, 30_000);
    return () => window.clearInterval(id);
  }, [loadCandles]);

  const activeCanonicalId = `${exchange}:${marketType}:${symbol}`;
  const supportedTimeframes = EXCHANGE_TIMEFRAMES[exchange] || ['15m', '1h', '4h', '1d'];

  // Active ticker merged with real-time WebSocket stream
  const activeMarketTicker = useMemo(() => {
    const found = allMarkets.find((m) => m.canonicalId === activeCanonicalId);
    const live = liveTickers[activeCanonicalId];
    if (found) {
      return {
        ...found,
        lastPrice: live?.lastPrice ?? found.lastPrice,
        change24hPct: live?.change24hPct ?? found.change24hPct,
        high24h: live?.high24h ?? found.high24h,
        low24h: live?.low24h ?? found.low24h,
        quoteVolume24h: live?.quoteVolume24h ?? found.quoteVolume24h,
      };
    }
    return null;
  }, [allMarkets, activeCanonicalId, liveTickers]);

  // Merge live WebSocket candle/tick into chart candles
  const mergedCandles = useMemo(() => {
    const base = bundle?.candles ? [...bundle.candles] : [];
    if (base.length === 0) return base;
    const live = liveTickers[activeCanonicalId];
    const last = { ...base[base.length - 1] };

    if (
      liveCandle &&
      liveCandle.canonicalId === activeCanonicalId &&
      liveCandle.timeframe === timeframe
    ) {
      if (liveCandle.candle.openTime === last.openTime) {
        base[base.length - 1] = liveCandle.candle;
      } else if (liveCandle.candle.openTime > last.openTime) {
        base.push(liveCandle.candle);
      }
      return base;
    }

    if (live && live.lastPrice > 0) {
      last.close = live.lastPrice;
      if (live.lastPrice > last.high) last.high = live.lastPrice;
      if (live.lastPrice < last.low) last.low = live.lastPrice;
      base[base.length - 1] = last;
    }
    return base;
  }, [bundle?.candles, liveTickers, liveCandle, activeCanonicalId, timeframe]);

  const currentPrice = useMemo(() => {
    const live = liveTickers[activeCanonicalId]?.lastPrice;
    if (live && live > 0) return live;
    if (activeMarketTicker?.lastPrice && activeMarketTicker.lastPrice > 0) {
      return activeMarketTicker.lastPrice;
    }
    if (mergedCandles.length > 0) return mergedCandles[mergedCandles.length - 1].close;
    return 0;
  }, [liveTickers, activeCanonicalId, activeMarketTicker, mergedCandles]);

  const prevPrice = liveTickers[activeCanonicalId]?.prevPrice ?? currentPrice;
  const priceUp = currentPrice >= prevPrice;
  const baseAsset = symbol.split('/')[0] || symbol;
  const quoteAsset = symbol.split('/')[1] || 'USDT';
  const compactTicker = `${baseAsset}${quoteAsset}`;

  // Pre-fill limit price when switching symbol or switching to Limit mode
  useEffect(() => {
    if (currentPrice > 0 && (!limitPriceInput || orderMode === 'Market')) {
      setLimitPriceInput(formatPrice(currentPrice, preferences.decimalPrecision));
    }
  }, [symbol, exchange, orderMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper to resolve live price for ANY position or pending limit order
  const getLivePriceFor = useCallback(
    (cid: string, fallback: number): number => {
      const ws = liveTickers[cid]?.lastPrice;
      if (ws && ws > 0) return ws;
      const m = allMarkets.find((x) => x.canonicalId === cid);
      if (m && m.lastPrice > 0) return m.lastPrice;
      return fallback;
    },
    [liveTickers, allMarkets],
  );

  // Live mark-to-market positions & account equity
  const liveOpenPositions = useMemo(() => {
    const raw = snapshot?.openPositions ?? [];
    return raw.map((pos) => {
      const mark = getLivePriceFor(pos.canonicalId, pos.currentPrice);
      const diff = pos.side === 'LONG' ? mark - pos.entryPrice : pos.entryPrice - mark;
      const unrealizedPnlUsd = diff * pos.remainingQuantity;
      const unrealizedPnlPct = pos.marginUsd > 0 ? (unrealizedPnlUsd / pos.marginUsd) * 100 : 0;
      return {
        ...pos,
        currentPrice: mark,
        unrealizedPnlUsd,
        unrealizedPnlPct,
        liqPrice: calcLiquidationPrice(pos.side, pos.entryPrice, pos.leverage),
      };
    });
  }, [snapshot?.openPositions, getLivePriceFor]);

  const closedPositions = snapshot?.closedTrades ?? [];
  const cashBalance = snapshot?.account.cashBalanceUsd ?? 10000;
  const marginUsed = liveOpenPositions.reduce((sum, p) => sum + p.marginUsd, 0);
  const totalUnrealizedPnl = liveOpenPositions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);
  const totalEquity = cashBalance + marginUsed + totalUnrealizedPnl;
  const feeBps = snapshot?.account.feeBps ?? 10;

  // Monitor pending Limit Orders against live prices & auto-execute when crossed
  useEffect(() => {
    if (limitOrders.length === 0) return;
    for (const ord of limitOrders) {
      if (executingLimitIdsRef.current.has(ord.id)) continue;
      const liveP = getLivePriceFor(ord.canonicalId, 0);
      if (liveP <= 0) continue;
      const triggered =
        (ord.side === 'LONG' && liveP <= ord.limitPrice) ||
        (ord.side === 'SHORT' && liveP >= ord.limitPrice);
      if (triggered) {
        executingLimitIdsRef.current.add(ord.id);
        api
          .openPaperOrder({
            exchange: ord.exchange,
            marketType: ord.marketType,
            symbol: ord.symbol,
            timeframe,
            side: ord.side,
            notionalUsd: ord.notionalUsd,
            leverage: ord.leverage,
            stopLoss: ord.stopLoss,
            tp1: ord.tp1,
            skipAutoSlTp: ord.stopLoss === null && ord.tp1 === null,
            entryReason: `Limit ${ord.side} triggered @ $${formatPrice(ord.limitPrice)} (${ord.marginMode} ${ord.leverage}x)`,
          })
          .then((res) => {
            setSnapshot(res.snapshot);
            setLimitOrders((prev) => prev.filter((o) => o.id !== ord.id));
            flashBanner(
              'ok',
              `Limit ${ord.side} filled on ${ord.symbol} @ $${formatPrice(liveP, preferences.decimalPrecision)}`,
            );
          })
          .catch((err) => {
            setLimitOrders((prev) => prev.filter((o) => o.id !== ord.id));
            flashBanner('err', `Limit order cancelled: ${err instanceof Error ? err.message : 'Execution failed'}`);
          })
          .finally(() => {
            executingLimitIdsRef.current.delete(ord.id);
          });
      }
    }
  }, [limitOrders, getLivePriceFor, timeframe, preferences.decimalPrecision, flashBanner]);

  // Order calculation metrics
  const effectiveEntryPrice =
    orderMode === 'Limit' && Number(limitPriceInput) > 0 ? Number(limitPriceInput) : currentPrice;

  const parsedSize = Math.max(0, Number(sizeInput) || 0);
  const orderNotionalUsd =
    sizeUnit === 'USDT' ? parsedSize : effectiveEntryPrice > 0 ? parsedSize * effectiveEntryPrice : 0;
  const orderQty =
    sizeUnit === 'BASE' ? parsedSize : effectiveEntryPrice > 0 ? parsedSize / effectiveEntryPrice : 0;
  const requiredMargin = leverage > 0 ? orderNotionalUsd / leverage : orderNotionalUsd;
  const estFee = orderNotionalUsd * (feeBps / 10_000);
  const totalCost = requiredMargin + estFee;
  const maxAvailableNotional = Math.max(0, cashBalance * leverage * 0.95);

  const handleSliderChange = (pct: number) => {
    setSliderPct(pct);
    const targetNotional = maxAvailableNotional * (pct / 100);
    if (sizeUnit === 'USDT') {
      setSizeInput(targetNotional > 0 ? targetNotional.toFixed(2) : '');
    } else if (effectiveEntryPrice > 0) {
      setSizeInput(targetNotional > 0 ? (targetNotional / effectiveEntryPrice).toFixed(5) : '');
    }
  };

  const handleAutoFillSignalTpSl = (sideHint?: PaperSide) => {
    const setup = bundle?.confirmed?.signalSetup;
    if (setup && setup.stopLoss && setup.takeProfits[0]?.price) {
      setTpSlEnabled(true);
      setSlInput(formatPrice(setup.stopLoss, preferences.decimalPrecision));
      setTpInput(formatPrice(setup.takeProfits[0].price, preferences.decimalPrecision));
      flashBanner('info', `Loaded SIGLENS ${setup.directionLabel} SL & TP1 levels.`);
      return;
    }
    if (currentPrice > 0) {
      const isLong = sideHint ? sideHint === 'LONG' : (bundle?.confirmed?.directionalScore ?? 0) >= 0;
      setTpSlEnabled(true);
      setSlInput(formatPrice(currentPrice * (isLong ? 0.98 : 1.02), preferences.decimalPrecision));
      setTpInput(formatPrice(currentPrice * (isLong ? 1.04 : 0.96), preferences.decimalPrecision));
      flashBanner('info', 'Filled 2% SL / 4% TP levels from live price.');
    }
  };

  // Submit Market or Limit Demo Order
  const handlePlaceOrder = async (side: PaperSide, quickNotionalOverride?: number) => {
    const notional = quickNotionalOverride ?? orderNotionalUsd;
    if (!Number.isFinite(notional) || notional < 10) {
      flashBanner('err', 'Minimum demo order value is $10 USDT.');
      return;
    }
    if (notional / leverage > cashBalance) {
      flashBanner('err', 'Insufficient available demo balance. Click "Request Demo Funds" below.');
      return;
    }

    const parsedTp = tpSlEnabled && Number(tpInput) > 0 ? Number(tpInput) : null;
    const parsedSl = tpSlEnabled && Number(slInput) > 0 ? Number(slInput) : null;

    if (parsedTp !== null && effectiveEntryPrice > 0) {
      if (side === 'LONG' && parsedTp <= effectiveEntryPrice) {
        flashBanner('err', 'Take Profit for a LONG must be higher than entry price.');
        return;
      }
      if (side === 'SHORT' && parsedTp >= effectiveEntryPrice) {
        flashBanner('err', 'Take Profit for a SHORT must be lower than entry price.');
        return;
      }
    }
    if (parsedSl !== null && effectiveEntryPrice > 0) {
      if (side === 'LONG' && parsedSl >= effectiveEntryPrice) {
        flashBanner('err', 'Stop Loss for a LONG must be lower than entry price.');
        return;
      }
      if (side === 'SHORT' && parsedSl <= effectiveEntryPrice) {
        flashBanner('err', 'Stop Loss for a SHORT must be higher than entry price.');
        return;
      }
    }

    // Handle Limit order when price hasn't crossed yet
    if (orderMode === 'Limit' && !quickNotionalOverride) {
      const lim = Number(limitPriceInput);
      if (!Number.isFinite(lim) || lim <= 0) {
        flashBanner('err', 'Enter a valid Limit Price.');
        return;
      }
      const immediateCross =
        (side === 'LONG' && currentPrice > 0 && currentPrice <= lim) ||
        (side === 'SHORT' && currentPrice > 0 && currentPrice >= lim);

      if (!immediateCross) {
        const newOrd: PendingLimitOrder = {
          id: `lim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          canonicalId: activeCanonicalId,
          exchange,
          marketType,
          symbol,
          side,
          limitPrice: lim,
          notionalUsd: notional,
          leverage,
          marginMode,
          stopLoss: parsedSl,
          tp1: parsedTp,
          createdAt: Date.now(),
        };
        setLimitOrders((prev) => [newOrd, ...prev]);
        setBottomTab('orders');
        flashBanner(
          'ok',
          `Limit ${side} placed on ${symbol} @ $${formatPrice(lim, preferences.decimalPrecision)} ($${notional.toFixed(0)} · ${leverage}x)`,
        );
        return;
      }
    }

    setActionBusy(true);
    try {
      const res = await api.openPaperOrder({
        exchange,
        marketType,
        symbol,
        timeframe,
        side,
        notionalUsd: notional,
        leverage,
        stopLoss: parsedSl,
        tp1: parsedTp,
        skipAutoSlTp: !tpSlEnabled,
        entryReason: `${marginMode} ${orderMode} ${side} (${leverage}x) via Demo Trade`,
      });
      setSnapshot(res.snapshot);
      setBottomTab('positions');
      flashBanner(
        'ok',
        `Opened ${side} ${symbol} @ $${formatPrice(res.position.entryPrice, preferences.decimalPrecision)} · $${res.position.notionalUsd.toFixed(0)} (${leverage}x)`,
      );
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to open demo order.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleClosePosition = async (posId: string) => {
    setActionBusy(true);
    try {
      const res = await api.closePaperPosition(posId);
      setSnapshot(res.snapshot);
      const pnl = res.position.realizedPnlUsd;
      flashBanner(
        'ok',
        `Closed ${res.position.displaySymbol} · Net P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      );
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Unable to close position.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCloseAllPositions = async () => {
    if (liveOpenPositions.length === 0) return;
    setActionBusy(true);
    try {
      for (const pos of liveOpenPositions) {
        const res = await api.closePaperPosition(pos.id);
        setSnapshot(res.snapshot);
      }
      flashBanner('ok', `Closed all ${liveOpenPositions.length} open demo position(s).`);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to close all positions.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSavePositionTpSl = async () => {
    if (!editingPos) return;
    setActionBusy(true);
    try {
      const tp = editTpVal.trim() ? Number(editTpVal) : null;
      const sl = editSlVal.trim() ? Number(editSlVal) : null;
      const res = await api.updatePaperPositionTpSl(editingPos.id, { tp1: tp, stopLoss: sl });
      setSnapshot(res.snapshot);
      setEditingPos(null);
      flashBanner('ok', `Updated TP/SL for ${editingPos.displaySymbol}.`);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Invalid TP/SL values.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleTopUpFunds = async (amountUsd: number) => {
    setActionBusy(true);
    try {
      const res = await api.topUpPaperFunds(amountUsd);
      setSnapshot(res.snapshot);
      setFundsModalOpen(false);
      flashBanner('ok', `Added +$${amountUsd.toLocaleString('en-US')} USDT demo funds.`);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to add demo funds.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetFunds = async (startingBalanceUsd: number) => {
    setActionBusy(true);
    try {
      const res = await api.resetPaperAccount(startingBalanceUsd);
      setSnapshot(res.snapshot);
      setLimitOrders([]);
      setFundsModalOpen(false);
      flashBanner('ok', `Demo account reset to $${startingBalanceUsd.toLocaleString('en-US')} USDT.`);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to reset demo account.');
    } finally {
      setActionBusy(false);
    }
  };

  // Filtered all-markets list for searchable picker
  const filteredPickerMarkets = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return allMarkets
      .map((m) => {
        const live = liveTickers[m.canonicalId];
        return live
          ? {
              ...m,
              lastPrice: live.lastPrice,
              change24hPct: live.change24hPct ?? m.change24hPct,
              quoteVolume24h: live.quoteVolume24h ?? m.quoteVolume24h,
            }
          : m;
      })
      .filter((m) => {
        if (pickerCat === 'crypto_spot' && m.marketType !== 'spot') return false;
        if (pickerCat === 'perpetual' && m.marketType !== 'perpetual') return false;
        if (pickerCat === 'stocks' && m.exchange !== 'stocks') return false;
        if (pickerCat === 'cfds' && m.exchange !== 'cfds') return false;
        if (q) {
          const hay = `${m.displaySymbol} ${m.baseAsset} ${m.exchange} ${m.marketType}`.toLowerCase();
          return hay.includes(q);
        }
        return true;
      })
      .sort((a, b) => (b.quoteVolume24h || 0) - (a.quoteVolume24h || 0))
      .slice(0, 80);
  }, [allMarkets, liveTickers, pickerSearch, pickerCat]);

  // Filter bottom positions & orders
  const visiblePositions = useMemo(
    () =>
      allMarketsFilter
        ? liveOpenPositions
        : liveOpenPositions.filter((p) => p.canonicalId === activeCanonicalId),
    [liveOpenPositions, allMarketsFilter, activeCanonicalId],
  );

  const visibleLimitOrders = useMemo(
    () =>
      allMarketsFilter
        ? limitOrders
        : limitOrders.filter((o) => o.canonicalId === activeCanonicalId),
    [limitOrders, allMarketsFilter, activeCanonicalId],
  );

  const visibleHistory = useMemo(
    () =>
      allMarketsFilter
        ? closedPositions
        : closedPositions.filter((p) => p.canonicalId === activeCanonicalId),
    [closedPositions, allMarketsFilter, activeCanonicalId],
  );

  // Open positions on the CURRENT chart symbol (for drawing Entry / TP / SL markLines)
  const chartPositions = useMemo(
    () => liveOpenPositions.filter((p) => p.canonicalId === activeCanonicalId),
    [liveOpenPositions, activeCanonicalId],
  );

  // Build Pro Exchange Candlestick ECharts Option
  const candlestickOption: EChartsOption = useMemo(() => {
    const slice = mergedCandles.slice(-140);
    const offset = Math.max(0, mergedCandles.length - slice.length);
    const labels = slice.map((c) => {
      const d = new Date(c.openTime);
      if (timeframe === '1d' || timeframe === '1w') return d.toISOString().slice(5, 10);
      return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`;
    });

    // ECharts candlestick expects [open, close, lowest, highest]
    const ohlc = slice.map((c) => [c.open, c.close, c.low, c.high]);
    const volumes = slice.map((c) => ({
      value: c.volume,
      itemStyle: {
        color: c.close >= c.open ? 'rgba(14, 203, 129, 0.32)' : 'rgba(246, 70, 93, 0.32)',
      },
    }));

    const seriesPack = bundle?.series;
    const alignSeries = (arr?: (number | null)[]) => {
      if (!arr || arr.length === 0) return [];
      const sliced = arr.slice(offset, offset + slice.length);
      while (sliced.length < slice.length) sliced.push(null);
      return sliced;
    };

    const markLineData: Record<string, unknown>[] = [];
    if (currentPrice > 0) {
      markLineData.push({
        yAxis: currentPrice,
        lineStyle: {
          color: priceUp ? '#0ECB81' : '#F6465D',
          type: 'dashed',
          width: 1,
          opacity: 0.75,
        },
        label: {
          formatter: () => formatPrice(currentPrice, preferences.decimalPrecision),
          backgroundColor: priceUp ? '#0ECB81' : '#F6465D',
          color: '#0B0E11',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          fontWeight: 'bold',
          padding: [3, 6],
          borderRadius: 4,
        },
      });
    }

    if (showPosLines) {
      chartPositions.forEach((pos) => {
        markLineData.push({
          yAxis: pos.entryPrice,
          lineStyle: { color: '#3B82F6', type: 'solid', width: 1.2 },
          label: {
            formatter: `${pos.side} ${pos.leverage}x · ${formatPrice(pos.entryPrice, preferences.decimalPrecision)}`,
            backgroundColor: '#1D4ED8',
            color: '#FFFFFF',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            padding: [2, 6],
            borderRadius: 4,
          },
        });
        if (pos.tp1) {
          markLineData.push({
            yAxis: pos.tp1,
            lineStyle: { color: '#0ECB81', type: 'dotted', width: 1.2 },
            label: {
              formatter: `TP ${formatPrice(pos.tp1, preferences.decimalPrecision)}`,
              backgroundColor: '#065F46',
              color: '#6EE7B7',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 10,
              padding: [2, 6],
              borderRadius: 4,
            },
          });
        }
        if (pos.stopLoss) {
          markLineData.push({
            yAxis: pos.stopLoss,
            lineStyle: { color: '#F6465D', type: 'dotted', width: 1.2 },
            label: {
              formatter: `SL ${formatPrice(pos.stopLoss, preferences.decimalPrecision)}`,
              backgroundColor: '#881337',
              color: '#FDA4AF',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 10,
              padding: [2, 6],
              borderRadius: 4,
            },
          });
        }
      });
    }

    const chartSeries: EChartsOption['series'] = [
      {
        name: compactTicker,
        type: 'candlestick',
        data: ohlc,
        xAxisIndex: 0,
        yAxisIndex: 0,
        itemStyle: {
          color: '#0ECB81',
          color0: '#F6465D',
          borderColor: '#0ECB81',
          borderColor0: '#F6465D',
        },
        markLine: {
          symbol: ['none', 'none'],
          silent: true,
          animation: false,
          data: markLineData as never,
        },
      },
    ];

    if (showEma9 && seriesPack?.ema9) {
      chartSeries.push({
        name: 'EMA 9',
        type: 'line',
        data: alignSeries(seriesPack.ema9),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.3, color: '#38BDF8' },
      });
    }
    if (showEma20 && seriesPack?.ema20) {
      chartSeries.push({
        name: 'EMA 20',
        type: 'line',
        data: alignSeries(seriesPack.ema20),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.6, color: '#F7A600' },
      });
    }
    if (showEma50 && seriesPack?.ema50) {
      chartSeries.push({
        name: 'EMA 50',
        type: 'line',
        data: alignSeries(seriesPack.ema50),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.6, color: '#E2E8F0' },
      });
    }
    if (showBB && seriesPack?.bbUpper && seriesPack?.bbLower) {
      chartSeries.push(
        {
          name: 'BB Upper',
          type: 'line',
          data: alignSeries(seriesPack.bbUpper),
          showSymbol: false,
          lineStyle: { width: 1, type: 'dashed', color: 'rgba(148, 163, 184, 0.55)' },
        },
        {
          name: 'BB Lower',
          type: 'line',
          data: alignSeries(seriesPack.bbLower),
          showSymbol: false,
          lineStyle: { width: 1, type: 'dashed', color: 'rgba(148, 163, 184, 0.55)' },
        },
      );
    }
    if (showVolume) {
      chartSeries.push({
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
        barMaxWidth: 8,
      });
    }

    return {
      backgroundColor: '#0B0E11',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: '#475569', width: 1, type: 'dashed' },
          crossStyle: { color: '#475569' },
          label: { backgroundColor: '#1E2530', color: '#E2E8F0', fontSize: 10 },
        },
        backgroundColor: 'rgba(16, 20, 25, 0.95)',
        borderColor: '#26303D',
        textStyle: { color: '#E2E8F0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: showVolume
        ? [
            { left: 10, right: 76, top: 18, height: '68%' },
            { left: 10, right: 76, top: '79%', height: '15%' },
          ]
        : [{ left: 10, right: 76, top: 18, bottom: 28 }],
      xAxis: showVolume
        ? [
            {
              type: 'category',
              data: labels,
              boundaryGap: true,
              axisLine: { lineStyle: { color: '#1E2530' } },
              axisLabel: { show: false },
              axisTick: { show: false },
              splitLine: { show: true, lineStyle: { color: 'rgba(30, 37, 48, 0.55)' } },
            },
            {
              type: 'category',
              gridIndex: 1,
              data: labels,
              boundaryGap: true,
              axisLine: { lineStyle: { color: '#1E2530' } },
              axisTick: { show: false },
              axisLabel: { color: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
            },
          ]
        : [
            {
              type: 'category',
              data: labels,
              boundaryGap: true,
              axisLine: { lineStyle: { color: '#1E2530' } },
              axisLabel: { color: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
              splitLine: { show: true, lineStyle: { color: 'rgba(30, 37, 48, 0.55)' } },
            },
          ],
      yAxis: showVolume
        ? [
            {
              scale: true,
              position: 'right',
              axisLine: { show: false },
              axisTick: { show: false },
              splitLine: { lineStyle: { color: 'rgba(30, 37, 48, 0.7)' } },
              axisLabel: {
                color: '#848E9C',
                fontSize: 10,
                fontFamily: 'JetBrains Mono, monospace',
                formatter: (v: number) => formatPrice(v, preferences.decimalPrecision),
              },
            },
            {
              scale: true,
              gridIndex: 1,
              position: 'right',
              splitNumber: 2,
              axisLine: { show: false },
              axisTick: { show: false },
              splitLine: { show: false },
              axisLabel: { show: false },
            },
          ]
        : [
            {
              scale: true,
              position: 'right',
              axisLine: { show: false },
              axisTick: { show: false },
              splitLine: { lineStyle: { color: 'rgba(30, 37, 48, 0.7)' } },
              axisLabel: {
                color: '#848E9C',
                fontSize: 10,
                fontFamily: 'JetBrains Mono, monospace',
                formatter: (v: number) => formatPrice(v, preferences.decimalPrecision),
              },
            },
          ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: showVolume ? [0, 1] : [0],
          start: 35,
          end: 100,
        },
      ],
      series: chartSeries,
    };
  }, [
    mergedCandles,
    timeframe,
    bundle?.series,
    currentPrice,
    priceUp,
    preferences.decimalPrecision,
    showEma9,
    showEma20,
    showEma50,
    showBB,
    showVolume,
    showPosLines,
    chartPositions,
    compactTicker,
  ]);

  // Equity Curve Mini-Chart for Assets tab
  const equityChartOption: EChartsOption = useMemo(() => {
    const curve = snapshot?.equityCurve ?? [];
    return {
      backgroundColor: 'transparent',
      grid: { left: 10, right: 56, top: 14, bottom: 22 },
      xAxis: {
        type: 'category',
        data: curve.map((pt) => new Date(pt.timestamp).toISOString().slice(11, 16)),
        axisLine: { lineStyle: { color: '#1E2530' } },
        axisLabel: { color: '#64748B', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        position: 'right',
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(30, 37, 48, 0.7)' } },
        axisLabel: {
          color: '#848E9C',
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          formatter: (v: number) => `$${v.toFixed(0)}`,
        },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#101419',
        borderColor: '#26303D',
        textStyle: { color: '#E2E8F0', fontSize: 11 },
      },
      series: [
        {
          type: 'line',
          data: curve.map((pt) => Number(pt.equityUsd.toFixed(2))),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#0ECB81', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(14, 203, 129, 0.25)' },
                { offset: 1, color: 'rgba(14, 203, 129, 0.0)' },
              ],
            },
          },
        },
      ],
    };
  }, [snapshot?.equityCurve]);

  const lastCandle = mergedCandles.length > 0 ? mergedCandles[mergedCandles.length - 1] : null;
  const lastEma20 = bundle?.series?.ema20?.slice().reverse().find((v) => v !== null) ?? null;
  const lastEma50 = bundle?.series?.ema50?.slice().reverse().find((v) => v !== null) ?? null;
  const badgeStyle = coinAccent(baseAsset);
  const change24hPct = activeMarketTicker?.change24hPct ?? 0;
  const signalBias = bundle?.confirmed?.classification;

  return (
    <div className="-mx-2 sm:-mx-3 rounded-2xl overflow-hidden bg-[#0B0E11] text-[#EAECEF] border border-[#1E2530] shadow-2xl">
      {/* Inline Notification Banner */}
      {banner && (
        <div
          className={`px-4 py-2 text-xs font-medium flex items-center justify-between border-b ${
            banner.kind === 'ok'
              ? 'bg-[#0ECB81]/15 text-[#4ADE80] border-[#0ECB81]/30'
              : banner.kind === 'err'
                ? 'bg-[#F6465D]/15 text-[#FDA4AF] border-[#F6465D]/30'
                : 'bg-[#F7A600]/15 text-[#FCD34D] border-[#F7A600]/30'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="p-0.5 hover:opacity-75"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ============ TOP MARKET TICKER & STATS BAR (BYBIT STYLE) ============ */}
      <div className="bg-[#101419] border-b border-[#1E2530] px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2.5">
        {/* All-Markets Searchable Selector */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl bg-[#161C24] hover:bg-[#1C2430] border border-[#252E3B] transition-colors"
          >
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${badgeStyle.bg}`}
            >
              {badgeStyle.glyph}
            </span>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-extrabold tracking-tight text-white">
                  {compactTicker}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#F7A600]/15 text-[#F7A600]">
                  {marketType === 'perpetual' ? 'Perp' : marketType}
                </span>
              </div>
              <div className="text-[10px] text-[#848E9C] leading-none mt-0.5">
                {EXCHANGE_LABELS[exchange]} · All Markets
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#848E9C] transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Searchable All-Markets Dropdown */}
          {pickerOpen && (
            <div className="absolute left-0 top-full mt-2 w-[360px] max-w-[92vw] rounded-2xl bg-[#131820] border border-[#26303D] shadow-2xl z-50 overflow-hidden">
              <div className="p-3 border-b border-[#1E2530] space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Search BTC, ETH, SOL, AAPL, NVDA, XAU..."
                    autoFocus
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#0B0E11] border border-[#252E3B] text-xs text-white placeholder-[#64748B] focus:outline-none focus:border-[#F7A600]"
                  />
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {(
                    [
                      ['all', 'All'],
                      ['crypto_spot', 'Spot'],
                      ['perpetual', 'Perp'],
                      ['stocks', 'Stocks'],
                      ['cfds', 'CFDs'],
                    ] as [MarketFilterCat, string][]
                  ).map(([cat, lbl]) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setPickerCat(cat)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${
                        pickerCat === cat
                          ? 'bg-[#F7A600] text-[#0B0E11]'
                          : 'bg-[#1A212C] text-[#94A3B8] hover:text-white'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-[#1A212C]">
                {marketsLoading && filteredPickerMarkets.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#64748B]">Loading live markets...</div>
                ) : filteredPickerMarkets.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#64748B]">No markets matched.</div>
                ) : (
                  filteredPickerMarkets.map((m) => {
                    const active = m.canonicalId === activeCanonicalId;
                    const pos = (m.change24hPct ?? 0) >= 0;
                    return (
                      <button
                        key={m.canonicalId}
                        type="button"
                        onClick={() => {
                          selectMarket(m.exchange, m.marketType, m.displaySymbol, false);
                          setPickerOpen(false);
                        }}
                        className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[#1B232E] transition-colors ${
                          active ? 'bg-[#1B232E]' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-white">
                              {m.displaySymbol}
                            </span>
                            <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-white/[0.06] text-[#94A3B8]">
                              {m.exchange}
                            </span>
                          </div>
                          <div className="text-[10px] text-[#64748B] font-mono">
                            Vol {formatCompactUsd(m.quoteVolume24h || 0)}
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-xs font-bold text-white">
                            ${formatPrice(m.lastPrice, preferences.decimalPrecision)}
                          </div>
                          <div
                            className={`text-[10px] font-semibold ${
                              pos ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                            }`}
                          >
                            {formatPercent(m.change24hPct ?? 0)}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Big Live Last Price */}
        <div className="font-mono tabular-nums">
          <div
            className={`text-lg sm:text-xl font-extrabold leading-tight ${
              priceUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'
            }`}
          >
            {currentPrice > 0 ? formatPrice(currentPrice, preferences.decimalPrecision) : '—'}
          </div>
          <div className="text-[10px] text-[#848E9C] flex items-center gap-1">
            <span>Mark</span>
            <span className="text-[#CBD5E1]">
              {currentPrice > 0 ? `$${formatPrice(currentPrice, preferences.decimalPrecision)}` : '—'}
            </span>
          </div>
        </div>

        {/* 24h Market Stats Strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] font-mono tabular-nums">
          <div>
            <div className="text-[10px] text-[#64748B] font-sans">24h Change</div>
            <div className={change24hPct >= 0 ? 'text-[#0ECB81] font-semibold' : 'text-[#F6465D] font-semibold'}>
              {formatPercent(change24hPct)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#64748B] font-sans">24h High</div>
            <div className="text-[#EAECEF] font-semibold">
              {activeMarketTicker?.high24h
                ? formatPrice(activeMarketTicker.high24h, preferences.decimalPrecision)
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#64748B] font-sans">24h Low</div>
            <div className="text-[#EAECEF] font-semibold">
              {activeMarketTicker?.low24h
                ? formatPrice(activeMarketTicker.low24h, preferences.decimalPrecision)
                : '—'}
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="text-[10px] text-[#64748B] font-sans">24h Turnover</div>
            <div className="text-[#EAECEF] font-semibold">
              {activeMarketTicker?.quoteVolume24h
                ? formatCompactUsd(activeMarketTicker.quoteVolume24h)
                : '—'}
            </div>
          </div>
          {signalBias && (
            <div className="hidden md:block">
              <div className="text-[10px] text-[#64748B] font-sans">SIGLENS Bias</div>
              <div
                className={`font-bold ${
                  signalBias.includes('BULLISH')
                    ? 'text-[#0ECB81]'
                    : signalBias.includes('BEARISH')
                      ? 'text-[#F6465D]'
                      : 'text-[#F7A600]'
                }`}
              >
                {signalBias.replace('_', ' ')} ({bundle?.confirmed?.directionalScore?.toFixed(0)})
              </div>
            </div>
          )}
        </div>

        {/* Right Demo Badge + Refresh */}
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F7A600]/15 border border-[#F7A600]/35 text-[#F7A600] text-[10px] font-extrabold tracking-wide uppercase">
            <Activity className="w-3 h-3" />
            Demo Trading
          </span>
          <button
            type="button"
            onClick={() => {
              loadCandles();
              loadDemoAccount(true);
            }}
            title="Refresh chart & account"
            className="p-1.5 rounded-lg bg-[#161C24] hover:bg-[#1E2632] border border-[#252E3B] text-[#94A3B8] hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${chartLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ============ MAIN 2-COLUMN EXCHANGE BODY (NO ORDER BOOK) ============ */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_344px]">
        {/* LEFT COLUMN: FULL-WIDTH LIVE CHART + BOTTOM POSITIONS DOCK */}
        <div className="min-w-0 flex flex-col">
          {/* Chart Toolbar: Timeframes + Indicators + Floating Quick Market Long/Short */}
          <div className="bg-[#101419] border-b border-[#1E2530] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            {/* Timeframes */}
            <div className="flex items-center gap-1 flex-wrap">
              {CHART_TIMEFRAMES.filter((tf) => supportedTimeframes.includes(tf.value)).map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  onClick={() => setTimeframe(tf.value)}
                  className={`px-2 py-1 rounded-md font-mono text-[11px] font-bold transition-colors ${
                    timeframe === tf.value
                      ? 'bg-[#1F2937] text-[#F7A600]'
                      : 'text-[#848E9C] hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
              <span className="h-4 w-px bg-[#1E2530] mx-1" />
              {/* Indicator Overlay Chips */}
              {(
                [
                  ['EMA 9', showEma9, () => setShowEma9((v) => !v), '#38BDF8'],
                  ['EMA 20', showEma20, () => setShowEma20((v) => !v), '#F7A600'],
                  ['EMA 50', showEma50, () => setShowEma50((v) => !v), '#E2E8F0'],
                  ['BB', showBB, () => setShowBB((v) => !v), '#94A3B8'],
                  ['Vol', showVolume, () => setShowVolume((v) => !v), '#0ECB81'],
                  ['Pos Lines', showPosLines, () => setShowPosLines((v) => !v), '#3B82F6'],
                ] as [string, boolean, () => void, string][]
              ).map(([label, active, toggle, dotColor]) => (
                <button
                  key={label}
                  type="button"
                  onClick={toggle}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                    active
                      ? 'bg-[#161C24] border-[#334155] text-white'
                      : 'border-transparent text-[#64748B] hover:text-[#CBD5E1]'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: active ? dotColor : '#475569' }}
                  />
                  {label}
                </button>
              ))}
            </div>

            {/* Bybit-style Quick Market Long / Short Pills */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={actionBusy || currentPrice <= 0}
                onClick={() => handlePlaceOrder('LONG')}
                className="px-2.5 py-1 rounded-md bg-[#0ECB81] hover:bg-[#12DB8C] disabled:opacity-50 text-[#0B0E11] font-mono text-[10.5px] font-extrabold transition-colors flex items-center gap-1.5"
                title={`Instant Market Long (${orderNotionalUsd.toFixed(0)} USDT)`}
              >
                <span>Market Long</span>
                <span>{currentPrice > 0 ? formatPrice(currentPrice, preferences.decimalPrecision) : '—'}</span>
              </button>
              <button
                type="button"
                disabled={actionBusy || currentPrice <= 0}
                onClick={() => handlePlaceOrder('SHORT')}
                className="px-2.5 py-1 rounded-md bg-[#F6465D] hover:bg-[#FF576D] disabled:opacity-50 text-white font-mono text-[10.5px] font-extrabold transition-colors flex items-center gap-1.5"
                title={`Instant Market Short (${orderNotionalUsd.toFixed(0)} USDT)`}
              >
                <span>Market Short</span>
                <span>{currentPrice > 0 ? formatPrice(currentPrice, preferences.decimalPrecision) : '—'}</span>
              </button>
            </div>
          </div>

          {/* OHLCV + EMA Live Readout Strip */}
          <div className="bg-[#0B0E11] px-3 pt-2 pb-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-[#848E9C]">
            <span className="font-bold text-[#CBD5E1]">
              {compactTicker} · {timeframe} · {EXCHANGE_LABELS[exchange]}
            </span>
            {lastCandle && (
              <>
                <span>
                  O <b className="text-[#EAECEF]">{formatPrice(lastCandle.open, preferences.decimalPrecision)}</b>
                </span>
                <span>
                  H <b className="text-[#0ECB81]">{formatPrice(lastCandle.high, preferences.decimalPrecision)}</b>
                </span>
                <span>
                  L <b className="text-[#F6465D]">{formatPrice(lastCandle.low, preferences.decimalPrecision)}</b>
                </span>
                <span>
                  C{' '}
                  <b className={lastCandle.close >= lastCandle.open ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
                    {formatPrice(lastCandle.close, preferences.decimalPrecision)}
                  </b>
                </span>
              </>
            )}
            {showEma20 && lastEma20 !== null && (
              <span className="text-[#F7A600]">
                EMA20 {formatPrice(lastEma20, preferences.decimalPrecision)}
              </span>
            )}
            {showEma50 && lastEma50 !== null && (
              <span className="text-[#E2E8F0]">
                EMA50 {formatPrice(lastEma50, preferences.decimalPrecision)}
              </span>
            )}
          </div>

          {/* Live Candlestick Chart Canvas */}
          <div className="relative bg-[#0B0E11] px-1 pb-2 border-b border-[#1E2530]">
            {chartError ? (
              <div className="h-[460px] flex flex-col items-center justify-center gap-2 text-xs text-[#94A3B8]">
                <ShieldAlert className="w-6 h-6 text-[#F6465D]" />
                <div>{chartError}</div>
                <button
                  type="button"
                  onClick={loadCandles}
                  className="px-3 py-1.5 rounded-lg bg-[#1E2530] text-white font-semibold hover:bg-[#2A3444]"
                >
                  Retry Live Feed
                </button>
              </div>
            ) : mergedCandles.length === 0 && chartLoading ? (
              <div className="h-[460px] flex items-center justify-center text-xs text-[#64748B] font-mono">
                Streaming live {symbol} candles...
              </div>
            ) : (
              <EChartBox option={candlestickOption} height={470} />
            )}
          </div>

          {/* ============ BOTTOM ACCOUNT & POSITIONS DOCK ============ */}
          <div className="bg-[#101419] flex-1 flex flex-col min-h-[260px]">
            {/* Dock Tabs Header */}
            <div className="px-3 sm:px-4 border-b border-[#1E2530] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 overflow-x-auto">
                {(
                  [
                    ['positions', `Positions (${liveOpenPositions.length})`],
                    ['orders', `Open Orders (${limitOrders.length})`],
                    ['history', `Trade History (${closedPositions.length})`],
                    ['assets', 'Assets & P&L'],
                  ] as [BottomTab, string][]
                ).map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setBottomTab(tabId)}
                    className={`px-3 py-2.5 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
                      bottomTab === tabId
                        ? 'border-[#F7A600] text-white'
                        : 'border-transparent text-[#848E9C] hover:text-[#CBD5E1]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 py-1.5">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-[#94A3B8] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allMarketsFilter}
                    onChange={(e) => setAllMarketsFilter(e.target.checked)}
                    className="accent-[#F7A600] rounded"
                  />
                  <span>All Markets</span>
                </label>
                {liveOpenPositions.length > 0 && bottomTab === 'positions' && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={handleCloseAllPositions}
                    className="px-2.5 py-1 rounded-md bg-[#F6465D]/15 hover:bg-[#F6465D]/25 text-[#FDA4AF] border border-[#F6465D]/30 text-[11px] font-bold transition-colors"
                  >
                    Close All
                  </button>
                )}
              </div>
            </div>

            {/* TAB 1: OPEN POSITIONS */}
            {bottomTab === 'positions' && (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse font-mono text-[11.5px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E2530] text-[10px] font-sans uppercase tracking-wider text-[#64748B]">
                      <th className="py-2.5 px-3">Contracts</th>
                      <th className="py-2.5 px-2.5">Qty</th>
                      <th className="py-2.5 px-2.5">Value</th>
                      <th className="py-2.5 px-2.5">Entry Price</th>
                      <th className="py-2.5 px-2.5">Mark Price</th>
                      <th className="py-2.5 px-2.5">Liq. Price</th>
                      <th className="py-2.5 px-2.5">Margin (IM)</th>
                      <th className="py-2.5 px-2.5">TP / SL</th>
                      <th className="py-2.5 px-2.5">Unrealized P&amp;L (ROI)</th>
                      <th className="py-2.5 px-3 text-right">Close By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181F29]">
                    {snapshotLoading && visiblePositions.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-10 text-center text-xs text-[#64748B] font-sans">
                          Loading demo positions...
                        </td>
                      </tr>
                    ) : visiblePositions.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-10 text-center text-xs text-[#64748B] font-sans">
                          No open demo positions. Use the right Trade panel or Quick Market Long/Short to open a position.
                        </td>
                      </tr>
                    ) : (
                      visiblePositions.map((pos) => {
                        const pnlPos = pos.unrealizedPnlUsd >= 0;
                        return (
                          <tr key={pos.id} className="hover:bg-white/[0.025] transition-colors">
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                onClick={() => selectMarket(pos.exchange, pos.marketType, pos.displaySymbol, false)}
                                className="flex items-center gap-2 text-left group"
                              >
                                <span
                                  className={`w-1 h-7 rounded-full ${
                                    pos.side === 'LONG' ? 'bg-[#0ECB81]' : 'bg-[#F6465D]'
                                  }`}
                                />
                                <div>
                                  <div className="font-bold text-white group-hover:text-[#F7A600] transition-colors">
                                    {pos.displaySymbol.replace('/', '')}
                                  </div>
                                  <div className="flex items-center gap-1 text-[10px]">
                                    <span
                                      className={
                                        pos.side === 'LONG' ? 'text-[#0ECB81] font-bold' : 'text-[#F6465D] font-bold'
                                      }
                                    >
                                      {pos.side}
                                    </span>
                                    <span className="text-[#F7A600]">{pos.leverage}x</span>
                                  </div>
                                </div>
                              </button>
                            </td>
                            <td className="py-2.5 px-2.5 text-[#EAECEF]">
                              {pos.remainingQuantity.toFixed(pos.remainingQuantity >= 10 ? 2 : 4)}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#EAECEF]">
                              ${pos.notionalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#CBD5E1]">
                              {formatPrice(pos.entryPrice, preferences.decimalPrecision)}
                            </td>
                            <td className="py-2.5 px-2.5 text-white font-semibold">
                              {formatPrice(pos.currentPrice, preferences.decimalPrecision)}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#F7A600]">
                              {pos.liqPrice > 0 ? formatPrice(pos.liqPrice, preferences.decimalPrecision) : '—'}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#CBD5E1]">${pos.marginUsd.toFixed(2)}</td>
                            <td className="py-2.5 px-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPos(pos);
                                  setEditTpVal(pos.tp1 ? String(pos.tp1) : '');
                                  setEditSlVal(pos.stopLoss ? String(pos.stopLoss) : '');
                                }}
                                className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded bg-[#161C24] hover:bg-[#1F2937] border border-[#252E3B] text-[#CBD5E1]"
                              >
                                <span className="text-[#0ECB81]">
                                  {pos.tp1 ? formatPrice(pos.tp1, preferences.decimalPrecision) : '—'}
                                </span>
                                <span className="text-[#475569]">/</span>
                                <span className="text-[#F6465D]">
                                  {pos.stopLoss ? formatPrice(pos.stopLoss, preferences.decimalPrecision) : '—'}
                                </span>
                                <Edit3 className="w-2.5 h-2.5 text-[#64748B] ml-0.5" />
                              </button>
                            </td>
                            <td className="py-2.5 px-2.5">
                              <div className={`font-bold ${pnlPos ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                                {pnlPos ? '+' : ''}
                                {pos.unrealizedPnlUsd.toFixed(2)} USDT
                              </div>
                              <div className={`text-[10px] ${pnlPos ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                                ({pnlPos ? '+' : ''}
                                {pos.unrealizedPnlPct.toFixed(2)}%)
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleClosePosition(pos.id)}
                                className="px-2.5 py-1 rounded-md bg-[#1C2430] hover:bg-[#F7A600] hover:text-[#0B0E11] text-[#EAECEF] text-[11px] font-sans font-bold transition-colors"
                              >
                                Market
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 2: OPEN LIMIT ORDERS */}
            {bottomTab === 'orders' && (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse font-mono text-[11.5px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E2530] text-[10px] font-sans uppercase tracking-wider text-[#64748B]">
                      <th className="py-2.5 px-3">Contract</th>
                      <th className="py-2.5 px-2.5">Side</th>
                      <th className="py-2.5 px-2.5">Limit Price</th>
                      <th className="py-2.5 px-2.5">Live Price</th>
                      <th className="py-2.5 px-2.5">Value</th>
                      <th className="py-2.5 px-2.5">Leverage</th>
                      <th className="py-2.5 px-2.5">TP / SL</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181F29]">
                    {visibleLimitOrders.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-xs text-[#64748B] font-sans">
                          No active Limit orders. Switch the Trade panel to Limit mode to queue price-triggered orders.
                        </td>
                      </tr>
                    ) : (
                      visibleLimitOrders.map((ord) => {
                        const liveP = getLivePriceFor(ord.canonicalId, 0);
                        return (
                          <tr key={ord.id} className="hover:bg-white/[0.025]">
                            <td className="py-2.5 px-3 font-bold text-white">{ord.symbol}</td>
                            <td className="py-2.5 px-2.5">
                              <span
                                className={`font-bold ${
                                  ord.side === 'LONG' ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                                }`}
                              >
                                {ord.side} Limit
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-[#F7A600] font-semibold">
                              ${formatPrice(ord.limitPrice, preferences.decimalPrecision)}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#CBD5E1]">
                              {liveP > 0 ? `$${formatPrice(liveP, preferences.decimalPrecision)}` : '—'}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#EAECEF]">${ord.notionalUsd.toFixed(2)}</td>
                            <td className="py-2.5 px-2.5 text-[#94A3B8]">
                              {ord.marginMode} {ord.leverage}x
                            </td>
                            <td className="py-2.5 px-2.5 text-[10.5px]">
                              <span className="text-[#0ECB81]">{ord.tp1 ? formatPrice(ord.tp1) : '—'}</span> /{' '}
                              <span className="text-[#F6465D]">{ord.stopLoss ? formatPrice(ord.stopLoss) : '—'}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => setLimitOrders((prev) => prev.filter((o) => o.id !== ord.id))}
                                className="px-2.5 py-1 rounded-md bg-[#F6465D]/15 hover:bg-[#F6465D]/30 text-[#FDA4AF] text-[11px] font-sans font-bold"
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: TRADE HISTORY */}
            {bottomTab === 'history' && (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse font-mono text-[11.5px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1E2530] text-[10px] font-sans uppercase tracking-wider text-[#64748B]">
                      <th className="py-2.5 px-3">Contract</th>
                      <th className="py-2.5 px-2.5">Side</th>
                      <th className="py-2.5 px-2.5">Entry</th>
                      <th className="py-2.5 px-2.5">Exit</th>
                      <th className="py-2.5 px-2.5">Value</th>
                      <th className="py-2.5 px-2.5">Realized P&amp;L</th>
                      <th className="py-2.5 px-2.5">Fees</th>
                      <th className="py-2.5 px-2.5">Exit Reason</th>
                      <th className="py-2.5 px-3 text-right">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181F29]">
                    {visibleHistory.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-xs text-[#64748B] font-sans">
                          No closed demo trades yet.
                        </td>
                      </tr>
                    ) : (
                      visibleHistory.map((pos) => {
                        const won = pos.realizedPnlUsd >= 0;
                        return (
                          <tr key={pos.id} className="hover:bg-white/[0.025]">
                            <td className="py-2.5 px-3 font-bold text-white">{pos.displaySymbol}</td>
                            <td className="py-2.5 px-2.5">
                              <span className={pos.side === 'LONG' ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
                                {pos.side} {pos.leverage}x
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-[#CBD5E1]">
                              {formatPrice(pos.entryPrice, preferences.decimalPrecision)}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#EAECEF]">
                              {formatPrice(pos.currentPrice, preferences.decimalPrecision)}
                            </td>
                            <td className="py-2.5 px-2.5 text-[#CBD5E1]">${pos.notionalUsd.toFixed(2)}</td>
                            <td className={`py-2.5 px-2.5 font-bold ${won ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                              {won ? '+' : ''}
                              {pos.realizedPnlUsd.toFixed(2)} USDT
                            </td>
                            <td className="py-2.5 px-2.5 text-[#848E9C]">${pos.feesPaidUsd.toFixed(2)}</td>
                            <td className="py-2.5 px-2.5 text-[10.5px] text-[#94A3B8]">
                              {pos.exitReason || 'CLOSED'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-[10.5px] text-[#64748B]">
                              {pos.closedAt ? formatTimestamp(pos.closedAt, preferences.timezone, false) : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 4: ASSETS & PERFORMANCE */}
            {bottomTab === 'assets' && (
              <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 grid grid-cols-2 gap-3 font-mono tabular-nums">
                  <div className="p-3 rounded-xl bg-[#141A22] border border-[#1E2530]">
                    <div className="text-[10px] font-sans text-[#64748B]">Total Demo Equity</div>
                    <div className="text-base font-extrabold text-white mt-1">
                      ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141A22] border border-[#1E2530]">
                    <div className="text-[10px] font-sans text-[#64748B]">Available Balance</div>
                    <div className="text-base font-extrabold text-[#0ECB81] mt-1">
                      ${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141A22] border border-[#1E2530]">
                    <div className="text-[10px] font-sans text-[#64748B]">Win Rate</div>
                    <div className="text-base font-extrabold text-white mt-1">
                      {snapshot?.metrics.winRatePct != null
                        ? `${snapshot.metrics.winRatePct.toFixed(1)}%`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141A22] border border-[#1E2530]">
                    <div className="text-[10px] font-sans text-[#64748B]">Realized P&amp;L</div>
                    <div
                      className={`text-base font-extrabold mt-1 ${
                        (snapshot?.metrics.realizedPnlUsd ?? 0) >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                      }`}
                    >
                      {(snapshot?.metrics.realizedPnlUsd ?? 0) >= 0 ? '+' : ''}$
                      {(snapshot?.metrics.realizedPnlUsd ?? 0).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-7 rounded-xl bg-[#141A22] border border-[#1E2530] p-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] px-2">
                    Demo Equity Curve
                  </div>
                  <EChartBox option={equityChartOption} height={140} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ============ RIGHT COLUMN: PRO EXCHANGE DEMO TRADE PANEL ============ */}
        <aside className="bg-[#101419] border-t xl:border-t-0 xl:border-l border-[#1E2530] p-4 flex flex-col gap-4">
          {/* Panel Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-white">Trade</span>
              <span className="px-1.5 py-0.5 rounded bg-[#F7A600]/15 text-[#F7A600] text-[9.5px] font-bold uppercase">
                Demo
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#848E9C]">{compactTicker}</span>
          </div>

          {/* Margin Mode + Leverage Row */}
          <div className="grid grid-cols-2 gap-2 relative">
            <button
              type="button"
              onClick={() => setMarginMode((m) => (m === 'Cross' ? 'Isolated' : 'Cross'))}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1A2029] hover:bg-[#222A36] border border-[#26303D] text-xs font-bold text-[#EAECEF] transition-colors"
            >
              <span>{marginMode}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#848E9C]" />
            </button>

            <button
              type="button"
              onClick={() => setLeverageOpen((v) => !v)}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1A2029] hover:bg-[#222A36] border border-[#26303D] font-mono text-xs font-bold text-[#F7A600] transition-colors"
            >
              <span>{leverage.toFixed(2)}x</span>
              <Sliders className="w-3.5 h-3.5 text-[#848E9C]" />
            </button>

            {/* Leverage Selector Popover */}
            {leverageOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 p-3 rounded-xl bg-[#161C24] border border-[#2D3848] shadow-2xl z-40 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">Adjust Leverage</span>
                  <span className="font-mono font-extrabold text-[#F7A600]">{leverage}x</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full accent-[#F7A600]"
                />
                <div className="grid grid-cols-7 gap-1">
                  {LEVERAGE_PRESETS.map((lev) => (
                    <button
                      key={lev}
                      type="button"
                      onClick={() => setLeverage(lev)}
                      className={`py-1 rounded font-mono text-[10px] font-bold ${
                        leverage === lev
                          ? 'bg-[#F7A600] text-[#0B0E11]'
                          : 'bg-[#0B0E11] text-[#94A3B8] hover:text-white'
                      }`}
                    >
                      {lev}x
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setLeverageOpen(false)}
                  className="w-full py-1.5 rounded-lg bg-[#F7A600] text-[#0B0E11] text-xs font-extrabold"
                >
                  Confirm {leverage}x
                </button>
              </div>
            )}
          </div>

          {/* Order Type Tabs: Limit / Market */}
          <div className="flex items-center gap-4 border-b border-[#1E2530]">
            {(['Limit', 'Market'] as OrderMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setOrderMode(mode)}
                className={`pb-2 text-xs font-bold border-b-2 transition-colors ${
                  orderMode === mode
                    ? 'border-[#F7A600] text-[#F7A600]'
                    : 'border-transparent text-[#848E9C] hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Order Price Input (Limit vs Market) */}
          {orderMode === 'Limit' ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#848E9C]">
                <span>Order Price</span>
                <button
                  type="button"
                  onClick={() =>
                    currentPrice > 0 &&
                    setLimitPriceInput(formatPrice(currentPrice, preferences.decimalPrecision))
                  }
                  className="text-[#F7A600] font-semibold hover:underline"
                >
                  Last
                </button>
              </div>
              <div className="flex items-center rounded-lg bg-[#181E27] border border-[#26303D] focus-within:border-[#F7A600] px-3 py-2">
                <input
                  type="number"
                  step="any"
                  value={limitPriceInput}
                  onChange={(e) => setLimitPriceInput(e.target.value)}
                  className="w-full bg-transparent font-mono text-xs text-white focus:outline-none tabular-nums"
                  placeholder="0.00"
                />
                <span className="text-[11px] font-mono text-[#848E9C] ml-2">{quoteAsset}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg bg-[#141A22] border border-[#1E2530] px-3 py-2 text-xs">
              <span className="text-[#64748B]">Execution Price</span>
              <span className="font-mono font-bold text-[#CBD5E1]">
                Market (~${currentPrice > 0 ? formatPrice(currentPrice, preferences.decimalPrecision) : '—'})
              </span>
            </div>
          )}

          {/* Order Value / Size Input */}
          <div className="space-y-2">
            <div className="flex items-center rounded-lg bg-[#181E27] border border-[#26303D] focus-within:border-[#F7A600] px-3 py-2">
              <span className="text-[11px] text-[#64748B] mr-2 shrink-0">
                {sizeUnit === 'USDT' ? 'Value' : 'Qty'}
              </span>
              <input
                type="number"
                min="0"
                step="any"
                value={sizeInput}
                onChange={(e) => {
                  setSizeInput(e.target.value);
                  setSliderPct(0);
                }}
                className="w-full bg-transparent font-mono text-xs text-right text-white focus:outline-none tabular-nums"
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={() => setSizeUnit((u) => (u === 'USDT' ? 'BASE' : 'USDT'))}
                className="ml-2 pl-2 border-l border-[#26303D] text-[11px] font-mono font-bold text-[#EAECEF] hover:text-[#F7A600] flex items-center gap-0.5 shrink-0"
              >
                <span>{sizeUnit === 'USDT' ? 'USDT' : baseAsset}</span>
                <ChevronDown className="w-3 h-3 text-[#64748B]" />
              </button>
            </div>

            {/* 0% - 100% Quick Percentage Slider */}
            <div className="space-y-1.5 pt-1">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={sliderPct}
                onChange={(e) => handleSliderChange(Number(e.target.value))}
                className="w-full accent-[#F7A600] h-1.5 cursor-pointer"
              />
              <div className="flex items-center justify-between font-mono text-[10px] text-[#64748B]">
                {[0, 25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleSliderChange(pct)}
                    className={`px-1 rounded transition-colors ${
                      sliderPct === pct ? 'text-[#F7A600] font-bold' : 'hover:text-white'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quantity & Cost Summary Box */}
          <div className="rounded-xl bg-[#141A22] border border-[#1E2530] px-3 py-2.5 space-y-1.5 font-mono text-[11px] tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Quantity</span>
              <span className="text-[#EAECEF] font-semibold">
                {orderQty > 0 ? `${orderQty.toFixed(orderQty >= 10 ? 2 : 5)} ${baseAsset}` : `-- / -- ${baseAsset}`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Cost (Margin + Fee)</span>
              <span className="text-[#EAECEF] font-semibold">
                {totalCost > 0 ? `$${totalCost.toFixed(2)} USDT` : '-- / -- USDT'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Est. Liq. (L / S)</span>
              <span className="text-[10.5px]">
                <span className="text-[#0ECB81]">
                  {effectiveEntryPrice > 0
                    ? formatPrice(calcLiquidationPrice('LONG', effectiveEntryPrice, leverage), preferences.decimalPrecision)
                    : '—'}
                </span>
                <span className="text-[#475569]"> / </span>
                <span className="text-[#F6465D]">
                  {effectiveEntryPrice > 0
                    ? formatPrice(calcLiquidationPrice('SHORT', effectiveEntryPrice, leverage), preferences.decimalPrecision)
                    : '—'}
                </span>
              </span>
            </div>
          </div>

          {/* TP / SL Toggle + Auto-Fill Signal */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#CBD5E1] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={tpSlEnabled}
                  onChange={(e) => setTpSlEnabled(e.target.checked)}
                  className="accent-[#F7A600] rounded"
                />
                <span>TP/SL</span>
              </label>
              <button
                type="button"
                onClick={() => handleAutoFillSignalTpSl()}
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#F7A600] hover:underline"
              >
                <Sparkles className="w-3 h-3" />
                Auto-Fill Signal
              </button>
            </div>

            {tpSlEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-[#181E27] border border-[#26303D] focus-within:border-[#0ECB81] px-2.5 py-1.5">
                  <div className="text-[9.5px] text-[#0ECB81] font-bold uppercase">Take Profit</div>
                  <input
                    type="number"
                    step="any"
                    value={tpInput}
                    onChange={(e) => setTpInput(e.target.value)}
                    placeholder="Price"
                    className="w-full bg-transparent font-mono text-xs text-white focus:outline-none tabular-nums mt-0.5"
                  />
                </div>
                <div className="rounded-lg bg-[#181E27] border border-[#26303D] focus-within:border-[#F6465D] px-2.5 py-1.5">
                  <div className="text-[9.5px] text-[#F6465D] font-bold uppercase">Stop Loss</div>
                  <input
                    type="number"
                    step="any"
                    value={slInput}
                    onChange={(e) => setSlInput(e.target.value)}
                    placeholder="Price"
                    className="w-full bg-transparent font-mono text-xs text-white focus:outline-none tabular-nums mt-0.5"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Primary Long / Short Demo Action Buttons (Bybit Signature Style) */}
          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <button
              type="button"
              disabled={actionBusy || currentPrice <= 0}
              onClick={() => handlePlaceOrder('LONG')}
              className="py-2.5 px-3 rounded-full bg-[#0ECB81] hover:bg-[#13DF8F] disabled:opacity-50 text-[#0B0E11] transition-all flex flex-col items-center justify-center leading-tight shadow-[0_6px_20px_rgba(14,203,129,0.25)]"
            >
              <span className="text-xs font-extrabold flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                Long
              </span>
              <span className="text-[9.5px] font-bold opacity-80">Demo Trading</span>
            </button>

            <button
              type="button"
              disabled={actionBusy || currentPrice <= 0}
              onClick={() => handlePlaceOrder('SHORT')}
              className="py-2.5 px-3 rounded-full bg-[#F6465D] hover:bg-[#FF586E] disabled:opacity-50 text-white transition-all flex flex-col items-center justify-center leading-tight shadow-[0_6px_20px_rgba(246,70,93,0.25)]"
            >
              <span className="text-xs font-extrabold flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" />
                Short
              </span>
              <span className="text-[9.5px] font-bold opacity-85">Demo Trading</span>
            </button>
          </div>

          {/* Unified Demo Trading Account Card */}
          <div className="border-t border-[#1E2530] pt-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-[#F7A600]" />
                Unified Demo Account
              </span>
              <span className="text-[10.5px] font-semibold text-[#94A3B8]">{marginMode} Margin</span>
            </div>

            <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-sans">Margin Balance</span>
                <span className="text-white font-bold">
                  ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-sans">Available Balance</span>
                <span className="text-[#EAECEF] font-semibold">
                  ${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-sans">Margin Used</span>
                <span className="text-[#94A3B8]">
                  ${marginUsed.toFixed(2)} ({totalEquity > 0 ? ((marginUsed / totalEquity) * 100).toFixed(1) : '0.0'}%)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-sans">Unrealized P&amp;L</span>
                <span
                  className={`font-bold ${
                    totalUnrealizedPnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                  }`}
                >
                  {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFundsModalOpen((v) => !v)}
              className="w-full py-2 rounded-lg bg-[#1D2430] hover:bg-[#273040] border border-[#2C3748] text-xs font-bold text-[#EAECEF] transition-colors flex items-center justify-center gap-1.5"
            >
              <Coins className="w-3.5 h-3.5 text-[#F7A600]" />
              Request Demo Funds
            </button>

            {fundsModalOpen && (
              <div className="p-3 rounded-xl bg-[#161C24] border border-[#2A3444] space-y-2">
                <div className="text-[11px] font-bold text-white">Add or Reset Demo Balance</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => handleTopUpFunds(10000)}
                    className="py-1.5 rounded-lg bg-[#0ECB81]/20 hover:bg-[#0ECB81]/30 text-[#4ADE80] border border-[#0ECB81]/30 text-[11px] font-bold"
                  >
                    +$10,000 Top Up
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => handleTopUpFunds(50000)}
                    className="py-1.5 rounded-lg bg-[#0ECB81]/20 hover:bg-[#0ECB81]/30 text-[#4ADE80] border border-[#0ECB81]/30 text-[11px] font-bold"
                  >
                    +$50,000 Top Up
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-[#222B38]">
                  {[10000, 50000, 100000].map((bal) => (
                    <button
                      key={bal}
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleResetFunds(bal)}
                      className="py-1 rounded-md bg-[#0B0E11] hover:bg-[#1E2632] text-[#94A3B8] hover:text-white text-[10px] font-mono font-bold"
                    >
                      Reset ${(bal / 1000).toFixed(0)}k
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Contract Details Card (Bottom-Right Matching Screenshot) */}
          <div className="border-t border-[#1E2530] pt-3 space-y-1.5 font-mono text-[11px] tabular-nums">
            <div className="text-xs font-extrabold font-sans text-white flex items-center gap-1.5 mb-2">
              <Layers className="w-3.5 h-3.5 text-[#848E9C]" />
              Contract Details {compactTicker}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Venue</span>
              <span className="text-[#EAECEF]">{EXCHANGE_LABELS[exchange]}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Contract Type</span>
              <span className="text-[#EAECEF] capitalize">{marketType}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Index / Mark Price</span>
              <span className="text-[#EAECEF]">
                {currentPrice > 0 ? formatPrice(currentPrice, preferences.decimalPrecision) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B] font-sans">Est. Taker Fee</span>
              <span className="text-[#EAECEF]">{(feeBps / 100).toFixed(2)}%</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Inline TP/SL Editor Modal for Open Positions */}
      {editingPos && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingPos(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[#131820] border border-[#26303D] p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-extrabold text-white">
                  Edit TP / SL · {editingPos.displaySymbol}
                </div>
                <div className="text-[11px] text-[#848E9C] font-mono">
                  {editingPos.side} {editingPos.leverage}x · Entry ${formatPrice(editingPos.entryPrice, preferences.decimalPrecision)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPos(null)}
                className="p-1 text-[#848E9C] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-[#0ECB81] mb-1">
                  Take Profit Price (leave blank to clear)
                </label>
                <input
                  type="number"
                  step="any"
                  value={editTpVal}
                  onChange={(e) => setEditTpVal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#26303D] font-mono text-xs text-white focus:outline-none focus:border-[#0ECB81]"
                  placeholder="Optional TP price"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#F6465D] mb-1">
                  Stop Loss Price (leave blank to clear)
                </label>
                <input
                  type="number"
                  step="any"
                  value={editSlVal}
                  onChange={(e) => setEditSlVal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#26303D] font-mono text-xs text-white focus:outline-none focus:border-[#F6465D]"
                  placeholder="Optional SL price"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingPos(null)}
                className="px-3.5 py-2 rounded-lg bg-[#1C2430] text-xs font-bold text-[#CBD5E1]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleSavePositionTpSl}
                className="px-4 py-2 rounded-lg bg-[#F7A600] text-[#0B0E11] text-xs font-extrabold"
              >
                Save TP / SL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
