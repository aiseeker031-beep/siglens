import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { RefreshCw } from 'lucide-react';
import { EChartBox } from '../components/charts/EChartBox';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import { EXCHANGE_LABELS, QUICK_TIMEFRAMES } from '../shared/constants';
import { formatCompactUsd, formatPercent, signalBgClass, signalLabel } from '../shared/format';
import type { ExchangeId, ScreenerRow, Timeframe } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type HeatmapTab = 'performance' | 'volume' | 'signals' | 'correlation' | 'breadth' | 'volatility';

const DEFAULT_CORR_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'SUI'];

export const HeatmapsView: React.FC = () => {
  const globalExchange = useAppStore((s) => s.exchange);
  const theme = useAppStore((s) => s.preferences.theme);
  const selectMarket = useAppStore((s) => s.selectMarket);

  const [tab, setTab] = useState<HeatmapTab>('performance');
  const [exchange, setExchange] = useState<ExchangeId>(globalExchange);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [corrLookback, setCorrLookback] = useState<number>(60);

  const [breadthData, setBreadthData] = useState<Awaited<ReturnType<typeof api.getMarketBreadth>> | null>(null);
  const [corrData, setCorrData] = useState<Awaited<ReturnType<typeof api.getCorrelation>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const quote = exchange === 'kraken' || exchange === 'coinbase' ? 'USD' : 'USDT';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const syms = DEFAULT_CORR_BASES.map((b) => `${b}/${quote}`);
      const [bRes, cRes] = await Promise.all([
        api.getMarketBreadth(exchange, timeframe),
        api.getCorrelation(syms, exchange, timeframe, corrLookback),
      ]);
      setBreadthData(bRes);
      setCorrData(cRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to compute market heatmaps');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [exchange, timeframe, corrLookback]);

  const rows: ScreenerRow[] = breadthData?.rows ?? [];

  const textColor = isDark ? '#F4F7FA' : '#17212B';
  const mutedColor = isDark ? '#8B97A5' : '#677482';
  const borderColor = isDark ? '#27313C' : '#E6EBF0';

  // Performance Treemap Option
  const performanceOption = useMemo<EChartsOption>(() => {
    const items = rows.map((r) => {
      const pct = r.change24hPct;
      const color =
        pct >= 4
          ? '#16A378'
          : pct >= 1
            ? '#248F6D'
            : pct >= 0
              ? '#1E5A4C'
              : pct <= -4
                ? '#DC4C54'
                : pct <= -1
                  ? '#B8424A'
                  : '#6E3238';
      return {
        name: `${r.baseAsset}\n${formatPercent(pct, 2)}`,
        value: Math.max(1, Math.sqrt(Math.max(r.volume24hUsd, 100_000))),
        rawRow: r,
        itemStyle: { color, borderColor: isDark ? '#0B0F14' : '#FFFFFF', borderWidth: 2 },
      };
    });

    return {
      animation: false,
      tooltip: {
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { data?: { rawRow?: ScreenerRow } };
          const r = p.data?.rawRow;
          if (!r) return '';
          return [
            `<strong>${r.displaySymbol}</strong>`,
            `24h Change: ${formatPercent(r.change24hPct)}`,
            `24h Volume: ${formatCompactUsd(r.volume24hUsd)}`,
            `Signal: ${signalLabel(r.classification)} (${r.directionalScore.toFixed(1)})`,
          ].join('<br/>');
        },
      },
      series: [
        {
          type: 'treemap',
          animation: false,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: {
            show: true,
            color: '#F4F7FA',
            fontWeight: 600,
            fontSize: 12,
            lineHeight: 16,
          },
          data: items,
        },
      ],
    };
  }, [rows, isDark, borderColor, textColor]);

  // Volume / RVOL Bar Chart
  const volumeOption = useMemo<EChartsOption>(() => {
    const sorted = [...rows]
      .filter((r) => r.rvol20 !== null)
      .sort((a, b) => (b.rvol20 ?? 0) - (a.rvol20 ?? 0))
      .slice(0, 20);
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      grid: { left: 50, right: 20, top: 24, bottom: 52 },
      xAxis: {
        type: 'category',
        data: sorted.map((r) => r.baseAsset),
        axisLabel: { color: mutedColor, rotate: 35, fontSize: 11 },
        axisLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: 'value',
        name: 'RVOL (x)',
        nameTextStyle: { color: mutedColor, fontSize: 11 },
        axisLabel: { color: mutedColor, fontSize: 11 },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((r) => ({
            value: Number((r.rvol20 ?? 0).toFixed(2)),
            itemStyle: {
              color:
                (r.rvol20 ?? 0) >= 1.8
                  ? '#E6A832'
                  : (r.rvol20 ?? 0) >= 1.2
                    ? '#4EA1FF'
                    : '#64748B',
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
      ],
    };
  }, [rows, isDark, borderColor, textColor, mutedColor]);

  // Realized Volatility (ATR%) Chart
  const volatilityOption = useMemo<EChartsOption>(() => {
    const sorted = [...rows]
      .filter((r) => r.atrPct !== null)
      .sort((a, b) => (b.atrPct ?? 0) - (a.atrPct ?? 0))
      .slice(0, 20);
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      grid: { left: 55, right: 20, top: 24, bottom: 52 },
      xAxis: {
        type: 'category',
        data: sorted.map((r) => r.baseAsset),
        axisLabel: { color: mutedColor, rotate: 35, fontSize: 11 },
        axisLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: 'value',
        name: 'ATR %',
        nameTextStyle: { color: mutedColor, fontSize: 11 },
        axisLabel: { color: mutedColor, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((r) => ({
            value: Number((r.atrPct ?? 0).toFixed(2)),
            itemStyle: {
              color:
                (r.atrPct ?? 0) >= 3
                  ? '#F16B72'
                  : (r.atrPct ?? 0) >= 1.5
                    ? '#E6A832'
                    : '#35C89A',
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
      ],
    };
  }, [rows, isDark, borderColor, textColor, mutedColor]);

  // Pearson Correlation Heatmap
  const correlationOption = useMemo<EChartsOption>(() => {
    if (!corrData) return {};
    const labels = corrData.symbols.map((s) => s.split('/')[0]);
    const heatPoints: [number, number, number | string][] = [];
    for (let i = 0; i < corrData.matrix.length; i++) {
      for (let j = 0; j < corrData.matrix[i].length; j++) {
        const val = corrData.matrix[i][j];
        heatPoints.push([j, i, val === null ? '-' : Number(val.toFixed(2))]);
      }
    }
    return {
      tooltip: {
        position: 'top',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { value?: [number, number, number | string] };
          if (!p.value) return '';
          const [col, row, v] = p.value;
          const samples = corrData.sampleCounts[row]?.[col] ?? 0;
          return `<strong>${labels[row]} vs ${labels[col]}</strong><br/>Pearson r: <b>${v}</b><br/>Aligned candles: ${samples}`;
        },
      },
      grid: { left: 64, right: 64, top: 20, bottom: 60 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: mutedColor, fontSize: 11 },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: mutedColor, fontSize: 11 },
        splitArea: { show: false },
      },
      visualMap: {
        min: -1,
        max: 1,
        calculable: false,
        orient: 'vertical',
        right: 6,
        top: 'center',
        textStyle: { color: mutedColor, fontSize: 10 },
        inRange: {
          color: ['#DC4C54', '#7F3640', '#1E2733', '#1E6F5C', '#35C89A'],
        },
      },
      series: [
        {
          name: 'Correlation',
          type: 'heatmap',
          data: heatPoints,
          label: {
            show: true,
            color: '#F4F7FA',
            fontSize: 10,
            fontFamily: 'IBM Plex Mono',
          },
          itemStyle: { borderColor: isDark ? '#0B0F14' : '#FFFFFF', borderWidth: 1.5 },
        },
      ],
    };
  }, [corrData, isDark, borderColor, textColor, mutedColor]);

  // Breadth Chart
  const breadthOption = useMemo<EChartsOption>(() => {
    if (!breadthData) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      grid: { left: 140, right: 32, top: 20, bottom: 30 },
      xAxis: {
        type: 'value',
        max: 100,
        axisLabel: { color: mutedColor, formatter: '{value}%' },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      yAxis: {
        type: 'category',
        data: [
          'Bullish Signals',
          'Neutral Signals',
          'Bearish Signals',
          'Price > EMA 50',
          'Price > EMA 200',
          'Positive Momentum',
        ],
        axisLabel: { color: textColor, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 20,
          data: [
            { value: breadthData.bullishPct, itemStyle: { color: '#35C89A', borderRadius: [0, 4, 4, 0] } },
            { value: breadthData.neutralPct, itemStyle: { color: '#94A3B8', borderRadius: [0, 4, 4, 0] } },
            { value: breadthData.bearishPct, itemStyle: { color: '#F16B72', borderRadius: [0, 4, 4, 0] } },
            { value: breadthData.aboveEma50Pct, itemStyle: { color: '#4EA1FF', borderRadius: [0, 4, 4, 0] } },
            { value: breadthData.aboveEma200Pct, itemStyle: { color: '#2563EB', borderRadius: [0, 4, 4, 0] } },
            { value: breadthData.positiveMomentumPct, itemStyle: { color: '#E6A832', borderRadius: [0, 4, 4, 0] } },
          ],
          label: {
            show: true,
            position: 'right',
            formatter: '{c}%',
            color: textColor,
            fontFamily: 'IBM Plex Mono',
            fontSize: 11,
          },
        },
      ],
    };
  }, [breadthData, isDark, borderColor, textColor, mutedColor]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Market Heatmaps & Correlation Matrix
          </h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Real-time market breadth, performance treemap, relative volume participation, volatility clusters, and aligned Pearson correlations ({EXCHANGE_LABELS[exchange]}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Heatmap exchange"
            value={exchange}
            onChange={(e) => setExchange(e.target.value as ExchangeId)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23]"
          >
            <option value="binance">Binance</option>
            <option value="bybit">Bybit</option>
            <option value="kraken">Kraken</option>
            <option value="coinbase">Coinbase</option>
          </select>

          <select
            aria-label="Heatmap timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23]"
          >
            {QUICK_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>

          {tab === 'correlation' && (
            <select
              aria-label="Correlation lookback bars"
              value={corrLookback}
              onChange={(e) => setCorrLookback(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23]"
            >
              <option value={30}>30 bars</option>
              <option value={60}>60 bars</option>
              <option value={120}>120 bars</option>
            </select>
          )}

          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1.5 border-b border-[#E6EBF0] dark:border-[#27313C] pb-2 text-xs">
        {(
          [
            ['performance', 'Performance Treemap'],
            ['volume', 'Volume / RVOL'],
            ['signals', 'Signal Matrix'],
            ['correlation', 'Correlation Matrix'],
            ['breadth', 'Market Breadth'],
            ['volatility', 'Volatility (ATR%)'],
          ] as [HeatmapTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              tab === id
                ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14]'
                : 'text-[#677482] dark:text-[#8B97A5] hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-[#F16B72]/40 bg-[#F16B72]/10 p-4 text-xs text-[#DC4C54] dark:text-[#F16B72]">
          {error}
        </div>
      )}

      {loading && !breadthData ? (
        <SkeletonBlock className="h-[440px]" />
      ) : (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
          {tab === 'performance' && (
            <div className="space-y-2">
              <div className="text-xs text-[#677482] dark:text-[#8B97A5]">
                Tile area scales with 24h USD volume; color encodes 24h price performance. Click any tile to inspect in Asset Explorer.
              </div>
              <EChartBox
                option={performanceOption}
                height={440}
                onChartClick={(params) => {
                  const p = params as { data?: { rawRow?: ScreenerRow } };
                  const r = p.data?.rawRow;
                  if (r) selectMarket(r.exchange, r.marketType, r.displaySymbol, true);
                }}
              />
            </div>
          )}

          {tab === 'volume' && (
            <div className="space-y-2">
              <div className="text-xs text-[#677482] dark:text-[#8B97A5]">
                Top 20 tracked pairs ranked by 20-bar Relative Volume (RVOL). Amber highlights elevated participation (&ge; 1.8x).
              </div>
              <EChartBox option={volumeOption} height={420} />
            </div>
          )}

          {tab === 'volatility' && (
            <div className="space-y-2">
              <div className="text-xs text-[#677482] dark:text-[#8B97A5]">
                Normalized Average True Range (ATR 14 as % of close price) across analyzed pairs on {timeframe}.
              </div>
              <EChartBox option={volatilityOption} height={420} />
            </div>
          )}

          {tab === 'correlation' && (
            <div className="space-y-2">
              <div className="text-xs text-[#677482] dark:text-[#8B97A5]">
                Pearson correlation of log returns computed strictly over aligned candle timestamps ({corrLookback}-bar lookback on {timeframe}). Hover any cell for exact sample count.
              </div>
              <EChartBox option={correlationOption} height={460} />
            </div>
          )}

          {tab === 'breadth' && breadthData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C]">
                  <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Analyzed Universe</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {breadthData.analyzedAssets}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C]">
                  <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Breadth Score</div>
                  <div
                    className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                      breadthData.breadthScore >= 0
                        ? 'text-[#16A378] dark:text-[#35C89A]'
                        : 'text-[#DC4C54] dark:text-[#F16B72]'
                    }`}
                  >
                    {breadthData.breadthScore > 0 ? `+${breadthData.breadthScore}` : breadthData.breadthScore}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C]">
                  <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Above EMA 50</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {breadthData.aboveEma50Pct}%
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C]">
                  <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Above EMA 200</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {breadthData.aboveEma200Pct}%
                  </div>
                </div>
              </div>
              <EChartBox option={breadthOption} height={320} />
              <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                {breadthData.universeNote}
              </div>
            </div>
          )}

          {tab === 'signals' && (
            <div className="space-y-3">
              <div className="text-xs text-[#677482] dark:text-[#8B97A5]">
                Deterministic signal matrix across tracked {EXCHANGE_LABELS[exchange]} pairs ({timeframe}). Click any card to open full diagnostics.
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                {rows.map((r) => (
                  <button
                    key={r.canonicalId}
                    type="button"
                    onClick={() => selectMarket(r.exchange, r.marketType, r.displaySymbol, true)}
                    className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-3 text-left hover:border-[#2563EB] dark:hover:border-[#4EA1FF] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold">{r.baseAsset}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          r.change24hPct >= 0
                            ? 'text-[#16A378] dark:text-[#35C89A]'
                            : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {formatPercent(r.change24hPct, 1)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${signalBgClass(r.classification)}`}>
                        {signalLabel(r.classification)}
                      </span>
                      <span className="font-mono text-[11px] font-semibold tabular-nums">
                        {r.directionalScore > 0 ? `+${r.directionalScore.toFixed(0)}` : r.directionalScore.toFixed(0)}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-[#677482] dark:text-[#8B97A5] font-mono tabular-nums">
                      RSI {r.rsi14?.toFixed(0) ?? '—'} · ADX {r.adx14?.toFixed(0) ?? '—'} · {r.agreementPct}%
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
