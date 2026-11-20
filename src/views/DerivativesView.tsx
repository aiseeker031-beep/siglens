import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { RefreshCw } from 'lucide-react';
import { EChartBox } from '../components/charts/EChartBox';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import { formatCompactUsd, formatPercent, formatPrice, formatTimestamp } from '../shared/format';
import type { DerivativesMarket } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

export const DerivativesView: React.FC = () => {
  const theme = useAppStore((s) => s.preferences.theme);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const timezone = useAppStore((s) => s.preferences.timezone);
  const selectMarket = useAppStore((s) => s.selectMarket);

  const [markets, setMarkets] = useState<DerivativesMarket[]>([]);
  const [source, setSource] = useState('Bybit V5 Public Linear Perpetuals');
  const [selectedBase, setSelectedBase] = useState('BTC');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.getDerivativesDetail>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const textColor = isDark ? '#F4F7FA' : '#17212B';
  const mutedColor = isDark ? '#8B97A5' : '#677482';
  const borderColor = isDark ? '#27313C' : '#E6EBF0';

  const loadMarkets = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDerivatives();
      setMarkets(res.markets);
      setSource(res.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch derivatives markets');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (base: string) => {
    setDetailLoading(true);
    try {
      const res = await api.getDerivativesDetail(base);
      setDetail(res);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadMarkets();
  }, []);

  useEffect(() => {
    loadDetail(selectedBase);
  }, [selectedBase]);

  const aggregateStats = useMemo(() => {
    if (!markets.length) return null;
    const totalOi = markets.reduce((s, m) => s + m.openInterestValueUsd, 0);
    const totalVol = markets.reduce((s, m) => s + m.volume24hUsd, 0);
    const avgFunding = markets.reduce((s, m) => s + m.fundingRatePct, 0) / markets.length;
    const positiveFundingCount = markets.filter((m) => m.fundingRatePct > 0).length;
    return { totalOi, totalVol, avgFunding, positiveFundingCount };
  }, [markets]);

  const fundingChartOption = useMemo<EChartsOption>(() => {
    if (!detail?.fundingHistory.length) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      grid: { left: 58, right: 16, top: 20, bottom: 32 },
      xAxis: {
        type: 'category',
        data: detail.fundingHistory.map((d) => new Date(d.timestamp).toISOString().slice(5, 16).replace('T', ' ')),
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: mutedColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: [
        {
          name: 'Funding Rate %',
          type: 'bar',
          data: detail.fundingHistory.map((d) => ({
            value: Number(d.fundingRatePct.toFixed(4)),
            itemStyle: { color: d.fundingRatePct >= 0 ? '#35C89A' : '#F16B72' },
          })),
        },
      ],
    };
  }, [detail, isDark, borderColor, textColor, mutedColor]);

  const oiChartOption = useMemo<EChartsOption>(() => {
    if (!detail?.openInterestHistory.length) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      grid: { left: 68, right: 16, top: 20, bottom: 32 },
      xAxis: {
        type: 'category',
        data: detail.openInterestHistory.map((d) => new Date(d.timestamp).toISOString().slice(5, 16).replace('T', ' ')),
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: mutedColor, fontSize: 10 },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: [
        {
          name: 'Open Interest (Contracts)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#4EA1FF', width: 2 },
          areaStyle: { color: 'rgba(78, 161, 255, 0.14)' },
          data: detail.openInterestHistory.map((d) => Number(d.openInterest.toFixed(2))),
        },
      ],
    };
  }, [detail, isDark, borderColor, textColor, mutedColor]);

  const lsChartOption = useMemo<EChartsOption>(() => {
    if (!detail?.longShortHistory.length) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      legend: {
        data: ['Long %', 'Short %'],
        textStyle: { color: mutedColor, fontSize: 11 },
        top: 0,
      },
      grid: { left: 48, right: 16, top: 28, bottom: 32 },
      xAxis: {
        type: 'category',
        data: detail.longShortHistory.map((d) => new Date(d.timestamp).toISOString().slice(11, 16)),
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: mutedColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: [
        {
          name: 'Long %',
          type: 'line',
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#35C89A' },
          lineStyle: { color: '#35C89A', width: 2 },
          data: detail.longShortHistory.map((d) => Number((d.buyRatio * 100).toFixed(1))),
        },
        {
          name: 'Short %',
          type: 'line',
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#F16B72' },
          lineStyle: { color: '#F16B72', width: 2 },
          data: detail.longShortHistory.map((d) => Number((d.sellRatio * 100).toFixed(1))),
        },
      ],
    };
  }, [detail, isDark, borderColor, textColor, mutedColor]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Derivatives Analytics</h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Live perpetual futures funding rates, open interest, mark/index basis spread, and account long/short positioning ({source}).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            loadMarkets();
            loadDetail(selectedBase);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] text-xs font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Perpetuals
        </button>
      </div>

      {/* Summary Strip */}
      {aggregateStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
            <div className="text-[#677482] dark:text-[#8B97A5]">Tracked Perpetual Open Interest</div>
            <div className="text-xl font-bold font-mono tabular-nums mt-1">
              {formatCompactUsd(aggregateStats.totalOi)}
            </div>
            <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
              Across {markets.length} linear USDT contracts
            </div>
          </div>
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
            <div className="text-[#677482] dark:text-[#8B97A5]">24h Perpetual Volume</div>
            <div className="text-xl font-bold font-mono tabular-nums mt-1">
              {formatCompactUsd(aggregateStats.totalVol)}
            </div>
            <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
              Exchange-reported turnover
            </div>
          </div>
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
            <div className="text-[#677482] dark:text-[#8B97A5]">Mean 8h Funding Rate</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                aggregateStats.avgFunding >= 0
                  ? 'text-[#16A378] dark:text-[#35C89A]'
                  : 'text-[#DC4C54] dark:text-[#F16B72]'
              }`}
            >
              {aggregateStats.avgFunding >= 0 ? '+' : ''}
              {aggregateStats.avgFunding.toFixed(4)}%
            </div>
            <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
              {aggregateStats.positiveFundingCount}/{markets.length} contracts positive
            </div>
          </div>
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
            <div className="text-[#677482] dark:text-[#8B97A5]">Liquidation Heatmaps</div>
            <div className="text-sm font-semibold mt-1.5 text-[#677482] dark:text-[#8B97A5]">
              Unavailable (Free API)
            </div>
            <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
              Not fabricated — public REST omits order-level liquidation maps
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#F16B72]/40 bg-[#F16B72]/10 p-4 text-xs text-[#DC4C54] dark:text-[#F16B72]">
          {error}
        </div>
      )}

      {/* Selected Contract Historical Charts */}
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">
              {selectedBase}/USDT Perpetual Telemetry
            </h2>
            <p className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
              Click any contract row below to inspect its historical funding rate, open interest, and long/short ratio.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'LINK', 'SUI'].map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setSelectedBase(b)}
                className={`px-2 py-1 rounded text-[11px] font-mono ${
                  selectedBase === b
                    ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] font-semibold'
                    : 'bg-[#F7F9FB] dark:bg-[#10151C] text-[#677482] dark:text-[#8B97A5]'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {detailLoading && !detail ? (
          <SkeletonBlock className="h-56" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-3">
              <div className="text-xs font-semibold mb-1">Historical Funding Rate (%)</div>
              {detail?.fundingHistory.length ? (
                <EChartBox option={fundingChartOption} height={220} />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-xs text-[#677482]">
                  Funding history unavailable
                </div>
              )}
            </div>
            <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-3">
              <div className="text-xs font-semibold mb-1">Open Interest (1h History)</div>
              {detail?.openInterestHistory.length ? (
                <EChartBox option={oiChartOption} height={220} />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-xs text-[#677482]">
                  Open interest history unavailable
                </div>
              )}
            </div>
            <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-3">
              <div className="text-xs font-semibold mb-1">Account Long / Short Ratio (%)</div>
              {detail?.longShortHistory.length ? (
                <EChartBox option={lsChartOption} height={220} />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-xs text-[#677482]">
                  Long/Short ratio unavailable for {selectedBase}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Perpetual Comparison Table */}
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E6EBF0] dark:border-[#27313C] flex items-center justify-between text-xs">
          <span className="font-semibold">Perpetual Contracts Comparison</span>
          <span className="text-[#677482] dark:text-[#8B97A5]">Click a row to load telemetry · Double-click to open chart</span>
        </div>

        {loading && markets.length === 0 ? (
          <div className="p-4 space-y-2">
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-[11px] text-[#677482] dark:text-[#8B97A5]">
                  <th className="text-left px-3 py-2 font-medium">Contract</th>
                  <th className="text-right px-3 py-2 font-medium">Mark Price</th>
                  <th className="text-right px-3 py-2 font-medium">24h %</th>
                  <th className="text-right px-3 py-2 font-medium">Basis / Prem</th>
                  <th className="text-right px-3 py-2 font-medium">Funding (8h)</th>
                  <th className="text-right px-3 py-2 font-medium">Open Interest</th>
                  <th className="text-right px-3 py-2 font-medium">24h Vol</th>
                  <th className="text-left px-3 py-2 font-medium">Next Funding</th>
                  <th className="text-left px-3 py-2 font-medium">Contextual Observation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                {markets.map((m) => {
                  const base = m.displaySymbol.split('/')[0];
                  const selected = base === selectedBase;
                  return (
                    <tr
                      key={m.canonicalId}
                      onClick={() => setSelectedBase(base)}
                      onDoubleClick={() => selectMarket('bybit', 'perpetual', m.displaySymbol, true)}
                      className={`cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[#2563EB]/8 dark:bg-[#4EA1FF]/10'
                          : 'hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]'
                      }`}
                    >
                      <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{m.displaySymbol}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        ${formatPrice(m.markPrice, precision)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                          m.change24hPct >= 0
                            ? 'text-[#16A378] dark:text-[#35C89A]'
                            : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {formatPercent(m.change24hPct)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPercent(m.premiumPct, 3)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${
                          m.fundingRatePct > 0.03
                            ? 'text-[#E6A832]'
                            : m.fundingRatePct >= 0
                              ? 'text-[#16A378] dark:text-[#35C89A]'
                              : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {m.fundingRatePct >= 0 ? '+' : ''}
                        {m.fundingRatePct.toFixed(4)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatCompactUsd(m.openInterestValueUsd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#677482] dark:text-[#8B97A5]">
                        {formatCompactUsd(m.volume24hUsd)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[#677482] dark:text-[#8B97A5] whitespace-nowrap">
                        {formatTimestamp(m.nextFundingTime, timezone, false)}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#677482] dark:text-[#8B97A5] max-w-[260px]">
                        {m.observation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
