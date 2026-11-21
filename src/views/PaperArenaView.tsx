import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Download,
  OctagonAlert,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { EChartBox } from '../components/charts/EChartBox';
import {
  KINETIC_EASE,
  KineticCard,
  KineticMeterBar,
  KineticPrice,
  KineticSegmentedControl,
} from '../components/ui/Kinetic';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import {
  ALL_EXCHANGES,
  defaultMarketTypeFor,
  EXCHANGE_LABELS,
  QUICK_TIMEFRAMES,
} from '../shared/constants';
import { exportToCsv, formatPercent, formatPrice, formatTimestamp } from '../shared/format';
import type {
  ExchangeId,
  PaperArenaSnapshot,
  PaperBotDirectionMode,
  PaperSide,
  Timeframe,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type ArenaTab = 'arena' | 'bots' | 'journal' | 'risk';

const ARENA_TABS: { value: ArenaTab; label: string }[] = [
  { value: 'arena', label: 'Arena & Positions' },
  { value: 'bots', label: 'Autonomous Bots' },
  { value: 'journal', label: 'Journal & Audit' },
  { value: 'risk', label: 'Risk & Engine' },
];

const QUICK_SYMBOLS_BY_EXCHANGE: Record<ExchangeId, string[]> = {
  binance: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'LINK/USDT'],
  bybit: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
  kraken: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'],
  coinbase: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD'],
  stocks: ['AAPL/USD', 'NVDA/USD', 'MSFT/USD', 'TSLA/USD', 'AMZN/USD', 'META/USD', 'SPY/USD', 'QQQ/USD'],
  cfds: ['US500/USD', 'NAS100/USD', 'XAU/USD', 'XAG/USD', 'WTI/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY'],
};

const STRATEGY_PRESETS: {
  name: string;
  description: string;
  exchange: ExchangeId;
  timeframe: Timeframe;
  directionMode: PaperBotDirectionMode;
  minScore: number;
  minAgreementPct: number;
  riskPerTradePct: number;
  leverage: number;
  trailingStopAtrMult: number;
  partialTp1Pct: number;
}[] = [
  {
    name: 'Crypto Momentum Ignition',
    description: 'High-conviction Binance spot trend breakouts with 50% TP1 breakeven scaling and 1.5x ATR trail.',
    exchange: 'binance',
    timeframe: '1h',
    directionMode: 'BOTH',
    minScore: 35,
    minAgreementPct: 55,
    riskPerTradePct: 1.5,
    leverage: 2,
    trailingStopAtrMult: 1.5,
    partialTp1Pct: 50,
  },
  {
    name: 'US Equities Confluence Sniper',
    description: 'Multi-indicator US Stocks & ETF setups (AAPL, NVDA, MSFT, SPY, QQQ) with disciplined 1.25% risk.',
    exchange: 'stocks',
    timeframe: '1h',
    directionMode: 'BOTH',
    minScore: 30,
    minAgreementPct: 55,
    riskPerTradePct: 1.25,
    leverage: 1,
    trailingStopAtrMult: 1.5,
    partialTp1Pct: 50,
  },
  {
    name: 'Gold & Indices CFD Runner',
    description: 'Captures directional swings across US500, NAS100, XAU/USD Gold, WTI Oil & Major FX CFDs.',
    exchange: 'cfds',
    timeframe: '1h',
    directionMode: 'BOTH',
    minScore: 30,
    minAgreementPct: 55,
    riskPerTradePct: 1.5,
    leverage: 3,
    trailingStopAtrMult: 1.6,
    partialTp1Pct: 50,
  },
];

export const PaperArenaView: React.FC = () => {
  const preferences = useAppStore((s) => s.preferences);
  const globalExchange = useAppStore((s) => s.exchange);
  const globalSymbol = useAppStore((s) => s.symbol);
  const selectMarket = useAppStore((s) => s.selectMarket);

  const [tab, setTab] = useState<ArenaTab>('arena');
  const [snapshot, setSnapshot] = useState<PaperArenaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Quick manual paper order form state
  const [orderExchange, setOrderExchange] = useState<ExchangeId>(globalExchange);
  const [orderSymbol, setOrderSymbol] = useState<string>(globalSymbol || 'BTC/USDT');
  const [orderSide, setOrderSide] = useState<PaperSide>('LONG');
  const [orderRiskPct, setOrderRiskPct] = useState<number>(1.5);
  const [orderLeverage, setOrderLeverage] = useState<number>(2);

  // Custom Bot Builder state
  const [botName, setBotName] = useState('');
  const [botExchange, setBotExchange] = useState<ExchangeId>('binance');
  const [botTf, setBotTf] = useState<Timeframe>('1h');
  const [botDir, setBotDir] = useState<PaperBotDirectionMode>('BOTH');
  const [botMinScore, setBotMinScore] = useState<number>(35);
  const [botMinAgree, setBotMinAgree] = useState<number>(55);
  const [botRiskPct, setBotRiskPct] = useState<number>(1.5);
  const [botLev, setBotLev] = useState<number>(2);
  const [botTrailAtr, setBotTrailAtr] = useState<number>(1.5);
  const [botTp1Pct, setBotTp1Pct] = useState<number>(50);
  const [botCooldown, setBotCooldown] = useState<number>(45);

  // Account risk settings form state
  const [resetBalance, setResetBalance] = useState<number>(10000);

  const flashBanner = (kind: 'ok' | 'err', text: string) => {
    setBanner({ kind, text });
    window.setTimeout(() => setBanner(null), 4500);
  };

  const loadState = async (refresh = true) => {
    try {
      const data = await api.getPaperState(refresh);
      setSnapshot(data);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Unable to load paper arena state');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState(true);
    const id = window.setInterval(() => loadState(true), 20_000);
    return () => window.clearInterval(id);
  }, []);

  const handleRunCycle = async () => {
    setBusyAction('tick');
    try {
      const res = await api.runPaperTick();
      setSnapshot(res.snapshot);
      flashBanner(
        'ok',
        `Autonomous cycle complete: marked ${res.result.markedCount} open position(s), executed ${res.result.actionsTaken} action(s).`,
      );
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Cycle execution failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('order');
    try {
      const res = await api.openPaperOrder({
        exchange: orderExchange,
        marketType: defaultMarketTypeFor(orderExchange),
        symbol: orderSymbol.trim().toUpperCase(),
        timeframe: '1h',
        side: orderSide,
        riskPct: orderRiskPct,
        leverage: orderLeverage,
      });
      setSnapshot(res.snapshot);
      flashBanner(
        'ok',
        `Opened ${res.position.side} ${res.position.displaySymbol} @ $${formatPrice(res.position.entryPrice, preferences.decimalPrecision)} ($${res.position.notionalUsd.toFixed(0)} notional).`,
      );
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Order failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClosePos = async (id: string) => {
    setBusyAction(`close-${id}`);
    try {
      const res = await api.closePaperPosition(id);
      setSnapshot(res.snapshot);
      const pnl = res.position.realizedPnlUsd;
      flashBanner(
        'ok',
        `Closed ${res.position.displaySymbol} · Net PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      );
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Unable to close position');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEmergencyStop = async () => {
    setBusyAction('emergency');
    try {
      const res = await api.emergencyStopPaper();
      setSnapshot(res.snapshot);
      flashBanner(
        'ok',
        `Emergency Stop executed: flattened ${res.summary.closedCount} position(s) and paused ${res.summary.pausedBots} bot(s).`,
      );
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Emergency stop failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botName.trim()) return;
    setBusyAction('create-bot');
    try {
      await api.createPaperBot({
        name: botName.trim(),
        exchange: botExchange,
        marketType: defaultMarketTypeFor(botExchange),
        timeframe: botTf,
        enabled: true,
        directionMode: botDir,
        minScore: botMinScore,
        minAgreementPct: botMinAgree,
        riskPerTradePct: botRiskPct,
        leverage: botLev,
        trailingStopAtrMult: botTrailAtr > 0 ? botTrailAtr : null,
        partialTp1Pct: botTp1Pct,
        cooldownMinutes: botCooldown,
      });
      setBotName('');
      await loadState(false);
      flashBanner('ok', 'Autonomous strategy bot deployed and active.');
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to deploy bot');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeployPreset = async (preset: (typeof STRATEGY_PRESETS)[number]) => {
    setBusyAction(`preset-${preset.name}`);
    try {
      await api.createPaperBot({
        ...preset,
        marketType: defaultMarketTypeFor(preset.exchange),
        enabled: true,
        cooldownMinutes: 45,
      });
      await loadState(false);
      flashBanner('ok', `Deployed "${preset.name}" — click Run Cycle Now or wait for the 35s engine tick.`);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to deploy preset');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleBot = async (id: string, enabled: boolean) => {
    setBusyAction(`bot-${id}`);
    try {
      await api.updatePaperBot(id, { enabled });
      await loadState(false);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteBot = async (id: string) => {
    setBusyAction(`del-${id}`);
    try {
      await api.deletePaperBot(id);
      await loadState(false);
      flashBanner('ok', 'Bot removed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateRisk = async (patch: Parameters<typeof api.updatePaperAccount>[0]) => {
    try {
      await api.updatePaperAccount(patch);
      await loadState(false);
      flashBanner('ok', 'Risk engine parameters updated.');
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Failed to save risk config');
    }
  };

  const handleResetAccount = async () => {
    setBusyAction('reset');
    try {
      const res = await api.resetPaperAccount(resetBalance);
      setSnapshot(res.snapshot);
      flashBanner('ok', `Paper account cleanly reset to $${resetBalance.toLocaleString('en-US')}.`);
    } catch (err) {
      flashBanner('err', err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusyAction(null);
    }
  };

  // Live Equity Curve ECharts Option (Roboto)
  const equityChartOption = useMemo<EChartsOption>(() => {
    const pts = snapshot?.equityCurve ?? [];
    const labels = pts.map((p) => formatTimestamp(p.timestamp, preferences.timezone, false));
    const vals = pts.map((p) => p.equityUsd);
    const startBal = snapshot?.account.startingBalanceUsd ?? 10000;
    const minVal = vals.length ? Math.min(...vals, startBal) : startBal * 0.99;
    const maxVal = vals.length ? Math.max(...vals, startBal) : startBal * 1.01;
    const pad = Math.max((maxVal - minVal) * 0.25, startBal * 0.004);
    const latest = vals.length ? vals[vals.length - 1] : startBal;
    const isUp = latest >= startBal;
    const stroke = isUp ? '#059669' : '#E11D48';

    return {
      animation: true,
      animationDuration: 380,
      grid: { left: 10, right: 66, top: 18, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0A0D14',
        borderColor: '#1E2534',
        textStyle: { color: '#FFFFFF', fontFamily: 'Roboto, sans-serif', fontSize: 11 },
        formatter: (params: unknown) => {
          const item = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number; value?: number };
          const idx = item?.dataIndex ?? 0;
          const v = typeof item?.value === 'number' ? item.value : startBal;
          const delta = v - startBal;
          return `<div style="font-family:'Roboto',sans-serif;">
            <div style="font-size:10px;color:#94A3B8;">${labels[idx] ?? ''}</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px;">$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div style="font-size:10px;color:${delta >= 0 ? '#34D399' : '#FB7185'};">${delta >= 0 ? '+' : ''}$${delta.toFixed(2)}</div>
          </div>`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#7C8798', fontFamily: 'Roboto, sans-serif', fontSize: 9 },
        splitLine: { show: true, lineStyle: { color: '#F1F3F7' } },
      },
      yAxis: {
        type: 'value',
        position: 'right',
        min: minVal - pad,
        max: maxVal + pad,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#7C8798',
          fontFamily: 'Roboto, sans-serif',
          fontSize: 9,
          formatter: (v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(2)}K` : v.toFixed(0)}`,
        },
        splitLine: { show: true, lineStyle: { color: '#ECEFF4', type: 'dashed' } },
      },
      series: [
        {
          type: 'line',
          smooth: 0.25,
          showSymbol: pts.length <= 3,
          symbolSize: 6,
          data: vals,
          lineStyle: { width: 2.25, color: stroke },
          itemStyle: { color: '#FFFFFF', borderColor: stroke, borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: isUp ? 'rgba(5,150,105,0.16)' : 'rgba(225,29,72,0.16)' },
                { offset: 1, color: 'rgba(255,255,255,0)' },
              ],
            },
          },
        },
      ],
    };
  }, [snapshot, preferences.timezone]);

  if (loading && !snapshot) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <SkeletonBlock className="h-80" />
      </div>
    );
  }

  const acc = snapshot?.account;
  const m = snapshot?.metrics;
  const pnlPos = (m?.totalPnlUsd ?? 0) >= 0;
  const capitalUsedPct =
    m && m.totalEquityUsd > 0 ? Math.min(100, (m.marginUsedUsd / m.totalEquityUsd) * 100) : 0;
  const ddRatioPct =
    acc && m && acc.maxDailyDrawdownPct > 0
      ? Math.min(100, (m.dailyDrawdownPct / acc.maxDailyDrawdownPct) * 100)
      : 0;

  return (
    <div className="space-y-5">
      {/* Top Arena Command Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-[#0A0D14] text-white flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold tracking-tight text-[#0A0D14]">
              Autonomous Paper-Trading Arena
            </h1>
            {acc?.killSwitchTriggered ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FFF1F2] border border-[#FECDD3] text-[10px] font-bold text-[#BE123C]">
                <ShieldAlert className="w-3 h-3" />
                KILL-SWITCH TRIPPED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[10px] font-bold text-[#047857]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#059669]" />
                {m?.activeBotsCount ?? 0} ACTIVE BOT{(m?.activeBotsCount ?? 0) === 1 ? '' : 'S'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#64748B]">
            100% real-price paper execution with live fees ({acc?.feeBps ?? 10} bps), slippage ({acc?.slippageBps ?? 5} bps), TP1 breakeven scaling &amp; trailing ATR stops across Crypto, US Stocks &amp; CFDs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleRunCycle}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full sig-btn-primary text-[11px] font-bold disabled:opacity-60"
          >
            <Zap className={`w-3.5 h-3.5 ${busyAction === 'tick' ? 'animate-pulse' : ''}`} />
            {busyAction === 'tick' ? 'Scanning...' : 'Run Cycle Now'}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => loadState(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full sig-glass-subtle text-[11px] font-semibold text-[#4B5565] hover:text-[#0A0D14]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleEmergencyStop}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#E11D48] hover:bg-[#BE123C] text-white text-[11px] font-bold transition-colors disabled:opacity-60"
          >
            <OctagonAlert className="w-3.5 h-3.5" />
            Emergency Stop
          </button>
        </div>
      </div>

      {/* Live Feedback Banner */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: KINETIC_EASE }}
            className={`rounded-2xl px-4 py-2.5 text-xs font-medium flex items-center justify-between gap-3 border ${
              banner.kind === 'ok'
                ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                : 'bg-[#FFF1F2] border-[#FECDD3] text-[#BE123C]'
            }`}
          >
            <span className="flex items-center gap-2">
              {banner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
              {banner.text}
            </span>
            <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss notice">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Row 1: 4 Minimal Kinetic Portfolio KPI Tiles */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KineticCard delay={0} surface="dark" interactive className="rounded-[22px] px-5 py-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9BB0A3]">
            <span>Total Equity</span>
            <span>Paper Balance</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <KineticPrice
              darkSurface
              value={m?.totalEquityUsd}
              formatted={`$${(m?.totalEquityUsd ?? 10000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              className="text-xl font-bold text-white"
            />
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                pnlPos ? 'bg-[#22C55E]/20 text-[#4ADE80]' : 'bg-[#F43F5E]/20 text-[#FB7185]'
              }`}
            >
              {pnlPos ? '+' : ''}
              ${(m?.totalPnlUsd ?? 0).toFixed(2)} ({formatPercent(m?.totalPnlPct ?? 0)})
            </span>
          </div>
          <div className="text-[10px] text-[#7D9486]">
            Unrealized: {(m?.unrealizedPnlUsd ?? 0) >= 0 ? '+' : ''}${(m?.unrealizedPnlUsd ?? 0).toFixed(2)} · Fees: ${(m?.totalFeesUsd ?? 0).toFixed(2)}
          </div>
        </KineticCard>

        <KineticCard delay={0.04} interactive className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
            <span>Available Cash</span>
            <span>{m?.openPositionsCount ?? 0}/{acc?.maxOpenPositions ?? 5} Open</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold tabular-nums text-[#0A0D14]">
              ${(acc?.cashBalanceUsd ?? 10000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] font-semibold text-[#2563EB]">
              Margin ${(m?.marginUsedUsd ?? 0).toFixed(0)}
            </span>
          </div>
          <KineticMeterBar pct={capitalUsedPct} barClassName="bg-[#0A0D14]" delay={0.06} />
        </KineticCard>

        <KineticCard delay={0.08} interactive className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
            <span>Win Rate &amp; PF</span>
            <span>{m?.closedTradesCount ?? 0} Closed</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold tabular-nums text-[#0A0D14]">
              {m && m.closedTradesCount > 0 ? `${m.winRatePct.toFixed(1)}%` : '—'}
            </span>
            <span className="text-[10px] font-semibold text-[#4B5565]">
              PF {m?.profitFactor !== null && m?.profitFactor !== undefined ? m.profitFactor.toFixed(2) : '—'} · AvgR {m?.avgRMultiple !== null && m?.avgRMultiple !== undefined ? `${m.avgRMultiple}R` : '—'}
            </span>
          </div>
          <KineticMeterBar
            pct={m?.closedTradesCount ? m.winRatePct : 0}
            barClassName="bg-[#059669]"
            delay={0.1}
          />
        </KineticCard>

        <KineticCard delay={0.12} interactive className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
            <span>Daily Drawdown Guard</span>
            <span>Max {acc?.maxDailyDrawdownPct ?? 6}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-xl font-bold tabular-nums ${
                (m?.dailyDrawdownPct ?? 0) > (acc?.maxDailyDrawdownPct ?? 6) * 0.65
                  ? 'text-[#E11D48]'
                  : 'text-[#0A0D14]'
              }`}
            >
              {(m?.dailyDrawdownPct ?? 0).toFixed(2)}%
            </span>
            {acc?.killSwitchTriggered ? (
              <button
                type="button"
                onClick={() => handleUpdateRisk({ killSwitchTriggered: false })}
                className="px-2 py-0.5 rounded-full bg-[#0A0D14] text-white text-[10px] font-bold"
              >
                Re-Arm
              </button>
            ) : (
              <span className="text-[10px] text-[#7C8798]">
                MaxDD {(m?.maxDrawdownPct ?? 0).toFixed(2)}%
              </span>
            )}
          </div>
          <KineticMeterBar
            pct={ddRatioPct}
            barClassName={ddRatioPct >= 75 ? 'bg-[#E11D48]' : 'bg-[#2563EB]'}
            delay={0.14}
          />
        </KineticCard>
      </section>

      {/* Kinetic Workspace Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KineticSegmentedControl
          options={ARENA_TABS}
          value={tab}
          onChange={setTab}
          layoutId="arena-main-tabs"
        />
        {snapshot?.lastCycleAt && (
          <span className="text-[10px] text-[#7C8798]">
            Last engine tick: {formatTimestamp(snapshot.lastCycleAt, preferences.timezone, false)}
          </span>
        )}
      </div>

      {/* TAB 1: ARENA & OPEN POSITIONS */}
      {tab === 'arena' && (
        <div className="space-y-5">
          {/* Equity Curve (7) + Strategy Leaderboard (5) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <KineticCard className="lg:col-span-7 rounded-2xl p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-sm font-bold text-[#0A0D14]">Live Equity Curve</h2>
                  <p className="text-[11px] text-[#7C8798]">
                    Persisted SQLite equity snapshots from real live market fills &amp; mark-to-market updates
                  </p>
                </div>
                <span className="px-2.5 py-0.5 rounded-full sig-glass-subtle text-[10px] font-semibold text-[#4B5565]">
                  {snapshot?.equityCurve.length ?? 0} pts
                </span>
              </div>
              <EChartBox option={equityChartOption} height={240} />
            </KineticCard>

            <KineticCard className="lg:col-span-5 rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-[#2563EB]" />
                  <h2 className="text-sm font-bold text-[#0A0D14]">Strategy Leaderboard</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('bots')}
                  className="text-[11px] font-bold text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  + Deploy Bot
                </button>
              </div>
              {(snapshot?.botLeaderboard ?? []).length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4 rounded-xl bg-[#F7F8FA] border border-dashed border-[#DCE0E8] space-y-2">
                  <Bot className="w-6 h-6 text-[#7C8798]" />
                  <div className="text-xs font-bold text-[#0A0D14]">No Autonomous Bots Deployed Yet</div>
                  <p className="text-[11px] text-[#64748B] max-w-xs">
                    Deploy a Crypto, US Stocks, or Global CFDs strategy bot to compete live on real market feeds.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('bots')}
                    className="mt-1 px-3.5 py-1.5 rounded-full sig-btn-primary text-[11px] font-bold"
                  >
                    Open Bot Builder
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[#F1F3F7] overflow-y-auto max-h-[240px]">
                  {snapshot!.botLeaderboard.map((row, idx) => (
                    <div key={row.botId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-[#7C8798]">#{idx + 1}</span>
                          <span className="font-bold text-[#0A0D14] truncate">{row.botName}</span>
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              row.enabled ? 'bg-[#059669]' : 'bg-[#CBD5E1]'
                            }`}
                          />
                        </div>
                        <div className="text-[10px] text-[#7C8798] mt-0.5">
                          {EXCHANGE_LABELS[row.exchange]} · {row.timeframe} · {row.openCount} open · {row.closedCount} closed ({row.winRatePct.toFixed(0)}% W)
                        </div>
                      </div>
                      <span
                        className={`font-bold tabular-nums shrink-0 ${
                          row.totalPnlUsd >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'
                        }`}
                      >
                        {row.totalPnlUsd >= 0 ? '+' : ''}${row.totalPnlUsd.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </KineticCard>
          </div>

          {/* Quick Live Paper Order Bar */}
          <KineticCard className="rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-[#0A0D14]">Live Paper Order Terminal</h2>
                <p className="text-[11px] text-[#7C8798]">
                  Executes immediately at live exchange/market price with automatic ATR Stop Loss, TP1–TP3 &amp; trailing stop
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(QUICK_SYMBOLS_BY_EXCHANGE[orderExchange] ?? []).slice(0, 6).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setOrderSymbol(sym)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                      orderSymbol === sym
                        ? 'bg-[#0A0D14] text-white border-[#0A0D14]'
                        : 'bg-[#F7F8FA] text-[#4B5565] border-[#E6E8EE] hover:border-[#0A0D14]'
                    }`}
                  >
                    {sym.split('/')[0]}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleOpenOrder} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5 text-xs items-end">
              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Asset Venue</span>
                <select
                  value={orderExchange}
                  onChange={(e) => {
                    const ex = e.target.value as ExchangeId;
                    setOrderExchange(ex);
                    setOrderSymbol(QUICK_SYMBOLS_BY_EXCHANGE[ex][0]);
                  }}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA] text-xs font-semibold"
                >
                  {ALL_EXCHANGES.map((ex) => (
                    <option key={ex} value={ex}>
                      {EXCHANGE_LABELS[ex]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Symbol</span>
                <input
                  type="text"
                  value={orderSymbol}
                  onChange={(e) => setOrderSymbol(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA] text-xs font-bold uppercase"
                  placeholder="BTC/USDT"
                  required
                />
              </label>

              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Side</span>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F2F4F7] border border-[#E6E8EE]">
                  <button
                    type="button"
                    onClick={() => setOrderSide('LONG')}
                    className={`py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      orderSide === 'LONG' ? 'bg-[#059669] text-white' : 'text-[#4B5565]'
                    }`}
                  >
                    LONG
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderSide('SHORT')}
                    className={`py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      orderSide === 'SHORT' ? 'bg-[#E11D48] text-white' : 'text-[#4B5565]'
                    }`}
                  >
                    SHORT
                  </button>
                </div>
              </div>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Risk %</span>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max={acc?.maxRiskPerTradePct ?? 5}
                  value={orderRiskPct}
                  onChange={(e) => setOrderRiskPct(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA] text-xs font-bold"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Leverage</span>
                <select
                  value={orderLeverage}
                  onChange={(e) => setOrderLeverage(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA] text-xs font-bold"
                >
                  {[1, 2, 3, 5, 10].map((lv) => (
                    <option key={lv} value={lv}>
                      {lv}x
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={busyAction !== null || acc?.killSwitchTriggered}
                className={`col-span-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50 ${
                  orderSide === 'LONG'
                    ? 'bg-[#059669] hover:bg-[#047857]'
                    : 'bg-[#E11D48] hover:bg-[#BE123C]'
                }`}
              >
                {busyAction === 'order' ? 'Executing...' : `Execute Live ${orderSide}`}
              </button>
            </form>
          </KineticCard>

          {/* Open Positions Table */}
          <KineticCard className="rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-bold text-[#0A0D14]">
                Open Paper Positions ({snapshot?.openPositions.length ?? 0})
              </h2>
              <span className="text-[10px] text-[#7C8798]">
                Auto-managed every 35s · SL / Trailing ATR / TP1 Breakeven / TP2
              </span>
            </div>

            {(snapshot?.openPositions ?? []).length === 0 ? (
              <div className="py-10 text-center text-xs text-[#7C8798] rounded-xl bg-[#F7F8FA] border border-dashed border-[#DCE0E8]">
                No open positions yet. Execute a live paper order above or deploy an Autonomous Bot.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#ECEFF4] text-[10px] uppercase text-[#7C8798]">
                      <th className="py-2 text-left">Instrument</th>
                      <th className="py-2 text-left">Bot / Side</th>
                      <th className="py-2 text-right">Entry</th>
                      <th className="py-2 text-right">Live Price</th>
                      <th className="py-2 text-right">Size / Lev</th>
                      <th className="py-2 text-right">SL / Targets</th>
                      <th className="py-2 text-right">Unrealized PnL</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F3F7] tabular-nums">
                    {snapshot!.openPositions.map((p) => {
                      const up = p.unrealizedPnlUsd >= 0;
                      return (
                        <tr key={p.id} className="hover:bg-[#F7F8FA] transition-colors">
                          <td className="py-3 pr-2">
                            <button
                              type="button"
                              onClick={() => selectMarket(p.exchange, p.marketType, p.displaySymbol, true)}
                              className="text-left group"
                            >
                              <div className="font-bold text-[#0A0D14] group-hover:text-[#2563EB]">
                                {p.displaySymbol}
                              </div>
                              <div className="text-[10px] text-[#7C8798]">
                                {EXCHANGE_LABELS[p.exchange]} · {p.timeframe}
                              </div>
                            </button>
                          </td>
                          <td className="py-3 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  p.side === 'LONG'
                                    ? 'bg-[#ECFDF5] text-[#059669]'
                                    : 'bg-[#FFF1F2] text-[#E11D48]'
                                }`}
                              >
                                {p.side}
                              </span>
                              {p.tp1Hit && (
                                <span className="px-1.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#2563EB] text-[9px] font-bold">
                                  TP1 · BE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#64748B] mt-0.5 truncate max-w-[150px]">
                              {p.botName}
                            </div>
                          </td>
                          <td className="py-3 text-right font-semibold text-[#4B5565]">
                            ${formatPrice(p.entryPrice, preferences.decimalPrecision)}
                          </td>
                          <td className="py-3 text-right font-bold text-[#0A0D14]">
                            <KineticPrice
                              value={p.currentPrice}
                              formatted={`$${formatPrice(p.currentPrice, preferences.decimalPrecision)}`}
                            />
                          </td>
                          <td className="py-3 text-right text-[#4B5565]">
                            <div>${(p.remainingQuantity * p.currentPrice).toFixed(0)}</div>
                            <div className="text-[10px] text-[#7C8798]">{p.leverage}x · Mgn ${p.marginUsd.toFixed(0)}</div>
                          </td>
                          <td className="py-3 text-right text-[10px]">
                            <div className="text-[#E11D48] font-semibold">
                              SL {p.stopLoss ? `$${formatPrice(p.stopLoss, preferences.decimalPrecision)}` : '—'}
                            </div>
                            <div className="text-[#059669]">
                              TP1 {p.tp1 ? `$${formatPrice(p.tp1, preferences.decimalPrecision)}` : '—'}
                              {p.tp2 ? ` · TP2 $${formatPrice(p.tp2, preferences.decimalPrecision)}` : ''}
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <div className={`font-bold ${up ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                              {up ? '+' : ''}${p.unrealizedPnlUsd.toFixed(2)}
                            </div>
                            <div className={`text-[10px] ${up ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                              {formatPercent(p.unrealizedPnlPct)}
                            </div>
                          </td>
                          <td className="py-3 text-right pl-2">
                            <button
                              type="button"
                              disabled={busyAction === `close-${p.id}`}
                              onClick={() => handleClosePos(p.id)}
                              className="px-2.5 py-1 rounded-full border border-[#DCE0E8] hover:border-[#E11D48] hover:text-[#E11D48] text-[10px] font-bold transition-colors"
                            >
                              Close
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </KineticCard>
        </div>
      )}

      {/* TAB 2: AUTONOMOUS BOTS */}
      {tab === 'bots' && (
        <div className="space-y-5">
          {/* Quick-Deploy Strategy Presets */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {STRATEGY_PRESETS.map((preset) => (
              <KineticCard key={preset.name} interactive className="rounded-2xl p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-[#F2F4F7] border border-[#E6E8EE] text-[10px] font-bold text-[#0A0D14]">
                      {EXCHANGE_LABELS[preset.exchange]} · {preset.timeframe}
                    </span>
                    <span className="text-[10px] font-semibold text-[#2563EB]">
                      {preset.leverage}x · {preset.riskPerTradePct}% Risk
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-[#0A0D14]">{preset.name}</h3>
                  <p className="text-[11px] text-[#64748B] leading-relaxed">{preset.description}</p>
                </div>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleDeployPreset(preset)}
                  className="w-full py-2 rounded-xl sig-btn-primary text-[11px] font-bold flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Deploy Strategy Bot
                </button>
              </KineticCard>
            ))}
          </div>

          {/* Custom Autonomous Bot Builder */}
          <KineticCard className="rounded-2xl p-5">
            <h2 className="text-sm font-bold text-[#0A0D14] mb-3">Custom Autonomous Strategy Builder</h2>
            <form onSubmit={handleCreateBot} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Bot Name</span>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="e.g. Aggressive Scalper 15m"
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                  required
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Asset Universe</span>
                <select
                  value={botExchange}
                  onChange={(e) => setBotExchange(e.target.value as ExchangeId)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                >
                  {ALL_EXCHANGES.map((ex) => (
                    <option key={ex} value={ex}>
                      {EXCHANGE_LABELS[ex]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Timeframe</span>
                <select
                  value={botTf}
                  onChange={(e) => setBotTf(e.target.value as Timeframe)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                >
                  {QUICK_TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Direction Mode</span>
                <select
                  value={botDir}
                  onChange={(e) => setBotDir(e.target.value as PaperBotDirectionMode)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                >
                  <option value="BOTH">Long &amp; Short</option>
                  <option value="LONG_ONLY">Long Only</option>
                  <option value="SHORT_ONLY">Short Only</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Min Signal Score (20–90)</span>
                <input
                  type="number"
                  min="20"
                  max="90"
                  value={botMinScore}
                  onChange={(e) => setBotMinScore(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Min Agreement %</span>
                <input
                  type="number"
                  min="40"
                  max="95"
                  value={botMinAgree}
                  onChange={(e) => setBotMinAgree(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Risk / Trade % · Leverage</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="10"
                    value={botRiskPct}
                    onChange={(e) => setBotRiskPct(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                  />
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={botLev}
                    onChange={(e) => setBotLev(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                  />
                </div>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-[#64748B]">Trail ATR · TP1 Scale %</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={botTrailAtr}
                    onChange={(e) => setBotTrailAtr(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                  />
                  <input
                    type="number"
                    step="10"
                    min="0"
                    max="80"
                    value={botTp1Pct}
                    onChange={(e) => setBotTp1Pct(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                  />
                </div>
              </label>

              <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-2 text-[11px] text-[#64748B]">
                  <span>Re-entry Cooldown (min):</span>
                  <input
                    type="number"
                    min="5"
                    max="1440"
                    value={botCooldown}
                    onChange={(e) => setBotCooldown(Number(e.target.value))}
                    className="w-20 px-2 py-1 rounded-lg border border-[#E6E8EE] bg-[#F7F8FA] text-[#0A0D14]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="px-5 py-2 rounded-full sig-btn-primary text-xs font-bold"
                >
                  Create &amp; Activate Bot
                </button>
              </div>
            </form>
          </KineticCard>

          {/* Deployed Bots List */}
          <KineticCard className="rounded-2xl p-5">
            <h2 className="text-sm font-bold text-[#0A0D14] mb-3">
              Deployed Bots ({snapshot?.bots.length ?? 0})
            </h2>
            {(snapshot?.bots ?? []).length === 0 ? (
              <div className="py-8 text-center text-xs text-[#7C8798]">
                No bots created yet. Use one of the quick-deploy templates or the custom builder above.
              </div>
            ) : (
              <div className="space-y-3">
                {snapshot!.bots.map((bot) => (
                  <div
                    key={bot.id}
                    className="rounded-2xl border border-[#E6E8EE] bg-[#F7F8FA] p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-[#0A0D14]">{bot.name}</span>
                        <span className="px-2 py-0.5 rounded-full bg-white border border-[#E6E8EE] text-[10px] font-semibold text-[#4B5565]">
                          {EXCHANGE_LABELS[bot.exchange]} · {bot.timeframe} · {bot.directionMode}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            bot.enabled
                              ? 'bg-[#ECFDF5] text-[#059669]'
                              : 'bg-[#F1F5F9] text-[#64748B]'
                          }`}
                        >
                          {bot.enabled ? 'RUNNING' : 'PAUSED'}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#64748B]">
                        Score ≥ {bot.minScore} · Agree ≥ {bot.minAgreementPct}% · Risk {bot.riskPerTradePct}% · {bot.leverage}x · Trail {bot.trailingStopAtrMult ? `${bot.trailingStopAtrMult}×ATR` : 'Off'} · TP1 Scale {bot.partialTp1Pct}%
                      </div>
                      {bot.lastActionNote && (
                        <div className="text-[11px] text-[#0A0D14]">
                          <span className="text-[#7C8798]">Last tick: </span>
                          {bot.lastActionNote}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleToggleBot(bot.id, !bot.enabled)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                          bot.enabled
                            ? 'bg-white border border-[#DCE0E8] text-[#4B5565] hover:text-[#0A0D14]'
                            : 'bg-[#059669] text-white'
                        }`}
                      >
                        {bot.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        {bot.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleDeleteBot(bot.id)}
                        aria-label={`Delete ${bot.name}`}
                        className="p-2 rounded-full border border-[#E6E8EE] bg-white text-[#7C8798] hover:text-[#E11D48] hover:border-[#FECDD3]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </KineticCard>
        </div>
      )}

      {/* TAB 3: JOURNAL & AUDIT LOG */}
      {tab === 'journal' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <KineticCard className="xl:col-span-8 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-bold text-[#0A0D14]">
                Closed Trade Journal ({snapshot?.closedTrades.length ?? 0})
              </h2>
              {(snapshot?.closedTrades.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    exportToCsv(
                      'siglens-paper-journal.csv',
                      ['Symbol', 'Exchange', 'Side', 'Bot', 'Entry', 'Exit', 'Notional', 'Fees', 'NetPnL', 'ExitReason', 'ClosedAt'],
                      snapshot!.closedTrades.map((t) => [
                        t.displaySymbol,
                        t.exchange,
                        t.side,
                        t.botName,
                        t.entryPrice,
                        t.currentPrice,
                        t.notionalUsd.toFixed(2),
                        t.feesPaidUsd.toFixed(2),
                        t.realizedPnlUsd.toFixed(2),
                        t.exitReason,
                        t.closedAt ? new Date(t.closedAt).toISOString() : '',
                      ]),
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sig-glass-subtle text-[11px] font-semibold text-[#4B5565] hover:text-[#0A0D14]"
                >
                  <Download className="w-3 h-3" />
                  Export CSV
                </button>
              )}
            </div>

            {(snapshot?.closedTrades ?? []).length === 0 ? (
              <div className="py-10 text-center text-xs text-[#7C8798]">
                No closed trades recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#ECEFF4] text-[10px] uppercase text-[#7C8798]">
                      <th className="py-2 text-left">Pair</th>
                      <th className="py-2 text-left">Side · Bot</th>
                      <th className="py-2 text-right">Entry → Exit</th>
                      <th className="py-2 text-right">Reason</th>
                      <th className="py-2 text-right">Net PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F3F7] tabular-nums">
                    {snapshot!.closedTrades.map((t) => {
                      const win = t.realizedPnlUsd >= 0;
                      return (
                        <tr key={t.id}>
                          <td className="py-2.5 pr-2">
                            <div className="font-bold text-[#0A0D14]">{t.displaySymbol}</div>
                            <div className="text-[10px] text-[#7C8798]">
                              {t.closedAt ? formatTimestamp(t.closedAt, preferences.timezone, false) : '—'}
                            </div>
                          </td>
                          <td className="py-2.5 pr-2">
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                                t.side === 'LONG' ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FFF1F2] text-[#E11D48]'
                              }`}
                            >
                              {t.side}
                            </span>
                            <span className="ml-1.5 text-[10px] text-[#64748B]">{t.botName}</span>
                          </td>
                          <td className="py-2.5 text-right text-[#4B5565]">
                            ${formatPrice(t.entryPrice, preferences.decimalPrecision)} → ${formatPrice(t.currentPrice, preferences.decimalPrecision)}
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="px-2 py-0.5 rounded-full bg-[#F2F4F7] text-[9px] font-semibold text-[#4B5565]">
                              {t.exitReason ?? 'CLOSED'}
                            </span>
                          </td>
                          <td className={`py-2.5 text-right font-bold ${win ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                            {win ? '+' : ''}${t.realizedPnlUsd.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </KineticCard>

          <KineticCard className="xl:col-span-4 rounded-2xl p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-[#2563EB]" />
              <h2 className="text-sm font-bold text-[#0A0D14]">Engine Audit Stream</h2>
            </div>
            <div className="divide-y divide-[#F1F3F7] overflow-y-auto max-h-[380px]">
              {(snapshot?.recentLogs ?? []).length === 0 ? (
                <div className="py-8 text-center text-xs text-[#7C8798]">No engine logs yet.</div>
              ) : (
                snapshot!.recentLogs.map((log) => (
                  <div key={log.id} className="py-2.5 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-bold text-[10px] ${
                          log.level === 'TRADE'
                            ? 'text-[#2563EB]'
                            : log.level === 'WARN'
                              ? 'text-[#E11D48]'
                              : 'text-[#4B5565]'
                        }`}
                      >
                        {log.botName}
                      </span>
                      <span className="text-[9px] text-[#7C8798]">
                        {formatTimestamp(log.timestamp, preferences.timezone, false)}
                      </span>
                    </div>
                    <div className="text-[#0A0D14] leading-snug">{log.message}</div>
                  </div>
                ))
              )}
            </div>
          </KineticCard>
        </div>
      )}

      {/* TAB 4: RISK & ENGINE SETTINGS */}
      {tab === 'risk' && acc && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <KineticCard className="lg:col-span-7 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#0A0D14]">Global Risk &amp; Execution Guardrails</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="font-semibold text-[#4B5565]">Max Risk Per Trade (%)</span>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="10"
                  defaultValue={acc.maxRiskPerTradePct}
                  onBlur={(e) => handleUpdateRisk({ maxRiskPerTradePct: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-[#4B5565]">Max Concurrent Open Positions</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  defaultValue={acc.maxOpenPositions}
                  onBlur={(e) => handleUpdateRisk({ maxOpenPositions: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-[#4B5565]">Daily Drawdown Kill-Switch (%)</span>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  defaultValue={acc.maxDailyDrawdownPct}
                  onBlur={(e) => handleUpdateRisk({ maxDailyDrawdownPct: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-[#4B5565]">Default Leverage (1x–10x)</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  defaultValue={acc.defaultLeverage}
                  onBlur={(e) => handleUpdateRisk({ defaultLeverage: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-[#4B5565]">Exchange Taker Fee (bps)</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  defaultValue={acc.feeBps}
                  onBlur={(e) => handleUpdateRisk({ feeBps: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-[#4B5565]">Execution Slippage (bps)</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  defaultValue={acc.slippageBps}
                  onBlur={(e) => handleUpdateRisk({ slippageBps: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA]"
                />
              </label>
            </div>
          </KineticCard>

          <KineticCard className="lg:col-span-5 rounded-2xl p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-[#0A0D14]">Reset Paper Capital</h2>
              <p className="text-[11px] text-[#64748B] leading-relaxed">
                Clears all paper positions, equity snapshots, and logs while preserving your deployed bots, and sets a fresh starting balance.
              </p>
              <label className="block space-y-1 pt-2 text-xs">
                <span className="font-semibold text-[#4B5565]">Starting Balance (USD)</span>
                <input
                  type="number"
                  min="100"
                  max="10000000"
                  step="1000"
                  value={resetBalance}
                  onChange={(e) => setResetBalance(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E8EE] bg-[#F7F8FA] font-bold"
                />
              </label>
              <div className="flex gap-1.5 pt-1">
                {[5000, 10000, 25000, 100000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setResetBalance(v)}
                    className="px-2.5 py-1 rounded-full sig-glass-subtle text-[10px] font-semibold text-[#4B5565] hover:text-[#0A0D14]"
                  >
                    ${(v / 1000).toFixed(0)}K
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleResetAccount}
              className="w-full py-2.5 rounded-xl border border-[#FECDD3] bg-[#FFF1F2] hover:bg-[#FFE4E6] text-[#BE123C] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Paper Account
            </button>
          </KineticCard>
        </div>
      )}
    </div>
  );
};

