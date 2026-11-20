import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { EChartBox } from '../components/charts/EChartBox';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import {
  formatCompactUsd,
  formatPercent,
  formatPrice,
  formatTimestamp,
  signalBgClass,
  signalColorClass,
  signalLabel,
} from '../shared/format';
import type { MarketOverviewPayload, MarketTicker } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type MoverTab = 'gainers' | 'losers' | 'volume' | 'unusual' | 'momentum' | 'downtrend';

const MiniSparkline: React.FC<{ data: number[]; positive: boolean }> = ({ data, positive }) => {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(max - min, 1e-9);
  const w = 110;
  const h = 34;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-20 max-w-full h-8 shrink-0">
      <polyline
        fill="none"
        stroke={positive ? '#35C89A' : '#F16B72'}
        strokeWidth="1.75"
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
  const preferences = useAppStore((s) => s.preferences);
  const watchlist = useAppStore((s) => s.watchlist);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);
  const reorderWatchlist = useAppStore((s) => s.reorderWatchlist);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [data, setData] = useState<MarketOverviewPayload | null>(null);
  const [allMarkets, setAllMarkets] = useState<MarketTicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moverTab, setMoverTab] = useState<MoverTab>('gainers');
  const [watchlistFilter, setWatchlistFilter] = useState('');
  const [addPairInput, setAddPairInput] = useState('');

  const loadData = async () => {
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
    loadData();
    const id = window.setInterval(loadData, 45_000);
    return () => window.clearInterval(id);
  }, [exchange, marketType]);

  const marketById = useMemo(() => {
    const m = new Map<string, MarketTicker>();
    allMarkets.forEach((t) => m.set(t.canonicalId, t));
    return m;
  }, [allMarkets]);

  // ECharts Treemap Performance Heatmap (excludes stablecoins; animation disabled to prevent flicker)
  const heatmapOption: EChartsOption = useMemo(() => {
    const stableBases = new Set([
      'USDC', 'USDT', 'FDUSD', 'USDE', 'USD1', 'RLUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDG', 'PYUSD', 'EUR', 'EURI', 'TRY', 'AEUR',
    ]);
    const top = allMarkets
      .filter((m) => (m.quoteAsset === 'USDT' || m.quoteAsset === 'USD') && !stableBases.has(m.baseAsset))
      .slice(0, 24);
    const items = top.map((t) => {
      const pct = t.change24hPct;
      const color =
        pct >= 4
          ? '#1A7F5E'
          : pct >= 1
            ? '#249E77'
            : pct >= 0
              ? '#2B6E5C'
              : pct <= -4
                ? '#B93C44'
                : pct <= -1
                  ? '#D4525A'
                  : '#7A3E46';
      return {
        name: `${t.baseAsset}\n${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        value: Math.max(t.quoteVolume24h, 1),
        canonicalId: t.canonicalId,
        displaySymbol: t.displaySymbol,
        exchange: t.exchange,
        marketType: t.marketType,
        pct,
        price: t.lastPrice,
        itemStyle: { color, borderColor: '#0B0F14', borderWidth: 2, gapWidth: 2 },
      };
    });

    return {
      animation: false,
      tooltip: {
        backgroundColor: '#151B23',
        borderColor: '#27313C',
        textStyle: { color: '#F4F7FA', fontSize: 12 },
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
            color: '#F4F7FA',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 11,
            fontWeight: 600,
          },
          data: items,
        },
      ],
    };
  }, [allMarkets]);

  const handleAddWatchlist = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = addPairInput.trim().toUpperCase();
    if (!cleaned) return;
    const sym = cleaned.includes('/') ? cleaned : `${cleaned}/${exchange === 'kraken' || exchange === 'coinbase' ? 'USD' : 'USDT'}`;
    const cid = `${exchange}:${marketType}:${sym}`;
    if (!watchlist.includes(cid)) {
      toggleWatchlist(cid);
    }
    setAddPairInput('');
  };

  const moveWatchlistItem = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= watchlist.length) return;
    const copy = [...watchlist];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    reorderWatchlist(copy);
  };

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <SkeletonBlock className="h-80 lg:col-span-2" />
          <SkeletonBlock className="h-80" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-8 text-center">
        <h2 className="text-base font-semibold">Live Market Data Temporarily Unavailable</h2>
        <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-1">{error}</p>
        <button
          type="button"
          onClick={loadData}
          className="mt-4 px-4 py-2 text-xs font-medium rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14]"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const stats = data?.aggregateStats;
  const pulse = data?.marketPulse;
  const filteredWatchlist = watchlist.filter((cid) =>
    cid.toLowerCase().includes(watchlistFilter.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Page Title & Coverage Scope Notice */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#17212B] dark:text-[#F4F7FA]">
            Market Overview
          </h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            {data?.exchangeCoverageNote}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono text-[#677482] dark:text-[#8B97A5]">
          <span>Updated {formatTimestamp(data?.updatedAt, preferences.timezone, false)}</span>
          <button
            type="button"
            onClick={loadData}
            aria-label="Refresh overview data"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] text-[#17212B] dark:text-[#F4F7FA] hover:border-[#94A3B8]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Top Summary Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="text-xs text-[#677482] dark:text-[#8B97A5]">
            24h Exchange Vol ({exchange})
          </div>
          <div className="text-lg font-mono font-semibold tabular-nums mt-1">
            {formatCompactUsd(stats?.exchangeVolume24hUsd)}
          </div>
          <div className="text-[11px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
            {stats?.trackedAssets ?? 0} active pairs
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="text-xs text-[#677482] dark:text-[#8B97A5]">Fear & Greed Index</div>
          <div className="text-lg font-mono font-semibold tabular-nums mt-1">
            {data?.fearAndGreed ? `${data.fearAndGreed.value} / 100` : 'Unavailable'}
          </div>
          <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-1 truncate">
            {data?.fearAndGreed ? `${data.fearAndGreed.classification} · Daily` : 'Source unreachable'}
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="text-xs text-[#677482] dark:text-[#8B97A5]">Market Breadth Score</div>
          <div
            className={`text-lg font-mono font-semibold tabular-nums mt-1 ${
              (stats?.breadthScore ?? 0) > 15
                ? 'text-[#16A378] dark:text-[#35C89A]'
                : (stats?.breadthScore ?? 0) < -15
                  ? 'text-[#DC4C54] dark:text-[#F16B72]'
                  : ''
            }`}
          >
            {(stats?.breadthScore ?? 0) > 0 ? `+${stats?.breadthScore}` : stats?.breadthScore ?? 0}
          </div>
          <div className="text-[11px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
            Above EMA 50: {stats?.aboveEma50Pct ?? 0}%
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="text-xs text-[#677482] dark:text-[#8B97A5]">Bullish Assets</div>
          <div className="text-lg font-mono font-semibold tabular-nums mt-1 text-[#16A378] dark:text-[#35C89A]">
            {stats?.bullishCount ?? 0}
          </div>
          <div className="text-[11px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
            of {stats?.analyzedAssets ?? 0} scanned (1h)
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="text-xs text-[#677482] dark:text-[#8B97A5]">Bearish / Neutral</div>
          <div className="text-lg font-mono font-semibold tabular-nums mt-1">
            <span className="text-[#DC4C54] dark:text-[#F16B72]">{stats?.bearishCount ?? 0}</span>
            <span className="text-[#677482] dark:text-[#8B97A5] mx-1.5">/</span>
            <span className="text-[#64748B] dark:text-[#94A3B8]">{stats?.neutralCount ?? 0}</span>
          </div>
          <div className="text-[11px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
            Above EMA 200: {stats?.aboveEma200Pct ?? 0}%
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="text-xs text-[#677482] dark:text-[#8B97A5]">BTC / ETH Vol Share</div>
          <div className="text-lg font-mono font-semibold tabular-nums mt-1">
            {stats?.btcDominanceProxy !== null ? `${stats?.btcDominanceProxy}%` : '—'}
            <span className="text-[#677482] dark:text-[#8B97A5] mx-1">/</span>
            {stats?.ethDominanceProxy !== null ? `${stats?.ethDominanceProxy}%` : '—'}
          </div>
          <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-1">
            Exchange volume proxy
          </div>
        </div>
      </div>

      {/* Market Leader Mini-Charts */}
      <section aria-label="Market Leaders">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#17212B] dark:text-[#F4F7FA]">
            Market Leaders · 24h Structure
          </h2>
          <button
            type="button"
            onClick={() => setActiveSection('markets')}
            className="text-xs font-medium text-[#6B9F30] dark:text-[#B6F36A] hover:underline"
          >
            View all markets
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {(data?.leaders ?? []).map((ldr) => {
            const live = liveTickers[ldr.ticker.canonicalId];
            const price = live?.lastPrice ?? ldr.ticker.lastPrice;
            const pct = live?.change24hPct ?? ldr.ticker.change24hPct;
            const positive = pct >= 0;
            return (
              <button
                key={ldr.ticker.canonicalId}
                type="button"
                onClick={() =>
                  selectMarket(ldr.ticker.exchange, ldr.ticker.marketType, ldr.ticker.displaySymbol, true)
                }
                className="text-left overflow-hidden rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3.5 hover:border-[#6B9F30] dark:hover:border-[#B6F36A]/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{ldr.ticker.displaySymbol}</span>
                  <span className={`text-[11px] font-mono ${signalColorClass(ldr.signal)}`}>
                    {signalLabel(ldr.signal)}
                  </span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      ${formatPrice(price, preferences.decimalPrecision)}
                    </div>
                    <div
                      className={`font-mono text-xs tabular-nums ${
                        positive
                          ? 'text-[#16A378] dark:text-[#35C89A]'
                          : 'text-[#DC4C54] dark:text-[#F16B72]'
                      }`}
                    >
                      {formatPercent(pct)}
                    </div>
                  </div>
                  <MiniSparkline data={ldr.sparkline} positive={positive} />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Market Pulse + Heatmap Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Market Heatmap */}
        <div className="lg:col-span-8 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold">Performance Heatmap (Sized by 24h Quote Volume)</h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                Click any tile to launch full technical analysis in Asset Explorer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('heatmaps')}
              className="text-xs text-[#6B9F30] dark:text-[#B6F36A] hover:underline whitespace-nowrap"
            >
              Full Heatmaps
            </button>
          </div>
          <EChartBox
            option={heatmapOption}
            height={300}
            onChartClick={(params: unknown) => {
              const d = (params as { data?: { exchange?: MarketTicker['exchange']; marketType?: MarketTicker['marketType']; displaySymbol?: string } }).data;
              if (d?.exchange && d?.marketType && d?.displaySymbol) {
                selectMarket(d.exchange, d.marketType, d.displaySymbol, true);
              }
            }}
          />
        </div>

        {/* Market Pulse */}
        <div className="lg:col-span-4 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold mb-3">Market Pulse</h2>
            <dl className="divide-y divide-[#E6EBF0] dark:divide-[#27313C] text-xs">
              {[
                ['Overall Breadth Bias', pulse?.overallBias ?? '—'],
                ['BTC 1h Trend', pulse?.btcTrend ?? '—'],
                ['ETH 1h Trend', pulse?.ethTrend ?? '—'],
                ['Volume Conditions', pulse?.volumeCondition ?? '—'],
                ['Volatility Regime', pulse?.volatilityRegime ?? '—'],
                ['Sentiment (Daily)', pulse?.sentiment ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[#677482] dark:text-[#8B97A5]">{k}</dt>
                  <dd className="font-mono font-medium text-right text-[#17212B] dark:text-[#F4F7FA]">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('explorer')}
            className="mt-4 w-full py-2 px-4 rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            Open Active Asset Explorer
          </button>
        </div>
      </div>

      {/* Top Movers + Watchlist + Recent Signals */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Top Movers */}
        <div className="xl:col-span-5 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold">Top Movers & Technical Leaders</h2>
          </div>
          <div className="flex flex-wrap gap-1 mb-3 p-1 rounded-lg bg-[#F1F5F9] dark:bg-[#10151C]">
            {(
              [
                ['gainers', 'Gainers'],
                ['losers', 'Losers'],
                ['volume', 'High Vol'],
                ['unusual', 'Unusual RVOL'],
                ['momentum', 'Bullish Score'],
                ['downtrend', 'Bearish Score'],
              ] as [MoverTab, string][]
            ).map(([t, lbl]) => (
              <button
                key={t}
                type="button"
                onClick={() => setMoverTab(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  moverTab === t
                    ? 'bg-[#FFFFFF] dark:bg-[#1B232D] text-[#17212B] dark:text-[#B6F36A]'
                    : 'text-[#677482] dark:text-[#8B97A5]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] text-[#677482] dark:text-[#8B97A5]">
                  <th className="text-left py-2 font-medium">Pair</th>
                  <th className="text-right py-2 font-medium">Price</th>
                  <th className="text-right py-2 font-medium">
                    {moverTab === 'unusual'
                      ? 'RVOL 20'
                      : moverTab === 'momentum' || moverTab === 'downtrend'
                        ? 'Score'
                        : '24h %'}
                  </th>
                  <th className="text-right py-2 font-medium">24h Vol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60 font-mono tabular-nums">
                {moverTab === 'gainers' || moverTab === 'losers' || moverTab === 'volume'
                  ? (
                      (moverTab === 'gainers'
                        ? data?.topGainers
                        : moverTab === 'losers'
                          ? data?.topLosers
                          : data?.highestVolume) ?? []
                    ).map((m) => (
                      <tr
                        key={m.canonicalId}
                        onClick={() => selectMarket(m.exchange, m.marketType, m.displaySymbol, true)}
                        className="cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]/60"
                      >
                        <td className="py-2 font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                          {m.displaySymbol}
                        </td>
                        <td className="py-2 text-right">${formatPrice(m.lastPrice)}</td>
                        <td
                          className={`py-2 text-right ${
                            m.change24hPct >= 0
                              ? 'text-[#16A378] dark:text-[#35C89A]'
                              : 'text-[#DC4C54] dark:text-[#F16B72]'
                          }`}
                        >
                          {formatPercent(m.change24hPct)}
                        </td>
                        <td className="py-2 text-right text-[#677482] dark:text-[#8B97A5]">
                          {formatCompactUsd(m.quoteVolume24h)}
                        </td>
                      </tr>
                    ))
                  : (
                      (moverTab === 'unusual'
                        ? data?.unusualVolume
                        : moverTab === 'momentum'
                          ? data?.strongestMomentum
                          : data?.strongestDowntrend) ?? []
                    ).map((r) => (
                      <tr
                        key={r.canonicalId}
                        onClick={() => selectMarket(r.exchange, r.marketType, r.displaySymbol, true)}
                        className="cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]/60"
                      >
                        <td className="py-2 font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                          {r.displaySymbol}
                        </td>
                        <td className="py-2 text-right">${formatPrice(r.price)}</td>
                        <td
                          className={`py-2 text-right ${
                            moverTab === 'unusual'
                              ? 'text-[#6B9F30] dark:text-[#B6F36A]'
                              : r.directionalScore >= 0
                                ? 'text-[#16A378] dark:text-[#35C89A]'
                                : 'text-[#DC4C54] dark:text-[#F16B72]'
                          }`}
                        >
                          {moverTab === 'unusual'
                            ? `${(r.rvol20 ?? 0).toFixed(2)}x`
                            : `${r.directionalScore > 0 ? '+' : ''}${r.directionalScore.toFixed(1)}`}
                        </td>
                        <td className="py-2 text-right text-[#677482] dark:text-[#8B97A5]">
                          {formatCompactUsd(r.volume24hUsd)}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Watchlist */}
        <div className="xl:col-span-4 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold">Watchlist ({watchlist.length})</h2>
            <input
              type="text"
              value={watchlistFilter}
              onChange={(e) => setWatchlistFilter(e.target.value)}
              placeholder="Filter..."
              aria-label="Filter watchlist"
              className="w-28 px-2 py-1 rounded-md border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-xs"
            />
          </div>

          <form onSubmit={handleAddWatchlist} className="flex gap-1.5 mb-3">
            <input
              type="text"
              value={addPairInput}
              onChange={(e) => setAddPairInput(e.target.value)}
              placeholder="Add pair e.g. ADA/USDT"
              aria-label="Add pair to watchlist"
              className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-xs font-mono"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </form>

          <div className="flex-1 divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60 overflow-y-auto max-h-72">
            {filteredWatchlist.map((cid, idx) => {
              const parts = cid.split(':');
              const ex = parts[0] as MarketTicker['exchange'];
              const mt = parts[1] as MarketTicker['marketType'];
              const sym = parts[2] || cid;
              const tk = marketById.get(cid);
              const live = liveTickers[cid];
              const price = live?.lastPrice ?? tk?.lastPrice;
              const pct = live?.change24hPct ?? tk?.change24hPct;

              return (
                <div key={cid} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => selectMarket(ex, mt, sym, true)}
                    className="text-left min-w-0 flex-1 hover:text-[#6B9F30] dark:hover:text-[#B6F36A]"
                  >
                    <div className="font-mono font-semibold truncate">{sym}</div>
                    <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                      {ex} · {mt}
                    </div>
                  </button>
                  <div className="font-mono text-right tabular-nums">
                    <div>{price ? `$${formatPrice(price)}` : '—'}</div>
                    <div
                      className={`text-[11px] ${
                        (pct ?? 0) >= 0
                          ? 'text-[#16A378] dark:text-[#35C89A]'
                          : 'text-[#DC4C54] dark:text-[#F16B72]'
                      }`}
                    >
                      {pct !== undefined ? formatPercent(pct) : '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveWatchlistItem(idx, -1)}
                      aria-label={`Move ${sym} up`}
                      className="p-1 text-[#677482] hover:text-[#17212B] dark:hover:text-[#F4F7FA]"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveWatchlistItem(idx, 1)}
                      aria-label={`Move ${sym} down`}
                      className="p-1 text-[#677482] hover:text-[#17212B] dark:hover:text-[#F4F7FA]"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleWatchlist(cid)}
                      aria-label={`Remove ${sym} from watchlist`}
                      className="p-1 text-[#677482] hover:text-[#F16B72]"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Confirmed Signal Activity */}
        <div className="xl:col-span-3 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Confirmed Signal Activity</h2>
            <button
              type="button"
              onClick={() => setActiveSection('signals')}
              className="text-xs text-[#6B9F30] dark:text-[#B6F36A] hover:underline"
            >
              Feed
            </button>
          </div>
          <div className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60 overflow-y-auto max-h-80">
            {(data?.recentSignals ?? []).length === 0 ? (
              <div className="py-8 text-center text-xs text-[#677482] dark:text-[#8B97A5]">
                Background scanner populates confirmed technical signal events after candle validation.
              </div>
            ) : (
              (data?.recentSignals ?? []).slice(0, 8).map((ev) => {
                const setup = ev.signalSetup;
                const isBuy = setup?.direction === 'BUY' || (!setup && ev.classification.includes('BULLISH'));
                const isSell = setup?.direction === 'SELL' || (!setup && ev.classification.includes('BEARISH'));
                const dirText = isBuy ? 'BUY' : isSell ? 'SELL' : 'WAIT';
                const compactSym = setup?.symbol ?? ev.displaySymbol.replace(/[^A-Za-z0-9]/g, '');
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => selectMarket(ev.exchange, ev.marketType, ev.displaySymbol, true)}
                    className="w-full py-2.5 text-left hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]/50 px-1 rounded transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {compactSym} · {ev.timeframe}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${signalBgClass(ev.classification)}`}>
                        {dirText}
                      </span>
                    </div>
                    {setup && setup.direction !== 'WAIT' && setup.entryPrice !== null && setup.stopLoss !== null ? (
                      <div className="mt-1 space-y-0.5 font-mono text-[10px] tabular-nums">
                        <div className="text-[#17212B] dark:text-[#F4F7FA]">
                          Entry: {setup.entryMode === 'NOW' ? `NOW $${formatPrice(setup.entryPrice)}` : `$${formatPrice(setup.entryZoneLow)}–$${formatPrice(setup.entryZoneHigh)}`}
                        </div>
                        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                          <span className="text-[#DC4C54] dark:text-[#F16B72]">
                            SL: ${formatPrice(setup.stopLoss)}
                          </span>
                          {setup.takeProfits[0] && (
                            <span className="text-[#16A378] dark:text-[#35C89A]">
                              TP1: ${formatPrice(setup.takeProfits[0].price)}
                            </span>
                          )}
                          {setup.takeProfits[1] && (
                            <span className="text-[#16A378] dark:text-[#35C89A]">
                              TP2: ${formatPrice(setup.takeProfits[1].price)}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-1 line-clamp-2">
                        {ev.summary}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
                      {ev.exchange} · {formatTimestamp(ev.candleTimestamp, preferences.timezone, false)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
