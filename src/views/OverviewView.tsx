import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart2,
  ChevronDown,
  Coins,
  Gauge,
  Info,
  RefreshCw,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import amberCryptoImg from '../assets/images/amber_crypto_sculpture_1795240978092.jpg';
import { EChartBox } from '../components/charts/EChartBox';
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

const HERO_TIMEFRAMES: { tf: Timeframe; label: string }[] = [
  { tf: '15m', label: '15M' },
  { tf: '1h', label: '1H' },
  { tf: '4h', label: '4H' },
  { tf: '1d', label: '1D' },
];

function coinBadgeStyle(base: string): { bg: string; glyph: string } {
  const b = base.toUpperCase();
  if (b === 'BTC') return { bg: 'bg-[#F7931A] text-white', glyph: '₿' };
  if (b === 'ETH') return { bg: 'bg-[#627EEA] text-white', glyph: 'Ξ' };
  if (b === 'SOL') return { bg: 'bg-gradient-to-br from-[#00FFA3] to-[#DC1FFF] text-[#0B0705]', glyph: 'S' };
  if (b === 'BNB') return { bg: 'bg-[#F3BA2F] text-[#1D150F]', glyph: 'B' };
  if (b === 'XRP') return { bg: 'bg-[#2C3E50] text-white', glyph: '✕' };
  if (b === 'DOGE') return { bg: 'bg-[#C2A633] text-[#1D150F]', glyph: 'Ð' };
  if (b === 'AVAX') return { bg: 'bg-[#E84142] text-white', glyph: 'A' };
  return { bg: 'bg-[#EA731E] text-white', glyph: b.slice(0, 1) || '•' };
}

const GlowSparkline: React.FC<{ data: number[]; positive: boolean }> = ({ data, positive }) => {
  if (data.length < 2) {
    return <span className="text-[11px] font-mono text-[#756253] dark:text-[#B9A392]">—</span>;
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
  const stroke = positive ? '#22E59B' : '#FF747B';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-20 h-7 shrink-0">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
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

  const isDark =
    preferences.theme === 'dark' ||
    (preferences.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Sync hero symbol when exchange switches quote currency (e.g., BTC/USDT vs BTC/USD)
  useEffect(() => {
    const defaultSym = exchange === 'kraken' || exchange === 'coinbase' ? 'BTC/USD' : 'BTC/USDT';
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

  // Load real OHLCV & explainable Intelligent Signal for the active hero pair
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

  // Pair selector options (top leaders + current symbol)
  const heroPairOptions = useMemo(() => {
    const set = new Set<string>([heroSymbol]);
    (data?.leaders ?? []).forEach((l) => set.add(l.ticker.displaySymbol));
    allMarkets.slice(0, 10).forEach((m) => set.add(m.displaySymbol));
    return Array.from(set).slice(0, 12);
  }, [heroSymbol, data?.leaders, allMarkets]);

  // Sunset Valley glowing amber-orange area chart matching the reference aesthetic
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
      animation: false,
      grid: { left: 10, right: 64, top: 18, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#FFF7EE',
        borderColor: 'rgba(234, 115, 30, 0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#1A110A', fontFamily: 'Plus Jakarta Sans, sans-serif' },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(255, 180, 105, 0.45)', type: 'dashed' },
        },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const item = list[0] as { dataIndex?: number; value?: number };
          const idx = item?.dataIndex ?? 0;
          const val = typeof item?.value === 'number' ? item.value : 0;
          return `<div style="text-align:center;">
            <div style="font-size:11px;color:#735B49;margin-bottom:2px;">${fullDates[idx] ?? ''}</div>
            <div style="font-family:IBM Plex Mono,monospace;font-size:15px;font-weight:700;color:#140C07;">$${formatPrice(val, preferences.decimalPrecision)}</div>
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
          color: isDark ? '#A89485' : '#756253',
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 10,
          interval: Math.max(Math.floor(labels.length / 6), 1),
        },
        splitLine: {
          show: true,
          lineStyle: { color: isDark ? 'rgba(255, 182, 112, 0.06)' : 'rgba(130, 95, 65, 0.08)' },
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
          color: isDark ? '#B9A392' : '#756253',
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(1)}K` : formatPrice(v, preferences.decimalPrecision),
        },
        splitLine: {
          show: true,
          lineStyle: { color: isDark ? 'rgba(255, 182, 112, 0.08)' : 'rgba(130, 95, 65, 0.1)' },
        },
      },
      series: [
        {
          type: 'line',
          smooth: 0.25,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          data: prices,
          itemStyle: {
            color: '#FFF8F0',
            borderColor: '#FF9124',
            borderWidth: 2.5,
          },
          lineStyle: {
            width: 2.5,
            color: '#FF9124',
            shadowColor: 'rgba(255, 145, 36, 0.55)',
            shadowBlur: 12,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(244, 126, 26, 0.58)' },
                { offset: 0.55, color: 'rgba(198, 76, 14, 0.24)' },
                { offset: 1, color: 'rgba(24, 14, 8, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [heroCandles, heroTf, isDark, preferences.decimalPrecision, preferences.timezone]);

  // Real indicator bar breakdown for the Intelligent Signal panel
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
      // Convert evidence [-1, +1] into directional conviction strength 0..100%
      const strengthPct = Math.round(Math.min(98, Math.max(18, Math.abs(ind.evidence) * 70 + 28)));
      return {
        id: ind.id,
        label: labelMap[ind.id] ?? ind.name,
        pct: strengthPct,
        bias: ind.bias,
      };
    });
  }, [activeReport]);

  // Watchlist / Top Movers rows
  const watchlistRows = useMemo(() => {
    if (watchlistMode === 'gainers') return (data?.topGainers ?? []).slice(0, 5);
    if (watchlistMode === 'losers') return (data?.topLosers ?? []).slice(0, 5);
    if (watchlistMode === 'volume') return (data?.highestVolume ?? []).slice(0, 5);

    const matched: MarketTicker[] = [];
    for (const cid of watchlist) {
      const tk = marketById.get(cid);
      if (tk) matched.push(tk);
    }
    if (matched.length >= 3) return matched.slice(0, 5);
    return (data?.leaders ?? []).map((l) => l.ticker).slice(0, 5);
  }, [watchlistMode, data, watchlist, marketById]);

  // Real Market Momentum calculation from breadthScore (-100..+100 -> 0..100%)
  const stats = data?.aggregateStats;
  const breadthScore = stats?.breadthScore ?? 0;
  const momentumPct = Math.round(Math.max(4, Math.min(96, (breadthScore + 100) / 2)));
  const momentumLabel =
    breadthScore >= 20 ? 'Bullish' : breadthScore <= -20 ? 'Bearish' : 'Neutral';

  // 7 vertical momentum spectrum bars driven by real breadth + EMA50 + EMA200 telemetry
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

  // ECharts Treemap Performance Heatmap (below fold secondary view)
  const heatmapOption: EChartsOption = useMemo(() => {
    const stableBases = new Set([
      'USDC', 'USDT', 'FDUSD', 'USDE', 'USD1', 'RLUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDG', 'PYUSD', 'EUR', 'EURI', 'TRY', 'AEUR',
    ]);
    const top = allMarkets
      .filter((m) => (m.quoteAsset === 'USDT' || m.quoteAsset === 'USD') && !stableBases.has(m.baseAsset))
      .slice(0, 20);
    const items = top.map((t) => {
      const pct = t.change24hPct;
      const color =
        pct >= 4
          ? '#168C63'
          : pct >= 1
            ? '#1FA879'
            : pct >= 0
              ? '#276B56'
              : pct <= -4
                ? '#B1383F'
                : pct <= -1
                  ? '#CE4C54'
                  : '#7B393E';
      return {
        name: `${t.baseAsset}\n${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        value: Math.max(t.quoteVolume24h, 1),
        displaySymbol: t.displaySymbol,
        exchange: t.exchange,
        marketType: t.marketType,
        pct,
        price: t.lastPrice,
        itemStyle: { color, borderColor: '#130B07', borderWidth: 2, gapWidth: 2 },
      };
    });

    return {
      animation: false,
      tooltip: {
        backgroundColor: '#1D120B',
        borderColor: 'rgba(255, 174, 96, 0.28)',
        textStyle: { color: '#FFF8F0', fontSize: 12 },
        formatter: (params: unknown) => {
          const p = (params as { data?: { displaySymbol?: string; price?: number; pct?: number; value?: number } }).data;
          if (!p?.displaySymbol) return '';
          return `<div style="font-family:IBM Plex Mono,monospace;font-size:12px;">
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
          animation: false,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          label: {
            show: true,
            color: '#FFF8F0',
            fontFamily: 'IBM Plex Mono, monospace',
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
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <SkeletonBlock className="h-[420px] lg:col-span-7" />
          <SkeletonBlock className="h-[420px] lg:col-span-5" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <SkeletonBlock className="h-60 lg:col-span-3" />
          <SkeletonBlock className="h-60 lg:col-span-5" />
          <SkeletonBlock className="h-60 lg:col-span-4" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="sig-glass rounded-2xl p-8 text-center">
        <h2 className="text-base font-semibold">Live Market Data Temporarily Unavailable</h2>
        <p className="text-xs text-[#756253] dark:text-[#B9A392] mt-1">{error}</p>
        <button
          type="button"
          onClick={loadOverview}
          className="mt-4 px-4 py-2 text-xs font-semibold rounded-xl sig-btn-primary"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const fearGreed = data?.fearAndGreed;
  const fgPositive = (fearGreed?.value ?? 50) >= 50;
  const activeSignalsCount = Math.max(
    (stats?.bullishCount ?? 0) + (stats?.bearishCount ?? 0),
    data?.recentSignals?.length ?? 0,
  );
  const setup = activeReport?.signalSetup ?? null;
  const sigDir = setup?.direction ?? 'WAIT';

  return (
    <div className="space-y-5">
      {/* ROW 1: 4 Warm Glass KPI Cards (Matching Sunset Valley Header Strip) */}
      <section aria-label="Market Summary Metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Exchange Liquidity / BTC-ETH Share */}
        <div className="sig-glass rounded-2xl px-4 py-3.5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#F28C28]/25 to-[#8C3B0C]/30 border border-[#FFA95C]/25 flex items-center justify-center text-[#FF9B3D] shrink-0">
            <Coins className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[#756253] dark:text-[#C5B1A0] truncate">
              BTC / ETH Vol Share
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
              <span className="text-xl font-bold font-mono tabular-nums text-[#1D150F] dark:text-[#FFF8F0]">
                {stats?.btcDominanceProxy !== null ? `${stats?.btcDominanceProxy}%` : '—'}
              </span>
              <span className="text-xs font-mono font-semibold text-[#12A875] dark:text-[#22E59B]">
                ETH {stats?.ethDominanceProxy !== null ? `${stats?.ethDominanceProxy}%` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: 24h Volume */}
        <div className="sig-glass rounded-2xl px-4 py-3.5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#F28C28]/25 to-[#8C3B0C]/30 border border-[#FFA95C]/25 flex items-center justify-center text-[#FF9B3D] shrink-0">
            <BarChart2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[#756253] dark:text-[#C5B1A0] truncate">
              24h Volume ({exchange})
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
              <span className="text-xl font-bold font-mono tabular-nums text-[#1D150F] dark:text-[#FFF8F0]">
                {formatCompactUsd(stats?.exchangeVolume24hUsd)}
              </span>
              <span className="text-xs font-mono font-semibold text-[#12A875] dark:text-[#22E59B]">
                {stats?.trackedAssets ?? 0} pairs
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Fear & Greed */}
        <div className="sig-glass rounded-2xl px-4 py-3.5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#F28C28]/25 to-[#8C3B0C]/30 border border-[#FFA95C]/25 flex items-center justify-center text-[#FFB144] shrink-0">
            <Gauge className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[#756253] dark:text-[#C5B1A0] truncate">
              Fear & Greed
            </div>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <span className="text-xl font-bold font-mono tabular-nums text-[#1D150F] dark:text-[#FFF8F0]">
                {fearGreed ? fearGreed.value : '—'}
                <span className="text-xs font-normal text-[#756253] dark:text-[#B9A392]">/100</span>
              </span>
              {fearGreed && (
                <span
                  className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold whitespace-nowrap ${
                    fgPositive
                      ? 'bg-[#22E59B]/16 text-[#12A875] dark:text-[#22E59B] border border-[#22E59B]/35'
                      : 'bg-[#F16B72]/16 text-[#DC4C54] dark:text-[#FF747B] border border-[#F16B72]/35'
                  }`}
                >
                  {fearGreed.classification}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card 4: Active Signals */}
        <button
          type="button"
          onClick={() => setActiveSection('signals')}
          className="sig-glass rounded-2xl px-4 py-3.5 flex items-center gap-3.5 text-left hover:border-[#EA731E]/55 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#F28C28]/25 to-[#8C3B0C]/30 border border-[#FFA95C]/25 flex items-center justify-center text-[#FF9B3D] shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[#756253] dark:text-[#C5B1A0] truncate">
              Active Signals
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
              <span className="text-xl font-bold font-mono tabular-nums text-[#1D150F] dark:text-[#FFF8F0]">
                {activeSignalsCount}
              </span>
              <span className="text-xs font-mono font-semibold text-[#12A875] dark:text-[#22E59B]">
                {stats?.bullishCount ?? 0}B · {stats?.bearishCount ?? 0}S
              </span>
            </div>
          </div>
        </button>
      </section>

      {/* ROW 2: Hero 2-Column Split — Interactive Sunset Area Chart + Intelligent Signal Panel */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Live Price Area Chart */}
        <div className="lg:col-span-7 sig-glass rounded-2xl p-5 flex flex-col justify-between">
          <div>
            {/* Pair Header + Timeframe Pills */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shadow-md ${heroCoinBadge.bg}`}
                  >
                    {heroCoinBadge.glyph}
                  </span>
                  <div className="relative inline-flex items-center">
                    <select
                      aria-label="Select hero chart pair"
                      value={heroSymbol}
                      onChange={(e) => setHeroSymbol(e.target.value)}
                      className="appearance-none bg-transparent pr-6 text-lg font-bold tracking-tight text-[#1D150F] dark:text-[#FFF8F0] focus:outline-none cursor-pointer"
                    >
                      {heroPairOptions.map((sym) => (
                        <option key={sym} value={sym} className="bg-[#FFFBF6] dark:bg-[#19100A] text-sm">
                          {sym}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 -ml-5 pointer-events-none text-[#756253] dark:text-[#C5B1A0]" />
                  </div>
                </div>

                <div className="flex items-baseline gap-3 pl-10">
                  <span className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-[#1D150F] dark:text-[#FFF8F0]">
                    {heroPrice ? `$${formatPrice(heroPrice, preferences.decimalPrecision)}` : '—'}
                  </span>
                  <span
                    className={`text-sm font-mono font-semibold tabular-nums ${
                      heroChangePct >= 0
                        ? 'text-[#12A875] dark:text-[#22E59B]'
                        : 'text-[#DC4C54] dark:text-[#FF747B]'
                    }`}
                  >
                    {heroChangePct >= 0 ? '↑' : '↓'} {formatPercent(heroChangePct)}
                  </span>
                </div>
              </div>

              {/* Timeframe Pill Switcher */}
              <div className="flex items-center gap-1 p-1 rounded-full sig-glass-subtle">
                {HERO_TIMEFRAMES.map(({ tf, label }) => {
                  const active = heroTf === tf;
                  return (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setHeroTf(tf)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-semibold transition-all whitespace-nowrap ${
                        active
                          ? 'sig-btn-primary'
                          : 'text-[#756253] dark:text-[#C5B1A0] hover:text-[#1D150F] dark:hover:text-[#FFF8F0]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Warm Glowing Area Chart */}
            <div className="mt-3 relative">
              {heroLoading && heroCandles.length === 0 ? (
                <SkeletonBlock className="h-[250px]" />
              ) : (
                <EChartBox option={heroChartOption} height={252} />
              )}
            </div>
          </div>

          {/* Subtle Bottom Segmented Trend Progress Track + Launch Explorer */}
          <div className="mt-3 pt-1 flex items-center justify-between gap-4">
            <div className="flex-1 grid grid-cols-6 gap-2">
              {Array.from({ length: 6 }).map((_, idx) => {
                const activeCount = Math.max(1, Math.round((momentumPct / 100) * 6));
                const isEmerald = idx === Math.min(5, activeCount - 1) && sigDir === 'BUY';
                const isCoral = idx === Math.min(5, activeCount - 1) && sigDir === 'SELL';
                const isLit = idx < activeCount;
                return (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-colors ${
                      isEmerald
                        ? 'bg-[#22E59B] shadow-[0_0_10px_#22E59B]'
                        : isCoral
                          ? 'bg-[#FF747B] shadow-[0_0_10px_#FF747B]'
                          : isLit
                            ? 'bg-[#EA731E]/65'
                            : 'bg-[#DFCBB6] dark:bg-[#3A271B]/70'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: INTELLIGENT SIGNAL Panel */}
        <div className="lg:col-span-5 sig-glass rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#FF9124]" />
                <h2 className="text-sm font-extrabold tracking-[0.06em] uppercase text-[#1D150F] dark:text-[#FFF8F0]">
                  Intelligent Signal
                </h2>
              </div>
              <span className="font-mono text-[11px] text-[#756253] dark:text-[#B9A392]">
                {heroSymbol.replace('/', '')} · {heroTf}
              </span>
            </div>

            {/* Prominent Direction Box + Confidence Readout */}
            <div className="grid grid-cols-2 gap-3">
              <div
                data-testid="hero-signal-direction"
                className={`rounded-xl px-4 py-3 flex items-center justify-center text-2xl font-extrabold tracking-wider border ${
                  sigDir === 'BUY'
                    ? 'bg-[#12A875]/18 text-[#12A875] dark:text-[#22E59B] border-[#22E59B]/55 shadow-[0_0_24px_rgba(34,229,155,0.18)]'
                    : sigDir === 'SELL'
                      ? 'bg-[#DC4C54]/18 text-[#DC4C54] dark:text-[#FF747B] border-[#FF747B]/55 shadow-[0_0_24px_rgba(241,107,114,0.18)]'
                      : 'bg-[#EA731E]/15 text-[#D96418] dark:text-[#FFB144] border-[#FFA95C]/45'
                }`}
              >
                {sigDir}
              </div>

              <div className="rounded-xl sig-glass-subtle px-4 py-2.5 flex flex-col items-center justify-center">
                <span className="text-[11px] font-medium text-[#756253] dark:text-[#C5B1A0]">
                  Agreement
                </span>
                <span
                  className={`text-2xl font-extrabold font-mono tabular-nums ${
                    sigDir === 'BUY'
                      ? 'text-[#12A875] dark:text-[#22E59B]'
                      : sigDir === 'SELL'
                        ? 'text-[#DC4C54] dark:text-[#FF747B]'
                        : 'text-[#D96418] dark:text-[#FFB144]'
                  }`}
                >
                  {activeReport ? `${activeReport.agreement.agreementPct}%` : '—'}
                </span>
              </div>
            </div>

            {/* 6 Horizontal Indicator Strength Bars */}
            <div className="space-y-2.5">
              {indicatorBars.map((bar) => {
                const fillClass =
                  bar.bias === 'BULLISH'
                    ? 'bg-gradient-to-r from-[#13B981] to-[#28F0A5] shadow-[0_0_10px_rgba(34,229,155,0.35)]'
                    : bar.bias === 'BEARISH'
                      ? 'bg-gradient-to-r from-[#D94A52] to-[#FF747B] shadow-[0_0_10px_rgba(241,107,114,0.35)]'
                      : 'bg-gradient-to-r from-[#C86419] to-[#FF9B3D]';
                return (
                  <div key={bar.id} className="grid grid-cols-12 items-center gap-2.5 text-xs">
                    <span className="col-span-5 text-[#4B3B2F] dark:text-[#EDE0D4] truncate">
                      {bar.label}
                    </span>
                    <div className="col-span-5 h-2 rounded-full bg-[#E8DDD1] dark:bg-[#2F2016] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${fillClass}`}
                        style={{ width: `${bar.pct}%` }}
                      />
                    </div>
                    <span className="col-span-2 text-right font-mono tabular-nums text-[#4B3B2F] dark:text-[#FFF8F0]">
                      {bar.pct}%
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Compact Live Entry / SL / TP1-TP3 Strip */}
            {setup && setup.direction !== 'WAIT' && setup.stopLoss !== null && (
              <div className="rounded-xl sig-glass-subtle px-3 py-2 font-mono text-[11px] tabular-nums flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-[#1D150F] dark:text-[#FFF8F0]">
                  Entry:{' '}
                  <strong className="text-[#D96418] dark:text-[#FF9843]">
                    {setup.entryMode === 'NOW'
                      ? `NOW $${formatPrice(heroPrice ?? setup.entryPrice, preferences.decimalPrecision)}`
                      : `$${formatPrice(setup.entryZoneLow, preferences.decimalPrecision)}–$${formatPrice(setup.entryZoneHigh, preferences.decimalPrecision)}`}
                  </strong>
                </span>
                <span className="text-[#DC4C54] dark:text-[#FF747B]">
                  SL: ${formatPrice(setup.stopLoss, preferences.decimalPrecision)}
                </span>
                {setup.takeProfits[0] && (
                  <span className="text-[#12A875] dark:text-[#22E59B]">
                    TP1: ${formatPrice(setup.takeProfits[0].price, preferences.decimalPrecision)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Summary Footer */}
          <div className="pt-2 border-t border-[#E8DDD1]/70 dark:border-[#FFA95C]/12 flex items-end justify-between gap-3">
            <p className="text-xs leading-relaxed text-[#5C493C] dark:text-[#DFCDBE] line-clamp-2">
              <span className="font-semibold text-[#D96418] dark:text-[#FF9843]">Summary: </span>
              {activeReport
                ? `${activeReport.label} (${activeReport.regime.combinedLabel}). ${activeReport.supportingEvidence[0] ?? 'Multi-indicator confluence evaluated deterministically.'}`
                : 'Computing deterministic multi-indicator confluence from live exchange candles.'}
            </p>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-[11px] font-semibold text-[#D96418] dark:text-[#FF9843] hover:underline whitespace-nowrap shrink-0"
            >
              All Signals →
            </button>
          </div>
        </div>
      </section>

      {/* ROW 3: 3-Column Bottom Deck — Amber Coin Visual + Market Watchlist + Market Momentum */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Sculptural Amber-Bronze Coin Visual Tile */}
        <div className="lg:col-span-3 relative rounded-2xl overflow-hidden border border-[#E4D6C7] dark:border-[#FFA95C]/22 min-h-[215px] bg-gradient-to-br from-[#3D1E0C] via-[#1C0F08] to-[#0D0704] shadow-[0_12px_34px_rgba(0,0,0,0.4)]">
          <img
            src={amberCryptoImg}
            alt="Sculptural amber metallic digital asset visualization"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center"
          />
        </div>

        {/* Center: Market Watchlist Table */}
        <div className="lg:col-span-5 sig-glass rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-base font-bold text-[#1D150F] dark:text-[#FFF8F0]">
              Market Watchlist
            </h2>
            <select
              aria-label="Watchlist view mode"
              value={watchlistMode}
              onChange={(e) => setWatchlistMode(e.target.value as WatchlistMode)}
              className="px-3 py-1 rounded-full sig-glass-subtle text-xs font-medium text-[#5C493C] dark:text-[#DECBB9]"
            >
              <option value="watchlist" className="bg-[#FFFBF6] dark:bg-[#19100A]">
                Watchlist
              </option>
              <option value="gainers" className="bg-[#FFFBF6] dark:bg-[#19100A]">
                Top Movers
              </option>
              <option value="losers" className="bg-[#FFFBF6] dark:bg-[#19100A]">
                Top Losers
              </option>
              <option value="volume" className="bg-[#FFFBF6] dark:bg-[#19100A]">
                High Volume
              </option>
            </select>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#E8DDD1] dark:border-[#FFA95C]/12 text-[#756253] dark:text-[#B9A392]">
                  <th className="py-2 text-left font-medium">Pair</th>
                  <th className="py-2 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">24h Change</th>
                  <th className="py-2 text-right font-medium">24h Vol</th>
                  <th className="py-2 text-right font-medium hidden sm:table-cell">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DDD1]/60 dark:divide-[#FFA95C]/10 font-mono tabular-nums">
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
                      className="cursor-pointer hover:bg-[#EFE4D7]/50 dark:hover:bg-[#2F1E13]/60 transition-colors"
                    >
                      <td className="py-2.5 pr-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${badge.bg}`}
                          >
                            {badge.glyph}
                          </span>
                          <span className="font-semibold text-[#1D150F] dark:text-[#FFF8F0] whitespace-nowrap">
                            {tk.displaySymbol}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-[#1D150F] dark:text-[#FFF8F0]">
                        ${formatPrice(price, preferences.decimalPrecision)}
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            pos
                              ? 'bg-[#22E59B]/14 text-[#12A875] dark:text-[#22E59B]'
                              : 'bg-[#F16B72]/14 text-[#DC4C54] dark:text-[#FF747B]'
                          }`}
                        >
                          {pos ? '↑' : '↓'} {formatPercent(pct)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#756253] dark:text-[#C5B1A0]">
                        {formatCompactUsd(tk.quoteVolume24h)}
                      </td>
                      <td className="py-2.5 pl-2 hidden sm:table-cell">
                        <div className="flex justify-end">
                          <GlowSparkline data={spark} positive={pos} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Market Momentum Card */}
        <div className="lg:col-span-4 sig-glass rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[#1D150F] dark:text-[#FFF8F0]">
              Market Momentum
            </h2>
            <button
              type="button"
              onClick={() => setMomentumInfoOpen((v) => !v)}
              aria-label="Market momentum formula details"
              className="p-1 rounded-full text-[#756253] dark:text-[#B9A392] hover:text-[#1D150F] dark:hover:text-[#FFF8F0]"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          {momentumInfoOpen && (
            <p className="text-[11px] text-[#756253] dark:text-[#C5B1A0] mt-1">
              Derived from live {exchange} 1h breadth ({stats?.bullishCount ?? 0} bullish /{' '}
              {stats?.bearishCount ?? 0} bearish across {stats?.analyzedAssets ?? 0} pairs,{' '}
              {stats?.aboveEma50Pct ?? 0}% above EMA 50).
            </p>
          )}

          {/* Rising Spectrum Vertical Bars + Percentage Readout */}
          <div className="my-4 flex items-end justify-between gap-4">
            <div className="flex-1 flex items-end gap-2 h-28 pt-2">
              {momentumBars.map((bar, idx) => (
                <div
                  key={idx}
                  className="flex-1 h-full flex items-end"
                >
                  <div
                    className={`w-full rounded-t-md transition-all duration-300 ${
                      bar.isPeak
                        ? momentumLabel === 'Bearish'
                          ? 'bg-gradient-to-t from-[#5C1A1F] via-[#E14D55] to-[#FF7B82] shadow-[0_0_16px_rgba(241,107,114,0.45)]'
                          : 'bg-gradient-to-t from-[#0D5B3E] via-[#15C784] to-[#34F5A8] shadow-[0_0_16px_rgba(34,229,155,0.45)]'
                        : 'bg-gradient-to-t from-[#26160C] via-[#9C4E19] to-[#E9862A]'
                    }`}
                    style={{ height: `${bar.heightPct}%` }}
                  />
                </div>
              ))}
            </div>

            <div className="text-right shrink-0 space-y-1.5 pb-1">
              <div
                className={`text-3xl font-extrabold font-mono tabular-nums ${
                  momentumLabel === 'Bullish'
                    ? 'text-[#12A875] dark:text-[#22E59B]'
                    : momentumLabel === 'Bearish'
                      ? 'text-[#DC4C54] dark:text-[#FF747B]'
                      : 'text-[#D96418] dark:text-[#FFB144]'
                }`}
              >
                {momentumPct}%
              </div>
              <span
                className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${
                  momentumLabel === 'Bullish'
                    ? 'bg-[#22E59B]/16 text-[#12A875] dark:text-[#22E59B] border-[#22E59B]/40'
                    : momentumLabel === 'Bearish'
                      ? 'bg-[#F16B72]/16 text-[#DC4C54] dark:text-[#FF747B] border-[#F16B72]/40'
                      : 'bg-[#F59E0B]/16 text-[#D96418] dark:text-[#FFB144] border-[#F59E0B]/40'
                }`}
              >
                {momentumLabel}
              </span>
            </div>
          </div>

          {/* Bearish — Neutral — Bullish Horizontal Spectrum Bar */}
          <div className="space-y-1.5">
            <div className="relative h-2 rounded-full bg-gradient-to-r from-[#D94B52] via-[#F2A93B] to-[#22E59B]">
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#FFF8F0] border-2 border-[#22E59B] shadow-[0_0_10px_rgba(34,229,155,0.8)] transition-all duration-300"
                style={{ left: `${momentumPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-medium text-[#756253] dark:text-[#C5B1A0]">
              <span>Bearish</span>
              <span>Neutral</span>
              <span>Bullish</span>
            </div>
          </div>
        </div>
      </section>

      {/* ROW 4 (Below the Fold): Performance Heatmap + Confirmed Signal Activity */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 sig-glass rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-bold text-[#1D150F] dark:text-[#FFF8F0]">
                Performance Heatmap (24h Quote Volume)
              </h2>
              <p className="text-[11px] text-[#756253] dark:text-[#B9A392]">
                {data?.exchangeCoverageNote}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={loadOverview}
                aria-label="Refresh overview data"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg sig-glass-subtle text-xs font-medium text-[#5C493C] dark:text-[#DECBB9]"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('heatmaps')}
                className="text-xs font-semibold text-[#D96418] dark:text-[#FF9843] hover:underline"
              >
                Full Heatmaps
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
        </div>

        <div className="xl:col-span-4 sig-glass rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[#1D150F] dark:text-[#FFF8F0]">
              Confirmed Signal Activity
            </h2>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-xs font-semibold text-[#D96418] dark:text-[#FF9843] hover:underline"
            >
              Live Feed →
            </button>
          </div>
          <div className="divide-y divide-[#E8DDD1]/60 dark:divide-[#FFA95C]/12 overflow-y-auto max-h-[260px]">
            {(data?.recentSignals ?? []).length === 0 ? (
              <div className="py-8 text-center text-xs text-[#756253] dark:text-[#B9A392]">
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
                    className="w-full py-2.5 text-left hover:bg-[#EFE4D7]/40 dark:hover:bg-[#2F1E13]/50 px-1.5 rounded-lg transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[#1D150F] dark:text-[#FFF8F0]">
                        {compactSym} · {ev.timeframe}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${signalBgClass(ev.classification)}`}>
                        {dirText}
                      </span>
                    </div>
                    {evSetup && evSetup.direction !== 'WAIT' && evSetup.entryPrice !== null && evSetup.stopLoss !== null ? (
                      <div className="mt-1 space-y-0.5 font-mono text-[10px] tabular-nums">
                        <div className="text-[#4B3B2F] dark:text-[#EDE0D4]">
                          Entry: {evSetup.entryMode === 'NOW' ? `NOW $${formatPrice(evSetup.entryPrice)}` : `$${formatPrice(evSetup.entryZoneLow)}–$${formatPrice(evSetup.entryZoneHigh)}`}
                        </div>
                        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                          <span className="text-[#DC4C54] dark:text-[#FF747B]">
                            SL: ${formatPrice(evSetup.stopLoss)}
                          </span>
                          {evSetup.takeProfits[0] && (
                            <span className="text-[#12A875] dark:text-[#22E59B]">
                              TP1: ${formatPrice(evSetup.takeProfits[0].price)}
                            </span>
                          )}
                          {evSetup.takeProfits[1] && (
                            <span className="text-[#12A875] dark:text-[#22E59B]">
                              TP2: ${formatPrice(evSetup.takeProfits[1].price)}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#756253] dark:text-[#B9A392] mt-1 line-clamp-2">
                        {ev.summary}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-[#756253] dark:text-[#B9A392] mt-1">
                      {ev.exchange} · {formatTimestamp(ev.candleTimestamp, preferences.timezone, false)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
