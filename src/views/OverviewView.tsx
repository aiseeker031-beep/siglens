import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { EChartBox } from '../components/charts/EChartBox';
import {
  KineticCard,
  KineticPrice,
  KineticSegmentedControl,
  MiniSparkBars,
} from '../components/ui/Kinetic';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { StructuredSignalCard } from '../components/ui/StructuredSignalCard';
import { api, type AssetSignalBundle } from '../services/api';
import { EXCHANGE_LABELS } from '../shared/constants';
import {
  formatCompactUsd,
  formatPercent,
  formatPrice,
  formatTimestamp,
} from '../shared/format';
import type {
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

function coinBadgeStyle(base: string): { bg: string; glyph: string } {
  const b = base.toUpperCase();
  if (b === 'BTC') return { bg: 'bg-[#F7931A] text-white', glyph: '₿' };
  if (b === 'ETH') return { bg: 'bg-[#627EEA] text-white', glyph: 'Ξ' };
  if (b === 'SOL') return { bg: 'bg-[#121814] text-[#4ADE80]', glyph: 'S' };
  if (b === 'BNB') return { bg: 'bg-[#F3BA2F] text-[#111814]', glyph: 'B' };
  if (b === 'XRP') return { bg: 'bg-[#1E293B] text-white', glyph: '✕' };
  if (b === 'DOGE') return { bg: 'bg-[#C2A633] text-[#111814]', glyph: 'Ð' };
  if (b === 'AVAX') return { bg: 'bg-[#E84142] text-white', glyph: 'A' };
  if (b === 'AAPL' || b === 'MSFT' || b === 'NVDA' || b === 'TSLA' || b === 'META' || b === 'AMZN' || b === 'GOOGL') {
    return { bg: 'bg-[#121814] text-[#4ADE80]', glyph: b.slice(0, 2) };
  }
  if (b === 'SPY' || b === 'QQQ' || b === 'US500' || b === 'NAS100' || b === 'US30' || b === 'GER40' || b === 'UK100' || b === 'JPN225') {
    return { bg: 'bg-[#16A34A] text-white', glyph: b.slice(0, 2) };
  }
  if (b === 'XAU' || b === 'XAG' || b === 'COPPER') {
    return { bg: 'bg-[#CA8A04] text-white', glyph: b.slice(0, 2) };
  }
  if (b === 'WTI' || b === 'BRENT' || b === 'NATGAS') {
    return { bg: 'bg-[#111814] text-white', glyph: b.slice(0, 2) };
  }
  return { bg: 'bg-[#16A34A] text-white', glyph: b.slice(0, 2) || '•' };
}

function structureBadge(pct: number): { label: string; style: string } {
  if (pct >= 3) return { label: 'Breakout', style: 'bg-[#DCFCE7] text-[#15803D]' };
  if (pct >= 0.4) return { label: 'Accumulation', style: 'bg-[#FEF3C7] text-[#92400E]' };
  if (pct <= -3) return { label: 'Distribution', style: 'bg-[#FFE4E6] text-[#BE123C]' };
  if (pct <= -0.4) return { label: 'Pullback', style: 'bg-[#FFEDD5] text-[#9A3412]' };
  return { label: 'Consolidation', style: 'bg-[#FEF9C3] text-[#854D0E]' };
}

const EmeraldSparkline: React.FC<{ data: number[]; positive: boolean }> = ({ data, positive }) => {
  if (data.length < 2) {
    return <span className="text-[11px] font-mono text-[#7D8E84]">—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(max - min, 1e-9);
  const w = 92;
  const h = 26;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke = positive ? '#16A34A' : '#E11D48';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-20 h-6 shrink-0">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.9"
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

  const heroPairOptions = useMemo(() => {
    const set = new Set<string>([heroSymbol]);
    (data?.leaders ?? []).forEach((l) => set.add(l.ticker.displaySymbol));
    allMarkets.slice(0, 12).forEach((m) => set.add(m.displaySymbol));
    return Array.from(set).slice(0, 14);
  }, [heroSymbol, data?.leaders, allMarkets]);

  // Real 5-bar mini-sparkbar datasets derived from live candle/volume telemetry
  const priceSparkBars = useMemo(() => {
    const slice = heroCandles.slice(-5).map((c) => c.volume || c.close);
    return slice.length === 5 ? slice : [42, 74, 38, 86, 62];
  }, [heroCandles]);

  const sentimentSparkBars = useMemo(() => {
    const fg = data?.fearAndGreed?.value ?? 50;
    const ema50 = data?.aggregateStats?.aboveEma50Pct ?? 50;
    const ema200 = data?.aggregateStats?.aboveEma200Pct ?? 50;
    return [
      Math.max(18, Math.round(fg * 0.7)),
      Math.max(18, Math.round(ema200)),
      Math.max(18, Math.round(fg)),
      Math.max(18, Math.round(ema50)),
      Math.max(18, Math.round((fg + ema50) / 2)),
    ];
  }, [data]);

  const volSparkBars = useMemo(() => {
    const vols = allMarkets.slice(0, 5).map((m) => m.quoteVolume24h || m.lastPrice);
    return vols.length === 5 ? vols : [65, 48, 82, 54, 90];
  }, [allMarkets]);

  // Signature Emerald Area Chart (siglens.ai.studio palette)
  const heroChartOption: EChartsOption = useMemo(() => {
    const slice = heroCandles.slice(-64);
    const labels = slice.map((c) => {
      const d = new Date(c.openTime);
      return heroTf === '1d' ? d.toISOString().slice(5, 10) : d.toISOString().slice(11, 16);
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
        backgroundColor: '#0B120E',
        borderColor: 'rgba(34, 197, 94, 0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontFamily: 'Roboto, sans-serif' },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(22, 163, 74, 0.45)', type: 'dashed', width: 1.5 },
        },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const item = list[0] as { dataIndex?: number; value?: number };
          const idx = item?.dataIndex ?? 0;
          const val = typeof item?.value === 'number' ? item.value : 0;
          return `<div style="text-align:center;font-family:Roboto,sans-serif;">
            <div style="font-size:10px;color:#8FA398;margin-bottom:2px;">${fullDates[idx] ?? ''}</div>
            <div style="font-size:14px;font-weight:700;color:#FFFFFF;">$${formatPrice(val, preferences.decimalPrecision)}</div>
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
          color: '#7D8E84',
          fontFamily: 'Roboto, sans-serif',
          fontSize: 10,
          interval: Math.max(Math.floor(labels.length / 6), 1),
        },
        splitLine: { show: true, lineStyle: { color: '#EFF3F0' } },
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
          color: '#7D8E84',
          fontFamily: 'Roboto, sans-serif',
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(1)}K` : formatPrice(v, preferences.decimalPrecision),
        },
        splitLine: { show: true, lineStyle: { color: '#E8EEEA', type: 'dashed' } },
      },
      series: [
        {
          type: 'line',
          smooth: 0.28,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          data: prices,
          itemStyle: { color: '#FFFFFF', borderColor: '#16A34A', borderWidth: 2.5 },
          lineStyle: { width: 2.4, color: '#16A34A' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34, 197, 94, 0.22)' },
                { offset: 0.68, color: 'rgba(34, 197, 94, 0.05)' },
                { offset: 1, color: 'rgba(34, 197, 94, 0.0)' },
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

  // Performance Heatmap Treemap
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
          ? '#15803D'
          : pct >= 1
            ? '#16A34A'
            : pct >= 0
              ? '#22C55E'
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
        backgroundColor: '#0B120E',
        borderColor: 'rgba(34, 197, 94, 0.35)',
        textStyle: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Roboto, sans-serif' },
        formatter: (params: unknown) => {
          const p = (params as { data?: { displaySymbol?: string; price?: number; pct?: number; value?: number } }).data;
          if (!p?.displaySymbol) return '';
          return `<div style="font-family:Roboto,sans-serif;font-size:12px;">
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
            fontWeight: 700,
          },
          data: items,
        },
      ],
    };
  }, [allMarkets, exchange]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-28 rounded-[22px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <SkeletonBlock className="h-[340px] lg:col-span-8 rounded-[22px]" />
          <SkeletonBlock className="h-[340px] lg:col-span-4 rounded-[22px]" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <KineticCard className="rounded-[22px] p-8 text-center">
        <h2 className="text-base font-bold text-[#111814]">Live Market Data Temporarily Unavailable</h2>
        <p className="text-xs text-[#637369] mt-1">{error}</p>
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

  const stats = data?.aggregateStats;
  const fearGreed = data?.fearAndGreed;
  const fgPositive = (fearGreed?.value ?? 50) >= 50;
  const setup = activeReport?.signalSetup ?? null;
  const sigDir = setup?.direction ?? 'WAIT';
  const topIndicators = (activeReport?.indicators ?? []).slice(0, 4);

  return (
    <div className="space-y-4">
      {/* ROW 1: 3 Signature KPI Bento Cards (Featured Dark Obsidian + 2 Alabaster Cards with MiniSparkBars) */}
      <section aria-label="Market Summary Metrics" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Featured Dark Obsidian-Emerald Hero Spot Price Card */}
        <KineticCard
          delay={0}
          surface="dark"
          interactive
          className="rounded-[22px] px-5 py-4 flex items-center justify-between gap-4"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-[#9BB0A3]">
              <div className="relative inline-flex items-center">
                <select
                  aria-label="Select hero chart pair"
                  value={heroSymbol}
                  onChange={(e) => setHeroSymbol(e.target.value)}
                  className="appearance-none bg-transparent pr-4 font-semibold text-[#D9E7DE] focus:outline-none cursor-pointer"
                >
                  {heroPairOptions.map((sym) => (
                    <option key={sym} value={sym} className="bg-[#0E1812] text-white">
                      {sym}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 -ml-3.5 pointer-events-none text-[#8FA398]" />
              </div>
              <span className="opacity-65">
                {exchange === 'stocks' ? 'Equity Price' : exchange === 'cfds' ? 'CFD Price' : 'Spot Price'}
              </span>
            </div>

            <div className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-white tracking-tight truncate">
              <KineticPrice
                darkSurface
                value={heroPrice}
                formatted={heroPrice ? `$${formatPrice(heroPrice, preferences.decimalPrecision)}` : '—'}
              />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-medium">
              <span
                className={`inline-flex items-center gap-0.5 font-mono font-semibold ${
                  heroChangePct >= 0 ? 'text-[#4ADE80]' : 'text-[#FB7185]'
                }`}
              >
                {heroChangePct >= 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                {formatPercent(heroChangePct)}
              </span>
              <span className="text-[#7D9486]">24h performance</span>
            </div>
          </div>

          <MiniSparkBars values={priceSparkBars} variant="dark-emerald" />
        </KineticCard>

        {/* Card 2: Market Sentiment Index */}
        <KineticCard
          delay={0.05}
          interactive
          className="rounded-[22px] px-5 py-4 flex items-center justify-between gap-4"
        >
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-medium text-[#637369] truncate">
              Market Sentiment Index
            </div>
            <div className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-[#111814] tracking-tight">
              {fearGreed ? fearGreed.value : '—'}
              <span className="text-sm font-normal text-[#8D9D93]">/100</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className={`font-semibold ${fgPositive ? 'text-[#15803D]' : 'text-[#BE123C]'}`}>
                {fearGreed?.classification ?? 'Neutral'}
              </span>
              <span className="text-[#7A8B80]">Fear &amp; Greed</span>
            </div>
          </div>

          <MiniSparkBars values={sentimentSparkBars} variant={fgPositive ? 'light-emerald' : 'light-rose'} />
        </KineticCard>

        {/* Card 3: 24h Exchange Volume / Asset Breadth */}
        <KineticCard
          delay={0.1}
          interactive
          className="rounded-[22px] px-5 py-4 flex items-center justify-between gap-4"
        >
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-medium text-[#637369] truncate">
              {exchange === 'cfds'
                ? `CFD Breadth (${EXCHANGE_LABELS[exchange]})`
                : `24h Volume (${EXCHANGE_LABELS[exchange]})`}
            </div>
            <div className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-[#111814] tracking-tight truncate">
              {exchange === 'cfds'
                ? `${stats?.aboveEma50Pct ?? 0}%`
                : formatCompactUsd(stats?.exchangeVolume24hUsd)}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono">
              <span className="font-semibold text-[#15803D]">
                {stats?.trackedAssets ?? 0} {exchange === 'stocks' ? 'stocks' : exchange === 'cfds' ? 'cfds' : 'pairs'}
              </span>
              <span className="text-[#7A8B80] truncate">
                {exchange === 'stocks'
                  ? `NVDA ${stats?.btcDominanceProxy ?? '—'}% · AAPL ${stats?.ethDominanceProxy ?? '—'}%`
                  : exchange === 'cfds'
                    ? `${stats?.bullishCount ?? 0}B · ${stats?.bearishCount ?? 0}S`
                    : `BTC ${stats?.btcDominanceProxy ?? '—'}% · ETH ${stats?.ethDominanceProxy ?? '—'}%`}
              </span>
            </div>
          </div>

          <MiniSparkBars values={volSparkBars} variant="light-emerald" />
        </KineticCard>
      </section>

      {/* ROW 2: 8 + 4 Split — Market Price & Momentum Chart + Soft Sage-Mint Intelligent Signal Card */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <KineticCard delay={0.12} className="lg:col-span-8 rounded-[22px] p-5 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-[#111814]">
                Market Price &amp; Momentum Index
              </h2>
              <p className="text-[11px] text-[#637369] mt-0.5 font-mono">
                {heroSymbol} · {EXCHANGE_LABELS[exchange]} · Indexed candle momentum ({heroTf})
              </p>
            </div>

            <KineticSegmentedControl
              options={HERO_TIMEFRAMES}
              value={heroTf}
              onChange={setHeroTf}
              layoutId="overview-hero-tf"
              size="xs"
              variant="obsidian"
            />
          </div>

          <div className="mt-2">
            {heroLoading && heroCandles.length === 0 ? (
              <SkeletonBlock className="h-[246px] rounded-2xl" />
            ) : (
              <EChartBox option={heroChartOption} height={246} />
            )}
          </div>
        </KineticCard>

        {/* Right (4 cols): Signature Soft Sage-Mint Highlight Card */}
        <KineticCard
          delay={0.16}
          surface="sage"
          className="lg:col-span-4 rounded-[22px] p-5 flex flex-col justify-between gap-4"
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#3F5346]">
              <span>Intelligent Signal · {heroSymbol.replace('/', '')}</span>
              <span>{heroTf.toUpperCase()}</span>
            </div>

            <div className="flex items-baseline gap-2.5 flex-wrap pt-1">
              <span
                data-testid="hero-signal-direction"
                className="text-4xl sm:text-[42px] font-black font-mono tabular-nums tracking-tight leading-none text-[#101A13]"
              >
                {activeReport ? `${activeReport.agreement.agreementPct}%` : '—'}
              </span>
              <span
                className={`text-sm font-bold uppercase tracking-wider ${
                  sigDir === 'BUY'
                    ? 'text-[#15803D]'
                    : sigDir === 'SELL'
                      ? 'text-[#BE123C]'
                      : 'text-[#526559]'
                }`}
              >
                {sigDir}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-medium">
              {sigDir === 'SELL' ? (
                <TrendingDown className="w-3.5 h-3.5 text-[#BE123C]" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5 text-[#15803D]" />
              )}
              <span className={sigDir === 'SELL' ? 'text-[#BE123C]' : 'text-[#15803D]'}>
                {activeReport
                  ? `${activeReport.label} · ${activeReport.regime.combinedLabel}`
                  : 'Evaluating live confluence'}
              </span>
            </div>
          </div>

          <div className="space-y-3 py-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#101A13]/[0.07] flex items-center justify-center text-[#15803D] shrink-0">
                <Target className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#101A13] leading-snug">
                  Entry &amp; Stop Loss
                </div>
                <div className="text-xs font-mono tabular-nums text-[#4A5E51] truncate">
                  {setup && setup.direction !== 'WAIT' && setup.stopLoss !== null
                    ? `${setup.entryMode === 'NOW' ? `NOW $${formatPrice(heroPrice ?? setup.entryPrice, preferences.decimalPrecision)}` : `$${formatPrice(setup.entryZoneLow, preferences.decimalPrecision)}`} · SL $${formatPrice(setup.stopLoss, preferences.decimalPrecision)}`
                    : `Price $${formatPrice(heroPrice, preferences.decimalPrecision)} · Neutral range`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#101A13]/[0.07] flex items-center justify-center text-[#15803D] shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#101A13] leading-snug">
                  Take Profit Targets
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#4A5E51] leading-snug">
                  {setup && setup.takeProfits.length > 0
                    ? setup.takeProfits
                        .slice(0, 2)
                        .map((tp) => `${tp.label} $${formatPrice(tp.price, preferences.decimalPrecision)}`)
                        .join(' · ')
                    : `${stats?.bullishCount ?? 0} bullish · ${stats?.bearishCount ?? 0} bearish pairs`}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2.5 border-t border-[#101A13]/10 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[10px] font-mono text-[#4A5E51] truncate">
              {topIndicators.map((ind) => (
                <span key={ind.id} className="uppercase">
                  {ind.id}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-xs font-bold text-[#101A13] hover:underline whitespace-nowrap shrink-0"
            >
              All Signals →
            </button>
          </div>
        </KineticCard>
      </section>

      {/* ROW 3: 8 + 4 Split — Live Market Overview Table + Obsidian Glassmorphic Confirmed Signals */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <KineticCard delay={0.18} className="lg:col-span-8 rounded-[22px] p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <h2 className="text-[15px] font-bold tracking-tight text-[#111814]">
              Live Market Overview
            </h2>
            <div className="relative inline-flex items-center">
              <select
                aria-label="Watchlist view mode"
                value={watchlistMode}
                onChange={(e) => setWatchlistMode(e.target.value as WatchlistMode)}
                className="appearance-none pl-3.5 pr-8 py-1.5 rounded-full bg-[#121814] text-white text-xs font-medium focus:outline-none cursor-pointer"
              >
                <option value="watchlist" className="bg-[#121814] text-white">Watchlist</option>
                <option value="gainers" className="bg-[#121814] text-white">Top Gainers</option>
                <option value="losers" className="bg-[#121814] text-white">Top Losers</option>
                <option value="volume" className="bg-[#121814] text-white">High Volume</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#A5B8AC] -ml-6 pointer-events-none" />
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#EDF1EE] text-[11px] text-[#7D8E84]">
                  <th className="pb-2.5 text-left font-medium">Asset</th>
                  <th className="pb-2.5 text-right font-medium">Price</th>
                  <th className="pb-2.5 text-right font-medium">24h</th>
                  <th className="pb-2.5 text-center font-medium hidden sm:table-cell">Dynamic</th>
                  <th className="pb-2.5 text-left font-medium pl-3 hidden md:table-cell">Structure</th>
                  <th className="pb-2.5 text-right font-medium">24h Volume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1] font-mono tabular-nums">
                {watchlistRows.map((tk) => {
                  const live = liveTickers[tk.canonicalId];
                  const price = live?.lastPrice ?? tk.lastPrice;
                  const pct = live?.change24hPct ?? tk.change24hPct;
                  const pos = pct >= 0;
                  const badge = coinBadgeStyle(tk.baseAsset);
                  const struct = structureBadge(pct);
                  const spark = leaderSparkById.get(tk.canonicalId) ?? [
                    price * (1 - pct / 180),
                    price * (1 - pct / 240),
                    price * (1 - pct / 320),
                    price,
                  ];
                  const isSelected = tk.displaySymbol === heroSymbol;
                  return (
                    <tr
                      key={tk.canonicalId}
                      onClick={() => {
                        setHeroSymbol(tk.displaySymbol);
                        selectMarket(tk.exchange, tk.marketType, tk.displaySymbol, false);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#EDF5EF]/75' : 'hover:bg-[#F5F8F6]'
                      }`}
                    >
                      <td className="py-2.5 pr-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${badge.bg}`}
                          >
                            {badge.glyph}
                          </span>
                          <div className="min-w-0">
                            <div className="font-bold text-[#111814] whitespace-nowrap">
                              {tk.displaySymbol}
                            </div>
                            <div className="text-[10px] font-sans text-[#7D8E84] truncate max-w-[120px]">
                              {tk.source}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-[#111814]">
                        <KineticPrice
                          value={price}
                          formatted={`$${formatPrice(price, preferences.decimalPrecision)}`}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <span className={`font-semibold ${pos ? 'text-[#15803D]' : 'text-[#BE123C]'}`}>
                          {formatPercent(pct)}
                        </span>
                      </td>
                      <td className="py-2.5 hidden sm:table-cell">
                        <div className="flex justify-center">
                          <EmeraldSparkline data={spark} positive={pos} />
                        </div>
                      </td>
                      <td className="py-2.5 pl-3 hidden md:table-cell font-sans">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${struct.style}`}>
                          {struct.label}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#637369]">
                        {tk.quoteVolume24h > 0 ? formatCompactUsd(tk.quoteVolume24h) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </KineticCard>

        {/* Right (4 cols): Obsidian Glassmorphic Confirmed Signals */}
        <KineticCard delay={0.22} className="lg:col-span-4 rounded-[22px] p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-bold tracking-tight text-[#111814]">
              Confirmed Signals
            </h2>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-xs font-bold text-[#16A34A] hover:underline"
            >
              Live Feed →
            </button>
          </div>
          <div className="space-y-2.5 overflow-y-auto max-h-[340px] pr-0.5">
            {(data?.recentSignals ?? []).length === 0 ? (
              <div className="py-10 text-center text-xs text-[#637369]">
                Background scanner populates confirmed technical signals after candle validation.
              </div>
            ) : (
              (data?.recentSignals ?? []).slice(0, 4).map((ev) =>
                ev.signalSetup ? (
                  <StructuredSignalCard
                    key={ev.id}
                    setup={ev.signalSetup}
                    timeframe={ev.timeframe}
                    exchangeLabel={EXCHANGE_LABELS[ev.exchange]}
                    compact
                    onOpenPair={() => selectMarket(ev.exchange, ev.marketType, ev.displaySymbol, true)}
                  />
                ) : (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => selectMarket(ev.exchange, ev.marketType, ev.displaySymbol, true)}
                    className="w-full sig-signal-neutral p-3 text-left space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-white">
                      <span>{ev.displaySymbol} · {ev.timeframe}</span>
                      <span className="text-[10px] text-[#4ADE80]">{ev.classification}</span>
                    </div>
                    <p className="text-[11px] text-white/70 line-clamp-2">{ev.summary}</p>
                  </button>
                ),
              )
            )}
          </div>
        </KineticCard>
      </section>

      {/* ROW 4: Full-Width Performance Heatmap Treemap */}
      <KineticCard delay={0.24} className="rounded-[22px] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-[#111814]">
              Performance Heatmap (24h Volume)
            </h2>
            <p className="text-[11px] text-[#637369]">{data?.exchangeCoverageNote}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadOverview}
              aria-label="Refresh overview data"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sig-glass-subtle text-xs font-medium text-[#4D5E54] hover:text-[#111814]"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('heatmaps')}
              className="text-xs font-bold text-[#16A34A] hover:underline"
            >
              Full Heatmaps →
            </button>
          </div>
        </div>
        <EChartBox
          option={heatmapOption}
          height={240}
          onChartClick={(params: unknown) => {
            const d = (params as { data?: { exchange?: MarketTicker['exchange']; marketType?: MarketTicker['marketType']; displaySymbol?: string } }).data;
            if (d?.exchange && d?.marketType && d?.displaySymbol) {
              selectMarket(d.exchange, d.marketType, d.displaySymbol, true);
            }
          }}
        />
      </KineticCard>
    </div>
  );
};
