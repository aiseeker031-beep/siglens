import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowUpRight,
  BarChart2,
  ChevronDown,
  Coins,
  Gauge,
  Info,
  RefreshCw,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { EChartBox } from '../components/charts/EChartBox';
import {
  KINETIC_EASE,
  KINETIC_SPRING,
  KineticCard,
  KineticMeterBar,
  KineticPrice,
  KineticSegmentedControl,
} from '../components/ui/Kinetic';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api, type AssetSignalBundle } from '../services/api';
import {
  formatCompactUsd,
  formatPercent,
  formatPrice,
  formatTimestamp,
  signalBgClass,
} from '../shared/format';
import type {
  IndicatorFamilyId,
  MarketOverviewPayload,
  MarketTicker,
  Timeframe,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type WatchlistMode = 'watchlist' | 'gainers' | 'losers' | 'volume';

const HERO_TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '15m', label: '15M' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
];

const WATCHLIST_MODES: { value: WatchlistMode; label: string }[] = [
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
  { value: 'volume', label: 'Volume' },
];

function coinBadgeStyle(base: string): { bg: string; glyph: string } {
  const b = base.toUpperCase();
  if (b === 'BTC') return { bg: 'bg-[#0A0D14] text-white', glyph: '₿' };
  if (b === 'ETH') return { bg: 'bg-[#2563EB] text-white', glyph: 'Ξ' };
  if (b === 'SOL') return { bg: 'bg-[#059669] text-white', glyph: 'S' };
  if (b === 'BNB') return { bg: 'bg-[#D97706] text-white', glyph: 'B' };
  if (b === 'XRP') return { bg: 'bg-[#334155] text-white', glyph: '✕' };
  if (b === 'DOGE') return { bg: 'bg-[#B45309] text-white', glyph: 'Ð' };
  if (b === 'AVAX') return { bg: 'bg-[#E11D48] text-white', glyph: 'A' };
  if (b === 'AAPL' || b === 'MSFT' || b === 'NVDA' || b === 'TSLA' || b === 'META' || b === 'AMZN' || b === 'GOOGL') {
    return { bg: 'bg-[#0A0D14] text-white', glyph: b.slice(0, 2) };
  }
  if (b === 'SPY' || b === 'QQQ' || b === 'US500' || b === 'NAS100' || b === 'US30' || b === 'GER40' || b === 'UK100' || b === 'JPN225') {
    return { bg: 'bg-[#2563EB] text-white', glyph: b.slice(0, 2) };
  }
  if (b === 'XAU' || b === 'XAG' || b === 'COPPER') {
    return { bg: 'bg-[#B45309] text-white', glyph: b.slice(0, 2) };
  }
  if (b === 'WTI' || b === 'BRENT' || b === 'NATGAS') {
    return { bg: 'bg-[#0F172A] text-white', glyph: b.slice(0, 2) };
  }
  if (b === 'EUR' || b === 'GBP' || b === 'USD' || b === 'AUD') {
    return { bg: 'bg-[#059669] text-white', glyph: b.slice(0, 2) };
  }
  return { bg: 'bg-[#1E293B] text-white', glyph: b.slice(0, 2) || '•' };
}

const KineticSparkline: React.FC<{ data: number[]; positive: boolean }> = ({ data, positive }) => {
  if (data.length < 2) {
    return <span className="text-[11px] font-mono text-[#7C8798]">—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(max - min, 1e-9);
  const w = 96;
  const h = 28;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke = positive ? '#059669' : '#E11D48';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-20 h-7 shrink-0">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.85"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
};

export const OverviewView: React.FC = () => {
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const activeSymbol = useAppStore((s) => s.symbol);
  const preferences = useAppStore((s) => s.preferences);
  const watchlist = useAppStore((s) => s.watchlist);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [data, setData] = useState<MarketOverviewPayload | null>(null);
  const [allMarkets, setAllMarkets] = useState<MarketTicker[]>([]);
  const [heroSymbol, setHeroSymbol] = useState<string>(activeSymbol || 'BTC/USDT');
  const [heroTf, setHeroTf] = useState<Timeframe>('1h');
  const [heroBundle, setHeroBundle] = useState<AssetSignalBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [heroLoading, setHeroLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchlistMode, setWatchlistMode] = useState<WatchlistMode>('watchlist');
  const [momentumInfoOpen, setMomentumInfoOpen] = useState(false);

  useEffect(() => {
    const defaultSym =
      exchange === 'stocks'
        ? 'AAPL/USD'
        : exchange === 'cfds'
          ? 'US500/USD'
          : exchange === 'kraken' || exchange === 'coinbase'
            ? 'BTC/USD'
            : 'BTC/USDT';
    setHeroSymbol(activeSymbol.includes('/') ? activeSymbol : defaultSym);
  }, [exchange, activeSymbol]);

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, mk] = await Promise.all([
        api.getOverview(exchange, marketType),
        api.getMarkets(exchange, marketType),
      ]);
      setData(ov);
      setAllMarkets(mk.markets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach public market providers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    const id = window.setInterval(loadOverview, 45_000);
    return () => window.clearInterval(id);
  }, [exchange, marketType]);

  useEffect(() => {
    let cancelled = false;
    const loadHero = async () => {
      setHeroLoading(true);
      try {
        const res = await api.getAssetSignals(exchange, marketType, heroSymbol, heroTf, 160);
        if (!cancelled) setHeroBundle(res);
      } catch {
        if (!cancelled) setHeroBundle(null);
      } finally {
        if (!cancelled) setHeroLoading(false);
      }
    };
    loadHero();
    return () => {
      cancelled = true;
    };
  }, [exchange, marketType, heroSymbol, heroTf]);

  const marketById = useMemo(() => {
    const m = new Map<string, MarketTicker>();
    allMarkets.forEach((t) => m.set(t.canonicalId, t));
    return m;
  }, [allMarkets]);

  const leaderSparkById = useMemo(() => {
    const m = new Map<string, number[]>();
    (data?.leaders ?? []).forEach((l) => m.set(l.ticker.canonicalId, l.sparkline));
    return m;
  }, [data?.leaders]);

  const heroCanonicalId = `${exchange}:${marketType}:${heroSymbol}`;
  const heroTicker = marketById.get(heroCanonicalId);
  const heroLive = liveTickers[heroCanonicalId];
  const heroCandles = heroBundle?.candles ?? [];
  const heroLastClose = heroCandles.length > 0 ? heroCandles[heroCandles.length - 1].close : null;
  const heroPrice = heroLive?.lastPrice ?? heroTicker?.lastPrice ?? heroLastClose;
  const heroChangePct = heroLive?.change24hPct ?? heroTicker?.change24hPct ?? 0;
  const heroBase = heroSymbol.split('/')[0] || 'BTC';
  const heroCoinBadge = coinBadgeStyle(heroBase);

  const heroPairOptions = useMemo(() => {
    const set = new Set<string>([heroSymbol]);
    (data?.leaders ?? []).forEach((l) => set.add(l.ticker.displaySymbol));
    allMarkets.slice(0, 10).forEach((m) => set.add(m.displaySymbol));
    return Array.from(set).slice(0, 12);
  }, [heroSymbol, data?.leaders, allMarkets]);

  // Crisp Minimal Kinetic Area Chart (Cobalt Precision on Gallery White)
  const heroChartOption: EChartsOption = useMemo(() => {
    const slice = heroCandles.slice(-64);
    const labels = slice.map((c) => {
      const d = new Date(c.openTime);
      if (heroTf === '1d') {
        return d.toISOString().slice(5, 10);
      }
      return d.toISOString().slice(11, 16);
    });
    const fullDates = slice.map((c) => formatTimestamp(c.openTime, preferences.timezone, false));
    const prices = slice.map((c) => c.close);
    const minVal = prices.length ? Math.min(...prices) : 0;
    const maxVal = prices.length ? Math.max(...prices) : 1;
    const pad = Math.max((maxVal - minVal) * 0.14, maxVal * 0.002);

    return {
      animation: true,
      animationDuration: 420,
      animationEasing: 'cubicOut',
      grid: { left: 10, right: 64, top: 18, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0A0D14',
        borderColor: '#1E2534',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontFamily: 'Roboto, sans-serif' },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(37, 99, 235, 0.45)', type: 'dashed', width: 1.5 },
        },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const item = list[0] as { dataIndex?: number; value?: number };
          const idx = item?.dataIndex ?? 0;
          const val = typeof item?.value === 'number' ? item.value : 0;
          return `<div style="text-align:center;">
            <div style="font-size:10px;color:#94A3B8;margin-bottom:2px;font-family:'Roboto',sans-serif;">${fullDates[idx] ?? ''}</div>
            <div style="font-family:'Roboto',sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;">$${formatPrice(val, preferences.decimalPrecision)}</div>
          </div>`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#7C8798',
          fontFamily: 'Roboto, sans-serif',
          fontSize: 10,
          interval: Math.max(Math.floor(labels.length / 6), 1),
        },
        splitLine: {
          show: true,
          lineStyle: { color: '#F1F3F7' },
        },
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
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(1)}K` : formatPrice(v, preferences.decimalPrecision),
        },
        splitLine: {
          show: true,
          lineStyle: { color: '#ECEFF4', type: 'dashed' },
        },
      },
      series: [
        {
          type: 'line',
          smooth: 0.28,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          data: prices,
          itemStyle: {
            color: '#FFFFFF',
            borderColor: '#2563EB',
            borderWidth: 2.5,
          },
          lineStyle: {
            width: 2.25,
            color: '#2563EB',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(37, 99, 235, 0.16)' },
                { offset: 0.65, color: 'rgba(37, 99, 235, 0.04)' },
                { offset: 1, color: 'rgba(37, 99, 235, 0.0)' },
              ],
            },
          },
        },
      ],
    };
  }, [heroCandles, heroTf, preferences.decimalPrecision, preferences.timezone]);

  const activeReport =
    preferences.showLiveProvisional && heroBundle?.provisional
      ? heroBundle.provisional
      : heroBundle?.confirmed ?? null;

  const indicatorBars = useMemo(() => {
    if (!activeReport) return [];
    const preferredOrder: IndicatorFamilyId[] = ['rsi', 'macd', 'ema', 'bollinger', 'adx', 'rvol'];
    const labelMap: Partial<Record<IndicatorFamilyId, string>> = {
      rsi: 'RSI (14)',
      macd: 'MACD',
      ema: 'EMA (20/50/200)',
      bollinger: 'Bollinger Bands',
      adx: 'ADX Momentum',
      rvol: 'Volume (RVOL)',
      vwap: 'Session VWAP',
      obv: 'OBV Flow',
    };
    const byId = new Map(activeReport.indicators.map((ind) => [ind.id, ind]));
    const picked = preferredOrder
      .map((id) => byId.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const list = picked.length >= 4 ? picked : activeReport.indicators.slice(0, 6);
    return list.map((ind) => {
      const strengthPct = Math.round(Math.min(98, Math.max(18, Math.abs(ind.evidence) * 70 + 28)));
      return {
        id: ind.id,
        label: labelMap[ind.id] ?? ind.name,
        pct: strengthPct,
        bias: ind.bias,
      };
    });
  }, [activeReport]);

  const watchlistRows = useMemo(() => {
    if (watchlistMode === 'gainers') return (data?.topGainers ?? []).slice(0, 6);
    if (watchlistMode === 'losers') return (data?.topLosers ?? []).slice(0, 6);
    if (watchlistMode === 'volume') return (data?.highestVolume ?? []).slice(0, 6);

    const matched: MarketTicker[] = [];
    for (const cid of watchlist) {
      const tk = marketById.get(cid);
      if (tk) matched.push(tk);
    }
    if (matched.length >= 3) return matched.slice(0, 6);
    return (data?.leaders ?? []).map((l) => l.ticker).slice(0, 6);
  }, [watchlistMode, data, watchlist, marketById]);

  const stats = data?.aggregateStats;
  const breadthScore = stats?.breadthScore ?? 0;
  const momentumPct = Math.round(Math.max(4, Math.min(96, (breadthScore + 100) / 2)));
  const momentumLabel =
    breadthScore >= 20 ? 'Bullish' : breadthScore <= -20 ? 'Bearish' : 'Neutral';

  const momentumBars = useMemo(() => {
    const ema50 = stats?.aboveEma50Pct ?? 50;
    const ema200 = stats?.aboveEma200Pct ?? 50;
    const bullShare =
      stats && stats.analyzedAssets > 0
        ? Math.round((stats.bullishCount / stats.analyzedAssets) * 100)
        : 50;
    const raw = [
      Math.max(22, Math.round(momentumPct * 0.48 + 14)),
      Math.max(28, Math.round(momentumPct * 0.62 + 16)),
      Math.max(36, Math.round((momentumPct + ema200) * 0.45 + 16)),
      Math.max(44, Math.round((momentumPct + ema50) * 0.48 + 18)),
      Math.max(52, Math.round((momentumPct + bullShare) * 0.52 + 16)),
      Math.max(66, Math.min(100, Math.round(momentumPct * 0.72 + 30))),
      Math.max(34, Math.round(momentumPct * 0.52 + 18)),
    ];
    return raw.map((h, i) => ({
      heightPct: Math.max(18, Math.min(100, h)),
      isPeak: i === 5,
    }));
  }, [momentumPct, stats]);

  // Crisp Light-Surface ECharts Treemap
  const heatmapOption: EChartsOption = useMemo(() => {
    const stableBases = new Set([
      'USDC', 'USDT', 'FDUSD', 'USDE', 'USD1', 'RLUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDG', 'PYUSD', 'EUR', 'EURI', 'TRY', 'AEUR',
    ]);
    const top = (
      exchange === 'stocks' || exchange === 'cfds'
        ? allMarkets
        : allMarkets.filter((m) => (m.quoteAsset === 'USDT' || m.quoteAsset === 'USD') && !stableBases.has(m.baseAsset))
    ).slice(0, 20);
    const items = top.map((t) => {
      const pct = t.change24hPct;
      const color =
        pct >= 4
          ? '#047857'
          : pct >= 1
            ? '#059669'
            : pct >= 0
              ? '#10B981'
              : pct <= -4
                ? '#BE123C'
                : pct <= -1
                  ? '#E11D48'
                  : '#F43F5E';
      return {
        name: `${t.baseAsset}\n${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        value: Math.max(t.quoteVolume24h, 1_000_000),
        displaySymbol: t.displaySymbol,
        exchange: t.exchange,
        marketType: t.marketType,
        pct,
        price: t.lastPrice,
        itemStyle: { color, borderColor: '#FFFFFF', borderWidth: 2, gapWidth: 2, borderRadius: 6 },
      };
    });

    return {
      animation: true,
      animationDuration: 360,
      tooltip: {
        backgroundColor: '#0A0D14',
        borderColor: '#1E2534',
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: (params: unknown) => {
          const p = (params as { data?: { displaySymbol?: string; price?: number; pct?: number; value?: number } }).data;
          if (!p?.displaySymbol) return '';
          return `<div style="font-family:'Roboto',sans-serif;font-size:12px;">
            <strong>${p.displaySymbol}</strong><br/>
            Price: $${formatPrice(p.price)}<br/>
            24h: ${formatPercent(p.pct)}<br/>
            24h Vol: ${formatCompactUsd(p.value)}
          </div>`;
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          label: {
            show: true,
            color: '#FFFFFF',
            fontFamily: 'Roboto, sans-serif',
            fontSize: 11,
            fontWeight: 600,
          },
          data: items,
        },
      ],
    };
  }, [allMarkets]);

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <SkeletonBlock className="h-[420px] lg:col-span-7" />
          <SkeletonBlock className="h-[420px] lg:col-span-5" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <SkeletonBlock className="h-64 lg:col-span-7" />
          <SkeletonBlock className="h-64 lg:col-span-5" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <KineticCard className="rounded-2xl p-8 text-center">
        <h2 className="text-base font-bold text-[#0A0D14]">Live Market Data Temporarily Unavailable</h2>
        <p className="text-xs text-[#64748B] mt-1">{error}</p>
        <button
          type="button"
          onClick={loadOverview}
          className="mt-4 px-4 py-2 text-xs font-semibold rounded-full sig-btn-primary"
        >
          Retry Connection
        </button>
      </KineticCard>
    );
  }

  const fearGreed = data?.fearAndGreed;
  const fgVal = fearGreed?.value ?? 50;
  const fgPositive = fgVal >= 50;
  const activeSignalsCount = Math.max(
    (stats?.bullishCount ?? 0) + (stats?.bearishCount ?? 0),
    data?.recentSignals?.length ?? 0,
  );
  const setup = activeReport?.signalSetup ?? null;
  const sigDir = setup?.direction ?? 'WAIT';

  return (
    <div className="space-y-5">
      {/* ROW 1: 4 Minimal Kinetic Telemetry KPI Tiles */}
      <section aria-label="Market Summary Metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Top Leaders Liquidity Share */}
        <KineticCard delay={0} interactive className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
              {exchange === 'stocks'
                ? 'NVDA / AAPL Vol Share'
                : exchange === 'cfds'
                  ? 'CFD Instruments'
                  : 'BTC / ETH Vol Share'}
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#F2F4F7] border border-[#E6E8EE] flex items-center justify-center text-[#0A0D14]">
              <Coins className="w-4 h-4" />
            </span>
          </div>
          <div className="space-y-2">
            {exchange === 'cfds' ? (
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-[#0A0D14]">
                  {stats?.trackedAssets ?? 0}
                </span>
                <span className="text-xs font-mono font-semibold text-[#2563EB]">
                  Indices · Metals · FX
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-[#0A0D14]">
                    {stats?.btcDominanceProxy !== null ? `${stats?.btcDominanceProxy}%` : '—'}
                  </span>
                  <span className="text-xs font-mono font-semibold text-[#2563EB]">
                    {exchange === 'stocks' ? 'AAPL' : 'ETH'}{' '}
                    {stats?.ethDominanceProxy !== null ? `${stats?.ethDominanceProxy}%` : '—'}
                  </span>
                </div>
                <div className="flex h-1.5 rounded-full bg-[#ECEFF4] overflow-hidden gap-0.5">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, stats?.btcDominanceProxy ?? 0)}%` }}
                    transition={{ duration: 0.55, ease: KINETIC_EASE }}
                    className="h-full bg-[#0A0D14] rounded-full"
                  />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, stats?.ethDominanceProxy ?? 0)}%` }}
                    transition={{ duration: 0.55, delay: 0.08, ease: KINETIC_EASE }}
                    className="h-full bg-[#2563EB] rounded-full"
                  />
                </div>
              </>
            )}
          </div>
        </KineticCard>

        {/* KPI 2: 24h Volume / Session Activity */}
        <KineticCard delay={0.04} interactive className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
              {exchange === 'cfds' ? 'CFD Breadth (>EMA50)' : `24h Volume (${exchange})`}
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#F2F4F7] border border-[#E6E8EE] flex items-center justify-center text-[#0A0D14]">
              <BarChart2 className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-[#0A0D14]">
              {exchange === 'cfds'
                ? `${stats?.aboveEma50Pct ?? 0}%`
                : formatCompactUsd(stats?.exchangeVolume24hUsd)}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#F2F4F7] border border-[#E6E8EE] text-[11px] font-mono font-semibold text-[#4B5565]">
              {stats?.trackedAssets ?? 0} {exchange === 'stocks' ? 'stocks' : exchange === 'cfds' ? 'cfds' : 'pairs'}
            </span>
          </div>
        </KineticCard>

        {/* KPI 3: Fear & Greed */}
        <KineticCard delay={0.08} interactive className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
              Fear & Greed
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#F2F4F7] border border-[#E6E8EE] flex items-center justify-center text-[#0A0D14]">
              <Gauge className="w-4 h-4" />
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-[#0A0D14]">
                {fearGreed ? fearGreed.value : '—'}
                <span className="text-xs font-normal text-[#7C8798]">/100</span>
              </span>
              {fearGreed && (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap border ${
                    fgPositive
                      ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                      : 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]'
                  }`}
                >
                  {fearGreed.classification}
                </span>
              )}
            </div>
            <KineticMeterBar
              pct={fgVal}
              barClassName={fgPositive ? 'bg-[#059669]' : 'bg-[#E11D48]'}
              delay={0.12}
            />
          </div>
        </KineticCard>

        {/* KPI 4: Active Signals */}
        <KineticCard
          delay={0.12}
          interactive
          onClick={() => setActiveSection('signals')}
          className="rounded-2xl px-4 py-4 flex flex-col justify-between gap-3 text-left group"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
              Active Signals
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#0A0D14] text-white flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
              <ArrowUpRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 w-full">
            <span className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-[#0A0D14]">
              {activeSignalsCount}
            </span>
            <span className="text-xs font-mono font-semibold flex items-center gap-1.5">
              <span className="text-[#059669]">{stats?.bullishCount ?? 0}B</span>
              <span className="text-[#CBD5E1]">·</span>
              <span className="text-[#E11D48]">{stats?.bearishCount ?? 0}S</span>
            </span>
          </div>
        </KineticCard>
      </section>

      {/* ROW 2: Signature 12-Column Split — Kinetic Price Canvas + Intelligent Signal Engine */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left (7 cols): Live Kinetic Price Area Chart */}
        <KineticCard delay={0.1} className="lg:col-span-7 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm ${heroCoinBadge.bg}`}
                  >
                    {heroCoinBadge.glyph}
                  </span>
                  <div className="relative inline-flex items-center">
                    <select
                      aria-label="Select hero chart pair"
                      value={heroSymbol}
                      onChange={(e) => setHeroSymbol(e.target.value)}
                      className="appearance-none bg-transparent pr-6 text-lg font-extrabold tracking-tight text-[#0A0D14] focus:outline-none cursor-pointer"
                    >
                      {heroPairOptions.map((sym) => (
                        <option key={sym} value={sym} className="bg-white text-sm">
                          {sym}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 -ml-5 pointer-events-none text-[#7C8798]" />
                  </div>
                </div>

                <div className="flex items-baseline gap-3 pl-10">
                  <KineticPrice
                    value={heroPrice}
                    formatted={
                      heroPrice ? `$${formatPrice(heroPrice, preferences.decimalPrecision)}` : '—'
                    }
                    className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0A0D14]"
                  />
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-mono font-semibold tabular-nums ${
                      heroChangePct >= 0
                        ? 'bg-[#ECFDF5] text-[#059669]'
                        : 'bg-[#FFF1F2] text-[#E11D48]'
                    }`}
                  >
                    {heroChangePct >= 0 ? '↑' : '↓'} {formatPercent(heroChangePct)}
                  </span>
                </div>
              </div>

              <KineticSegmentedControl
                options={HERO_TIMEFRAMES}
                value={heroTf}
                onChange={setHeroTf}
                layoutId="overview-hero-tf"
              />
            </div>

            <div className="mt-4 relative">
              {heroLoading && heroCandles.length === 0 ? (
                <SkeletonBlock className="h-[258px]" />
              ) : (
                <EChartBox option={heroChartOption} height={258} />
              )}
            </div>
          </div>

          {/* Kinetic 6-Segment Velocity Track */}
          <div className="mt-3 pt-3 border-t border-[#ECEFF4] flex items-center justify-between gap-4">
            <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-[#7C8798] shrink-0">
              Velocity
            </span>
            <div className="flex-1 grid grid-cols-6 gap-1.5">
              {Array.from({ length: 6 }).map((_, idx) => {
                const activeCount = Math.max(1, Math.round((momentumPct / 100) * 6));
                const isPeak = idx === Math.min(5, activeCount - 1);
                const isLit = idx < activeCount;
                const segColor =
                  isPeak && sigDir === 'BUY'
                    ? 'bg-[#059669]'
                    : isPeak && sigDir === 'SELL'
                      ? 'bg-[#E11D48]'
                      : isLit
                        ? 'bg-[#0A0D14]'
                        : 'bg-[#ECEFF4]';
                return (
                  <motion.div
                    key={idx}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3, delay: idx * 0.04, ease: KINETIC_EASE }}
                    style={{ transformOrigin: 'left center' }}
                    className={`h-1.5 rounded-full transition-colors duration-300 ${segColor}`}
                  />
                );
              })}
            </div>
            <span className="text-[11px] font-mono font-semibold tabular-nums text-[#0A0D14] shrink-0">
              {momentumPct}%
            </span>
          </div>
        </KineticCard>

        {/* Right (5 cols): Intelligent Signal Engine Bento */}
        <KineticCard delay={0.14} className="lg:col-span-5 rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-[#0A0D14] text-white flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5" />
                </span>
                <h2 className="text-xs font-extrabold tracking-[0.08em] uppercase text-[#0A0D14]">
                  Intelligent Signal
                </h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#F2F4F7] border border-[#E6E8EE] font-mono text-[11px] font-medium text-[#4B5565]">
                {heroSymbol.replace('/', '')} · {heroTf}
              </span>
            </div>

            {/* Direction Block + Agreement Readout */}
            <div className="grid grid-cols-2 gap-3">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${heroSymbol}-${heroTf}-${sigDir}`}
                  data-testid="hero-signal-direction"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.22, ease: KINETIC_EASE }}
                  className={`rounded-xl px-4 py-3 flex items-center justify-center text-2xl font-extrabold tracking-wider border ${
                    sigDir === 'BUY'
                      ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                      : sigDir === 'SELL'
                        ? 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]'
                        : 'bg-[#F7F8FA] text-[#4B5565] border-[#DCE0E8]'
                  }`}
                >
                  {sigDir}
                </motion.div>
              </AnimatePresence>

              <div className="rounded-xl sig-glass-subtle px-4 py-2.5 flex flex-col items-center justify-center">
                <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-[#7C8798]">
                  Agreement
                </span>
                <span
                  className={`text-2xl font-extrabold font-mono tabular-nums ${
                    sigDir === 'BUY'
                      ? 'text-[#059669]'
                      : sigDir === 'SELL'
                        ? 'text-[#E11D48]'
                        : 'text-[#0A0D14]'
                  }`}
                >
                  {activeReport ? `${activeReport.agreement.agreementPct}%` : '—'}
                </span>
              </div>
            </div>

            {/* 6 Kinetic Horizontal Indicator Strength Bars */}
            <div className="space-y-2.5">
              {indicatorBars.map((bar, idx) => {
                const fillClass =
                  bar.bias === 'BULLISH'
                    ? 'bg-[#059669]'
                    : bar.bias === 'BEARISH'
                      ? 'bg-[#E11D48]'
                      : 'bg-[#64748B]';
                return (
                  <div key={bar.id} className="grid grid-cols-12 items-center gap-2.5 text-xs">
                    <span className="col-span-5 text-[#4B5565] font-medium truncate">
                      {bar.label}
                    </span>
                    <div className="col-span-5">
                      <KineticMeterBar
                        pct={bar.pct}
                        barClassName={fillClass}
                        heightClassName="h-2"
                        delay={idx * 0.04}
                      />
                    </div>
                    <span className="col-span-2 text-right font-mono font-semibold tabular-nums text-[#0A0D14]">
                      {bar.pct}%
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Compact Live Entry / SL / TP1 Strip */}
            {setup && setup.direction !== 'WAIT' && setup.stopLoss !== null && (
              <div className="rounded-xl sig-glass-subtle px-3 py-2 font-mono text-[11px] tabular-nums flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-[#0A0D14]">
                  Entry:{' '}
                  <strong className="text-[#2563EB]">
                    {setup.entryMode === 'NOW'
                      ? `NOW $${formatPrice(heroPrice ?? setup.entryPrice, preferences.decimalPrecision)}`
                      : `$${formatPrice(setup.entryZoneLow, preferences.decimalPrecision)}–$${formatPrice(setup.entryZoneHigh, preferences.decimalPrecision)}`}
                  </strong>
                </span>
                <span className="text-[#E11D48] font-semibold">
                  SL: ${formatPrice(setup.stopLoss, preferences.decimalPrecision)}
                </span>
                {setup.takeProfits[0] && (
                  <span className="text-[#059669] font-semibold">
                    TP1: ${formatPrice(setup.takeProfits[0].price, preferences.decimalPrecision)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#ECEFF4] flex items-end justify-between gap-3">
            <p className="text-xs leading-relaxed text-[#4B5565] line-clamp-2">
              <span className="font-bold text-[#0A0D14]">Summary: </span>
              {activeReport
                ? `${activeReport.label} (${activeReport.regime.combinedLabel}). ${activeReport.supportingEvidence[0] ?? 'Multi-indicator confluence evaluated deterministically.'}`
                : 'Computing deterministic multi-indicator confluence from live exchange candles.'}
            </p>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-[11px] font-bold text-[#2563EB] hover:text-[#1D4ED8] whitespace-nowrap shrink-0"
            >
              All Signals →
            </button>
          </div>
        </KineticCard>
      </section>

      {/* ROW 3: Clean 12-Column Asymmetric Deck — Watchlist & Movers (7) + Kinetic Momentum (5) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left (7 cols): Interactive Market Watchlist & Movers */}
        <KineticCard delay={0.16} className="lg:col-span-7 rounded-2xl p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-[#0A0D14]">
                Market Watchlist
              </h2>
              <p className="text-[11px] text-[#7C8798]">
                Click any pair to focus the live chart &amp; signal engine
              </p>
            </div>
            <KineticSegmentedControl
              options={WATCHLIST_MODES}
              value={watchlistMode}
              onChange={setWatchlistMode}
              layoutId="overview-watchlist-mode"
              size="xs"
            />
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#ECEFF4] text-[#7C8798] text-[10px] font-mono uppercase tracking-[0.06em]">
                  <th className="py-2 text-left font-semibold">Pair</th>
                  <th className="py-2 text-right font-semibold">Price</th>
                  <th className="py-2 text-right font-semibold">24h</th>
                  <th className="py-2 text-right font-semibold">Volume</th>
                  <th className="py-2 text-right font-semibold hidden sm:table-cell">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F7] font-mono tabular-nums">
                {watchlistRows.map((tk) => {
                  const live = liveTickers[tk.canonicalId];
                  const price = live?.lastPrice ?? tk.lastPrice;
                  const pct = live?.change24hPct ?? tk.change24hPct;
                  const pos = pct >= 0;
                  const badge = coinBadgeStyle(tk.baseAsset);
                  const spark = leaderSparkById.get(tk.canonicalId) ?? [
                    price * (1 - pct / 180),
                    price * (1 - pct / 240),
                    price * (1 - pct / 320),
                    price,
                  ];
                  return (
                    <tr
                      key={tk.canonicalId}
                      onClick={() => selectMarket(tk.exchange, tk.marketType, tk.displaySymbol, true)}
                      className="cursor-pointer hover:bg-[#F7F8FA] transition-colors group"
                    >
                      <td className="py-2.5 pr-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${badge.bg}`}
                          >
                            {badge.glyph}
                          </span>
                          <span className="font-bold text-[#0A0D14] group-hover:text-[#2563EB] transition-colors whitespace-nowrap">
                            {tk.displaySymbol}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-[#0A0D14] font-semibold">
                        <KineticPrice
                          value={price}
                          formatted={`$${formatPrice(price, preferences.decimalPrecision)}`}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            pos
                              ? 'bg-[#ECFDF5] text-[#059669]'
                              : 'bg-[#FFF1F2] text-[#E11D48]'
                          }`}
                        >
                          {pos ? '↑' : '↓'} {formatPercent(pct)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#64748B]">
                        {formatCompactUsd(tk.quoteVolume24h)}
                      </td>
                      <td className="py-2.5 pl-2 hidden sm:table-cell">
                        <div className="flex justify-end">
                          <KineticSparkline data={spark} positive={pos} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </KineticCard>

        {/* Right (5 cols): Kinetic Market Momentum Spectrum */}
        <KineticCard delay={0.2} className="lg:col-span-5 rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-[#0A0D14]">
                Market Momentum
              </h2>
              <p className="text-[11px] text-[#7C8798]">
                Live breadth, EMA50 &amp; EMA200 structural velocity
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMomentumInfoOpen((v) => !v)}
              aria-label="Market momentum formula details"
              className="p-1.5 rounded-full text-[#7C8798] hover:text-[#0A0D14] hover:bg-[#F2F4F7] transition-colors"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          <AnimatePresence>
            {momentumInfoOpen && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-[11px] text-[#4B5565] bg-[#F7F8FA] border border-[#E6E8EE] rounded-xl px-3 py-2 mt-2 overflow-hidden"
              >
                Derived from live {exchange} 1h breadth ({stats?.bullishCount ?? 0} bullish /{' '}
                {stats?.bearishCount ?? 0} bearish across {stats?.analyzedAssets ?? 0} pairs,{' '}
                {stats?.aboveEma50Pct ?? 0}% above EMA 50).
              </motion.p>
            )}
          </AnimatePresence>

          {/* 7 Kinetic Vertical Spectrum Bars + Percentage Readout */}
          <div className="my-5 flex items-end justify-between gap-5">
            <div className="flex-1 flex items-end gap-2 h-32 pt-2">
              {momentumBars.map((bar, idx) => (
                <div key={idx} className="flex-1 h-full flex items-end">
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: bar.heightPct / 100 }}
                    transition={{ duration: 0.55, delay: idx * 0.045, ease: KINETIC_EASE }}
                    style={{ transformOrigin: 'bottom center' }}
                    className={`w-full h-full rounded-t-lg ${
                      bar.isPeak
                        ? momentumLabel === 'Bearish'
                          ? 'bg-[#E11D48]'
                          : momentumLabel === 'Bullish'
                            ? 'bg-[#059669]'
                            : 'bg-[#2563EB]'
                        : 'bg-[#0A0D14]/85'
                    }`}
                  />
                </div>
              ))}
            </div>

            <div className="text-right shrink-0 space-y-2 pb-1">
              <div
                className={`text-4xl font-extrabold font-mono tabular-nums tracking-tight ${
                  momentumLabel === 'Bullish'
                    ? 'text-[#059669]'
                    : momentumLabel === 'Bearish'
                      ? 'text-[#E11D48]'
                      : 'text-[#0A0D14]'
                }`}
              >
                {momentumPct}%
              </div>
              <span
                className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${
                  momentumLabel === 'Bullish'
                    ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                    : momentumLabel === 'Bearish'
                      ? 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]'
                      : 'bg-[#F2F4F7] text-[#4B5565] border-[#DCE0E8]'
                }`}
              >
                {momentumLabel}
              </span>
            </div>
          </div>

          {/* Bearish — Neutral — Bullish Precision Spectrum Track */}
          <div className="space-y-1.5">
            <div className="relative h-2 rounded-full bg-gradient-to-r from-[#E11D48] via-[#CBD5E1] to-[#059669]">
              <motion.div
                animate={{ left: `${momentumPct}%` }}
                transition={KINETIC_SPRING}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-[#0A0D14] shadow-md"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.06em] text-[#7C8798]">
              <span>Bearish</span>
              <span>Neutral</span>
              <span>Bullish</span>
            </div>
          </div>
        </KineticCard>
      </section>

      {/* ROW 4: Performance Heatmap (8) + Confirmed Signal Activity (4) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <KineticCard delay={0.22} className="xl:col-span-8 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-[#0A0D14]">
                Performance Heatmap (24h Quote Volume)
              </h2>
              <p className="text-[11px] text-[#7C8798]">
                {data?.exchangeCoverageNote}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={loadOverview}
                aria-label="Refresh overview data"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sig-glass-subtle text-xs font-medium text-[#4B5565] hover:text-[#0A0D14] transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('heatmaps')}
                className="text-xs font-bold text-[#2563EB] hover:text-[#1D4ED8]"
              >
                Full Heatmaps →
              </button>
            </div>
          </div>
          <EChartBox
            option={heatmapOption}
            height={260}
            onChartClick={(params: unknown) => {
              const d = (params as { data?: { exchange?: MarketTicker['exchange']; marketType?: MarketTicker['marketType']; displaySymbol?: string } }).data;
              if (d?.exchange && d?.marketType && d?.displaySymbol) {
                selectMarket(d.exchange, d.marketType, d.displaySymbol, true);
              }
            }}
          />
        </KineticCard>

        <KineticCard delay={0.26} className="xl:col-span-4 rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-extrabold tracking-tight text-[#0A0D14]">
              Confirmed Signal Activity
            </h2>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-xs font-bold text-[#2563EB] hover:text-[#1D4ED8]"
            >
              Live Feed →
            </button>
          </div>
          <div className="divide-y divide-[#F1F3F7] overflow-y-auto max-h-[260px]">
            {(data?.recentSignals ?? []).length === 0 ? (
              <div className="py-8 text-center text-xs text-[#7C8798]">
                Background scanner populates confirmed technical signals after candle validation.
              </div>
            ) : (
              (data?.recentSignals ?? []).slice(0, 6).map((ev) => {
                const evSetup = ev.signalSetup;
                const isBuy = evSetup?.direction === 'BUY' || (!evSetup && ev.classification.includes('BULLISH'));
                const isSell = evSetup?.direction === 'SELL' || (!evSetup && ev.classification.includes('BEARISH'));
                const dirText = isBuy ? 'BUY' : isSell ? 'SELL' : 'WAIT';
                const compactSym = evSetup?.symbol ?? ev.displaySymbol.replace(/[^A-Za-z0-9]/g, '');
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => selectMarket(ev.exchange, ev.marketType, ev.displaySymbol, true)}
                    className="w-full py-2.5 text-left hover:bg-[#F7F8FA] px-2 rounded-xl transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[#0A0D14]">
                        {compactSym} · {ev.timeframe}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${signalBgClass(ev.classification)}`}>
                        {dirText}
                      </span>
                    </div>
                    {evSetup && evSetup.direction !== 'WAIT' && evSetup.entryPrice !== null && evSetup.stopLoss !== null ? (
                      <div className="mt-1 space-y-0.5 font-mono text-[10px] tabular-nums">
                        <div className="text-[#4B5565]">
                          Entry: {evSetup.entryMode === 'NOW' ? `NOW $${formatPrice(evSetup.entryPrice)}` : `$${formatPrice(evSetup.entryZoneLow)}–$${formatPrice(evSetup.entryZoneHigh)}`}
                        </div>
                        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                          <span className="text-[#E11D48] font-semibold">
                            SL: ${formatPrice(evSetup.stopLoss)}
                          </span>
                          {evSetup.takeProfits[0] && (
                            <span className="text-[#059669] font-semibold">
                              TP1: ${formatPrice(evSetup.takeProfits[0].price)}
                            </span>
                          )}
                          {evSetup.takeProfits[1] && (
                            <span className="text-[#059669] font-semibold">
                              TP2: ${formatPrice(evSetup.takeProfits[1].price)}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#64748B] mt-1 line-clamp-2">
                        {ev.summary}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-[#7C8798] mt-1">
                      {ev.exchange} · {formatTimestamp(ev.candleTimestamp, preferences.timezone, false)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </KineticCard>
      </section>
    </div>
  );
};
