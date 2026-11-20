import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { EChartBox } from '../components/charts/EChartBox';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import { formatCompactUsd, formatPercent, formatTimestamp } from '../shared/format';
import type { DefiOverview } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

export const DefiView: React.FC = () => {
  const theme = useAppStore((s) => s.preferences.theme);
  const timezone = useAppStore((s) => s.preferences.timezone);

  const [data, setData] = useState<DefiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const textColor = isDark ? '#F4F7FA' : '#17212B';
  const mutedColor = isDark ? '#8B97A5' : '#677482';
  const borderColor = isDark ? '#27313C' : '#E6EBF0';

  const loadDefi = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDefi();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch DeFiLlama data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDefi();
  }, []);

  const categories = useMemo(() => {
    if (!data) return ['ALL'];
    return ['ALL', ...Array.from(new Set(data.protocols.map((p) => p.category))).sort()];
  }, [data]);

  const filteredProtocols = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.protocols.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.symbol.toLowerCase().includes(q) &&
        !p.chains.some((c) => c.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [data, query, categoryFilter]);

  const tvlHistoryOption = useMemo<EChartsOption>(() => {
    if (!data?.historicalTvl.length) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; value: number }[];
          if (!arr?.[0]) return '';
          return `${arr[0].axisValue}<br/>Total DeFi TVL: <strong>${formatCompactUsd(arr[0].value)}</strong>`;
        },
      },
      grid: { left: 68, right: 20, top: 20, bottom: 32 },
      xAxis: {
        type: 'category',
        data: data.historicalTvl.map((h) => new Date(h.date).toISOString().slice(0, 10)),
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          formatter: (v: number) => formatCompactUsd(v),
        },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#35C89A', width: 2 },
          areaStyle: { color: 'rgba(53, 200, 154, 0.14)' },
          data: data.historicalTvl.map((h) => Math.round(h.tvl)),
        },
      ],
    };
  }, [data, isDark, borderColor, textColor, mutedColor]);

  const chainsOption = useMemo<EChartsOption>(() => {
    if (!data?.chains.length) return {};
    const top = data.chains.slice(0, 12);
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { name: string; value: number }[];
          if (!arr?.[0]) return '';
          return `${arr[0].name}: <strong>${formatCompactUsd(arr[0].value)}</strong>`;
        },
      },
      grid: { left: 110, right: 20, top: 14, bottom: 28 },
      xAxis: {
        type: 'value',
        axisLabel: { color: mutedColor, fontSize: 10, formatter: (v: number) => formatCompactUsd(v) },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: top.map((c) => c.name),
        axisLabel: { color: textColor, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: top.map((c) => Math.round(c.tvl)),
          itemStyle: { color: '#4EA1FF', borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [data, isDark, borderColor, textColor, mutedColor]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">DeFi & On-Chain Intelligence</h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Live protocol Total Value Locked (TVL), multi-chain liquidity share, stablecoin supply, and DEX volume from DefiLlama public endpoints.
            {data ? ` Updated ${formatTimestamp(data.updatedAt, timezone, false)}.` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={loadDefi}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] text-xs font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh DeFi Data
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#F16B72]/40 bg-[#F16B72]/10 p-4 text-xs text-[#DC4C54] dark:text-[#F16B72]">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </div>
          <SkeletonBlock className="h-80" />
        </div>
      ) : data ? (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <div className="text-[#677482] dark:text-[#8B97A5]">Global DeFi TVL</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1">
                {formatCompactUsd(data.totalTvl)}
              </div>
              <div
                className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                  (data.tvlChange24hPct ?? 0) >= 0
                    ? 'text-[#16A378] dark:text-[#35C89A]'
                    : 'text-[#DC4C54] dark:text-[#F16B72]'
                }`}
              >
                {data.tvlChange24hPct !== null ? `${formatPercent(data.tvlChange24hPct)} (24h)` : '24h delta unavailable'}
              </div>
            </div>

            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <div className="text-[#677482] dark:text-[#8B97A5]">Leading Chain Share</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1">
                {data.chains[0]?.name ?? '—'}
              </div>
              <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] font-mono tabular-nums mt-0.5">
                {data.chains[0] ? `${formatCompactUsd(data.chains[0].tvl)} (${data.chains[0].sharePct.toFixed(1)}%)` : '—'}
              </div>
            </div>

            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <div className="text-[#677482] dark:text-[#8B97A5]">Stablecoin Supply</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1">
                {data.stablecoinTotalUsd !== null ? formatCompactUsd(data.stablecoinTotalUsd) : 'Unavailable'}
              </div>
              <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
                Aggregate pegged market cap
              </div>
            </div>

            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <div className="text-[#677482] dark:text-[#8B97A5]">24h Global DEX Volume</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1">
                {data.dexVolume24hUsd !== null ? formatCompactUsd(data.dexVolume24hUsd) : 'Unavailable'}
              </div>
              <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
                Across tracked AMM & CLOB DEXs
              </div>
            </div>
          </div>

          {data.unavailableMetrics.length > 0 && (
            <div className="rounded-lg border border-[#E6A832]/30 bg-[#E6A832]/10 px-3.5 py-2 text-[11px] text-[#B7791F] dark:text-[#E6A832]">
              Partial public feed notice: Unavailable metrics right now — {data.unavailableMetrics.join(', ')}.
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-bold mb-2">Historical Global DeFi TVL (90d)</h2>
              <EChartBox option={tvlHistoryOption} height={300} />
            </div>
            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-bold mb-2">Top Chains by Total Value Locked</h2>
              <EChartBox option={chainsOption} height={300} />
            </div>
          </div>

          {/* Protocols Table */}
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
            <div className="p-3.5 border-b border-[#E6EBF0] dark:border-[#27313C] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-semibold">
                Top DeFi Protocols ({filteredProtocols.length})
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#677482]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter protocol or chain..."
                    className="pl-8 pr-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
                  />
                </div>
                <select
                  aria-label="Filter DeFi category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-[11px] text-[#677482] dark:text-[#8B97A5]">
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">Protocol</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Chains</th>
                    <th className="text-right px-3 py-2 font-medium">TVL</th>
                    <th className="text-right px-3 py-2 font-medium">1d %</th>
                    <th className="text-right px-3 py-2 font-medium">7d %</th>
                    <th className="text-right px-3 py-2 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                  {filteredProtocols.slice(0, 60).map((p, idx) => (
                    <tr key={`${p.name}-${idx}`} className="hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]">
                      <td className="px-3 py-2 font-mono text-[#677482] dark:text-[#8B97A5]">{idx + 1}</td>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        {p.name}{' '}
                        {p.symbol && p.symbol !== '-' && (
                          <span className="font-mono text-[10px] text-[#677482] dark:text-[#8B97A5] ml-1">
                            {p.symbol}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">{p.category}</td>
                      <td className="px-3 py-2 text-[11px] text-[#677482] dark:text-[#8B97A5] max-w-[200px] truncate">
                        {p.chains.slice(0, 4).join(', ')}
                        {p.chains.length > 4 ? ` +${p.chains.length - 4}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        {formatCompactUsd(p.tvl)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          (p.change1d ?? 0) >= 0
                            ? 'text-[#16A378] dark:text-[#35C89A]'
                            : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {p.change1d !== null ? formatPercent(p.change1d) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          (p.change7d ?? 0) >= 0
                            ? 'text-[#16A378] dark:text-[#35C89A]'
                            : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {p.change7d !== null ? formatPercent(p.change7d) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open ${p.name}`}
                            className="inline-flex text-[#2563EB] dark:text-[#4EA1FF] hover:underline"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
